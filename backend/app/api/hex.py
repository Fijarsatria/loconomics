"""Endpoint heksagon - sumber data utama untuk peta dan panel insight.

Catatan arsitektur: tidak ada endpoint yang menyajikan POI, menu, struk, atau
properti satu per satu. Semuanya hanya keluar sebagai agregat per heksagon,
karena ketentuan lomba melarang data misi MAPID mentah diekspos ke publik.
"""

import json

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.akun import (
    PenggunaOpsional,
    langganan_aktif,
    sudah_terbuka,
    wajib_akses_penuh,
)
from app.api.bersama import (
    DIMENSI,
    SEMUA_VARIABEL,
    ambil_hex,
    badge,
    peringatan_risiko,
    periksa_kawasan_banyak,
    persentil_churn,
    skor_heksagon,
    zoneguard,
)
from app.core.aturan import (
    JAM_OPERASIONAL,
    MEMUTAR_MENCOLOK,
    PENJELASAN_KUADRAN,
    cakupan_indeks,
    faktor_memutar,
    menit_jalan,
)
from app.core.simulasi import (
    JAM_BUKA_BAWAAN,
    JENIS_USAHA,
    LUAS_BAWAAN_M2,
    MARGIN_BAWAAN,
    PANGSA_BAWAAN,
    hitung_simulasi,
)
from app.core.cache import ber_cache
from app.core.galat import KesalahanAPI
from app.core.database import get_db
from app.models import HexFeature, HexHourlyProfile, LocationScore, ScoreFactor
from app.schemas import (
    CommuterClock,
    DetailHeksagon,
    KonteksSimpul,
    RuteJalan,
    SimpulTransit,
    FaktorSkor,
    IndeksKomposit,
    TitikJam,
    Simulasi,
    JamSimulasi,
    LingkunganSimulasi,
)

router = APIRouter(prefix="/hex", tags=["heksagon"])


def _bbox_ke_envelope(bbox: str):
    """Ubah "lon_min,lat_min,lon_max,lat_max" jadi kotak PostGIS."""
    try:
        angka = [float(x) for x in bbox.split(",")]
        if len(angka) != 4:
            raise ValueError
    except ValueError:
        raise KesalahanAPI(
            "Format bbox harus 'lon_min,lat_min,lon_max,lat_max'.",
            {"diterima": bbox},
        ) from None
    lon_min, lat_min, lon_max, lat_max = angka
    if lon_min >= lon_max or lat_min >= lat_max:
        raise KesalahanAPI("Sudut kiri-bawah bbox harus lebih kecil daripada kanan-atas.")
    return func.ST_MakeEnvelope(lon_min, lat_min, lon_max, lat_max, 4326)


@router.get("/layer", summary="Layer heksagon untuk peta (GeoJSON)")
@ber_cache("hexlayer", ttl=300)
def layer_heksagon(
    db: Annotated[Session, Depends(get_db)],
    kawasan: Annotated[
        str | None,
        Query(
            description="Satu kawasan, atau beberapa dipisah koma "
            "(mis. 'Bekasi,Depok Baru'). Kosong = keenamnya."
        ),
    ] = None,
    min_score: Annotated[float | None, Query(description="Ambang Opportunity Score")] = None,
    bbox: Annotated[
        str | None,
        Query(description="Batasi ke kotak peta: lon_min,lat_min,lon_max,lat_max"),
    ] = None,
    sederhanakan: Annotated[
        float | None,
        Query(
            ge=0,
            le=0.01,
            description="Toleransi penyederhanaan geometri dalam derajat. "
            "0,0001 ≈ 11 m, cukup untuk zoom rendah",
        ),
    ] = None,
    versi: Annotated[str, Query()] = "baseline",
    limit: Annotated[int, Query(ge=1, le=20000)] = 5000,
) -> dict:
    """FeatureCollection siap render.

    Dalam produksi layer ini disajikan sebagai GeoJSON statis dari CDN Cloudflare
    (mitigasi free tier, lihat docs/arsitektur.md). Endpoint ini dipakai saat
    pengembangan dan sebagai sumber untuk membangkitkan berkas statis itu -
    lihat pipeline/s7_publish.py.

    Layer ini TIDAK menyaring ZoneGuard: peta harus tetap menggambar heksagon
    terlarang, justru supaya pengguna melihat bahwa area itu dikecualikan.
    Yang menyaringnya adalah endpoint rekomendasi - lihat skor.py.

    Tiga hal yang membuat endpoint ini tetap sanggup di free tier:

    `bbox`  - hanya heksagon yang benar-benar terlihat yang dikirim. Peta yang
              di-zoom ke satu blok tidak perlu menerima seluruh kawasan.
    `sederhanakan` - heksagon punya enam titik; pada zoom rendah, presisi tujuh
              desimal tidak menambah apa pun selain ukuran berkas.
    cache   - isi tabel hanya berubah saat pipeline dijalankan, jadi permintaan
              yang sama tidak perlu memindai ulang ribuan baris.
    """
    # Beberapa kawasan sekaligus adalah alat berbayar di antarmuka, TETAPI
    # endpoint ini tidak menjaganya - dan itu disengaja, bukan lubang.
    #
    # Tabel fitur menyatakan baris pertamanya sendiri: "seluruh grid H3 resolusi
    # 9 terbuka untuk dilihat". Tanpa parameter `kawasan`, endpoint ini memang
    # sudah mengirim keenamnya. Menolak 'Bekasi,Depok Baru' sementara ''
    # mengirim keduanya plus empat lagi bukan penjagaan, cuma gangguan yang
    # bisa dilewati dengan menghapus satu parameter.
    #
    # Yang benar-benar dijaga di sisi server adalah yang memang tidak pernah
    # gratis: 43 variabel granular, komparasi, riwayat, pemantauan, dan laporan.
    # Lihat `detail_heksagon` di bawah dan modul /skor.
    daftar_kawasan = periksa_kawasan_banyak(kawasan)
    geom = HexFeature.geom
    if sederhanakan:
        geom = func.ST_SimplifyPreserveTopology(geom, sederhanakan)

    stmt = (
        select(
            HexFeature.h3_index,
            HexFeature.kawasan,
            HexFeature.tingkat_keyakinan,
            HexFeature.n_titik_misi,
            HexFeature.data_source,
            HexFeature.zona_izin_komersial,
            HexFeature.indeks_churn,
            # Variabel biaya ikut di layer supaya PriceLens bisa mewarnai peta
            # tanpa memanggil endpoint detail satu per satu untuk ribuan heksagon.
            HexFeature.harga_sewa_median,
            HexFeature.harga_sewa_per_m2,
            HexFeature.belanja_per_jam,
            HexFeature.njop_m2,
            LocationScore.opportunity_score,
            LocationScore.hidden_gem_score,
            LocationScore.kuadran,
            func.ST_AsGeoJSON(geom).label("geom"),
        )
        .join(
            LocationScore,
            (LocationScore.h3_index == HexFeature.h3_index) & (LocationScore.versi == versi),
            isouter=True,
        )
        .limit(limit)
    )
    if daftar_kawasan:
        stmt = stmt.where(HexFeature.kawasan.in_(daftar_kawasan))
    if min_score is not None:
        stmt = stmt.where(LocationScore.opportunity_score >= min_score)
    if bbox:
        stmt = stmt.where(func.ST_Intersects(HexFeature.geom, _bbox_ke_envelope(bbox)))

    features = [
        {
            "type": "Feature",
            "id": r.h3_index,
            "geometry": json.loads(r.geom),
            "properties": {
                "h3_index": r.h3_index,
                "kawasan": r.kawasan,
                "opportunity_score": r.opportunity_score,
                "hidden_gem_score": r.hidden_gem_score,
                "kuadran": r.kuadran,
                "zona_izin_komersial": r.zona_izin_komersial,
                "indeks_churn": r.indeks_churn,
                "harga_sewa_median": r.harga_sewa_median,
                "harga_sewa_per_m2": r.harga_sewa_per_m2,
                "belanja_per_jam": r.belanja_per_jam,
                "njop_m2": r.njop_m2,
                # badge ikut di properti supaya peta bisa membedakan observed vs predicted
                "tingkat_keyakinan": r.tingkat_keyakinan,
                "n_titik_misi": r.n_titik_misi,
                "data_source": r.data_source,
            },
        }
        for r in db.execute(stmt)
    ]
    return {"type": "FeatureCollection", "features": features}


# Deklarasi rute berjalur tetap HARUS mendahului "/{h3_index}", kalau tidak
# FastAPI akan mencocokkannya sebagai h3_index dan endpoint ini tidak pernah kena.
@router.get(
    "/{h3_index}/commuter-clock",
    response_model=CommuterClock,
    summary="Commuter Clock - pola jam 05:00-22:00",
)
def commuter_clock(
    h3_index: str,
    db: Annotated[Session, Depends(get_db)],
    pengguna: PenggunaOpsional = None,
) -> CommuterClock:
    """Kapan uang benar-benar berpindah di lokasi ini, jam demi jam.

    Ini yang membedakannya dari data POI mana pun: dataset POI hanya menyimpan
    jam buka-tutup - kapan toko buka, bukan kapan transaksi terjadi. Jam di sini
    dibaca dari yang tercetak di struk (A2).

    Pemisahan captive dan choice rider:
      captive - tidak punya alternatif selain transit. Terikat jadwal, sehingga
                belanjanya menumpuk di jendela berangkat dan pulang yang sempit.
      choice  - punya kendaraan pribadi tetapi memilih transit. Waktunya lebih
                longgar, belanjanya lebih tersebar sepanjang hari.

    Bedanya penting bagi calon penyewa: lokasi yang didominasi captive rider ramai
    dua kali sehari dalam jendela pendek dan sepi di antaranya, sedangkan yang
    didominasi choice rider punya arus yang lebih rata. Jenis usaha yang cocok di
    keduanya tidak sama.
    """
    # Berbayar sejak 23 Agustus 2026 - keputusan pemilik repo. Grafik jam
    # per heksagon pindah ke kolom berbayar; ringkasan ember 4-slot yang di
    # respons detail tetap gratis.
    wajib_akses_penuh(db, pengguna, h3_index, "Commuter Clock per jam")
    hx = ambil_hex(db, h3_index)

    baris = db.execute(
        select(HexHourlyProfile)
        .where(HexHourlyProfile.h3_index == h3_index)
        .order_by(HexHourlyProfile.jam)
    ).scalars().all()
    per_jam = {b.jam: b for b in baris}

    # Setiap jam dalam rentang selalu dikirim, walau kosong. Grafik dengan sumbu
    # yang lengkap jauh lebih mudah dibaca daripada grafik yang jamnya meloncat,
    # dan jam kosong itu sendiri informasi: tidak ada transaksi tercatat di sana.
    titik = [
        TitikJam(
            jam=j,
            n_transaksi=per_jam[j].n_transaksi if j in per_jam else 0,
            nominal_total=per_jam[j].nominal_total if j in per_jam else None,
            nominal_median=per_jam[j].nominal_median if j in per_jam else None,
            pangsa_captive=per_jam[j].pangsa_captive if j in per_jam else None,
            pangsa_choice=(
                None
                if j not in per_jam or per_jam[j].pangsa_captive is None
                else round(1 - per_jam[j].pangsa_captive, 4)
            ),
            metode=per_jam[j].metode if j in per_jam else "proxy",  # type: ignore[arg-type]
        )
        for j in JAM_OPERASIONAL
    ]

    berisi = [t for t in titik if t.n_transaksi > 0]
    jam_puncak = max(berisi, key=lambda t: t.n_transaksi).jam if berisi else None

    # Pangsa captive harian ditimbang jumlah transaksi, bukan dirata-rata lugu:
    # jam dengan 2 transaksi tidak boleh sama beratnya dengan jam berisi 50.
    berbobot = [t for t in berisi if t.pangsa_captive is not None]
    total_n = sum(t.n_transaksi for t in berbobot)
    captive_harian = (
        round(sum(t.pangsa_captive * t.n_transaksi for t in berbobot) / total_n, 4)  # type: ignore[operator]
        if total_n
        else None
    )

    dominasi = None
    if captive_harian is not None:
        dominasi = (
            "captive" if captive_harian >= 0.6
            else "choice" if captive_harian <= 0.4
            else "seimbang"
        )

    semua_proxy = bool(baris) and all(b.metode == "proxy" for b in baris)
    catatan = None
    if not baris:
        # Ini dibaca PELANGGAN, di fitur yang ia bayar. Sebelumnya ia berbunyi
        # "jalankan pipeline s4_spatial" - instruksi untuk pengembang yang bocor
        # ke layar orang yang tidak punya pipeline untuk dijalankan. Yang
        # dibutuhkan pembacanya bukan perintah melainkan sebab.
        catatan = (
            "Pola jam dibaca dari waktu yang tercetak di struk. Struk survei MAPID "
            "tidak membawa kolom waktu - jamnya ada di dalam foto struknya, dan "
            "pembacaan otomatis foto itu belum dijalankan."
        )
    elif semua_proxy:
        catatan = (
            "Seluruh angka di sini hasil estimasi dari konteks heksagon, bukan dari jam "
            "yang tercetak di struk. Perlakukan sebagai pola kasar, bukan pengukuran."
        )

    return CommuterClock(
        h3_index=h3_index,
        jam=titik,
        ember={
            "pagi_06_09": hx.puncak_pagi,
            "siang_11_14": hx.puncak_siang,
            "sore_16_20": hx.puncak_sore,
            "malam_20_24": hx.puncak_malam,
        },
        jam_puncak=jam_puncak,
        pangsa_captive_harian=captive_harian,
        dominasi=dominasi,  # type: ignore[arg-type]
        keyakinan=badge(hx),
        catatan=catatan,
    )


@router.get(
    "/{h3_index}/simpul-terdekat",
    response_model=KonteksSimpul,
    summary="Rute jalan kaki dari satu heksagon ke stasiun terdekat",
)
@ber_cache("simpul", ttl=900)
def simpul_terdekat(
    h3_index: str,
    db: Annotated[Session, Depends(get_db)],
) -> KonteksSimpul:
    """Stasiun mana yang terdekat, lewat mana jalannya, berapa jauh, berapa menit.

    GRATIS dengan sengaja. Ini konteks peta, bukan kedalaman data: orang harus
    bisa tahu heksagon yang sedang dilihatnya itu dekat stasiun apa - dan
    seberapa benar "dekat" itu - sebelum memutuskan lokasinya layak dibayar
    untuk dibongkar.

    YANG DIKEMBALIKAN RUTE SUNGGUHAN, mengikuti jalan yang benar-benar ada.
    Geometrinya dihitung offline oleh `pipeline/rute_ors.py` lewat
    OpenRouteService dan tinggal di `hex_routes`; endpoint ini hanya membaca.
    Tidak ada panggilan jaringan di jalur permintaan - lihat alasannya di
    docstring `models.HexRoute`.

    Kalau heksagonnya belum pernah dirutekan, `rute` kosong dan jaraknya jatuh
    kembali ke GARIS LURUS dengan `garis_lurus=True`. Itu keadaan yang jujur,
    bukan kegagalan: yang tidak boleh terjadi adalah menggambar garis lurus lalu
    menyebutnya rute.

    Aman di-cache: isinya sama untuk siapa pun, dan hanya berubah kalau pipeline
    memindahkan simpul atau menghitung ulang rutenya.
    """
    hx = ambil_hex(db, h3_index)

    pusat = db.execute(
        select(
            func.ST_Y(func.ST_Centroid(HexFeature.geom)).label("lat"),
            func.ST_X(func.ST_Centroid(HexFeature.geom)).label("lon"),
        ).where(HexFeature.h3_index == h3_index)
    ).one()

    # `<->` memakai indeks GiST, jadi ini tetap murah walau simpulnya nanti
    # jadi 150. ST_Distance dihitung di geography supaya satuannya meter
    # sungguhan, bukan derajat.
    baris = db.execute(
        text(
            """
            SELECT n.id, n.nama, n.moda, n.kawasan,
                   ST_Y(n.geom) AS lat, ST_X(n.geom) AS lon,
                   ST_Distance(n.geom::geography, ST_Centroid(h.geom)::geography) AS jarak
            FROM transport_nodes n, hex_features h
            WHERE h.h3_index = :h3
            ORDER BY n.geom <-> ST_Centroid(h.geom)
            LIMIT 1
            """
        ),
        {"h3": h3_index},
    ).mappings().first()

    if baris is None:
        return KonteksSimpul(
            h3_index=h3_index,
            lat=pusat.lat,
            lon=pusat.lon,
            catatan=(
                "Belum ada simpul transportasi di basis data, jadi jaraknya belum "
                "bisa dihitung."
            ),
        )

    lurus = round(float(baris["jarak"]))
    simpul = SimpulTransit(
        id=baris["id"],
        nama=baris["nama"],
        moda=baris["moda"],
        kawasan=baris["kawasan"],
        lat=baris["lat"],
        lon=baris["lon"],
    )

    # ST_AsGeoJSON dipakai supaya PostGIS yang mengurai geometrinya, bukan kita.
    # Presisi dipotong ke 5 desimal: itu ~1,1 meter di khatulistiwa, jauh lebih
    # halus daripada yang bisa dibedakan mata pada zoom mana pun, dan memotong
    # ukuran responsnya hampir separuh.
    rute_baris = db.execute(
        text(
            """
            SELECT urutan, jarak_m, menit, ST_AsGeoJSON(geom, 5) AS geojson
            FROM hex_routes
            WHERE h3_index = :h3
            ORDER BY urutan
            """
        ),
        {"h3": h3_index},
    ).mappings().all()

    rute = [
        RuteJalan(
            urutan=r["urutan"],
            jarak_m=round(float(r["jarak_m"])),
            menit=round(float(r["menit"]), 1),
            utama=r["urutan"] == 0,
            koordinat=json.loads(r["geojson"])["coordinates"],
        )
        for r in rute_baris
    ]

    if not rute:
        return KonteksSimpul(
            h3_index=h3_index,
            lat=pusat.lat,
            lon=pusat.lon,
            simpul=simpul,
            jarak_m=lurus,
            menit_jalan=menit_jalan(lurus),
            jarak_lurus_m=lurus,
            garis_lurus=True,
            catatan=(
                f"Garis lurus ke {baris['nama']}. Rute jalan kaki yang sebenarnya "
                "lebih panjang karena mengikuti jalan - heksagon ini belum "
                "dirutekan."
            ),
        )

    utama = rute[0]
    memutar = faktor_memutar(utama.jarak_m, lurus)

    # Kalimatnya menyebut angka yang paling berguna lebih dulu, dan menambahkan
    # peringatan HANYA kalau memang ada yang perlu diperingatkan. Catatan yang
    # selalu berisi peringatan berhenti dibaca sebagai peringatan.
    catatan = f"{utama.menit:.0f} menit jalan kaki ke {baris['nama']}, lewat jalan yang ada."
    if memutar and memutar >= MEMUTAR_MENCOLOK:
        catatan += (
            f" Jalurnya memutar {memutar:.1f}x dari jarak lurusnya"
            f" ({lurus} m) - ada yang menghalangi jalan langsungnya."
        )
    if len(rute) > 1:
        catatan += f" {len(rute) - 1} jalur alternatif tersedia."

    return KonteksSimpul(
        h3_index=h3_index,
        lat=pusat.lat,
        lon=pusat.lon,
        simpul=simpul,
        jarak_m=utama.jarak_m,
        menit_jalan=utama.menit,
        jarak_lurus_m=lurus,
        faktor_memutar=memutar,
        rute=rute,
        garis_lurus=False,
        catatan=catatan,
    )


@router.get(
    "/{h3_index}/simulasi",
    response_model=Simulasi,
    summary="Simulasi kelayakan usaha di satu heksagon",
)
def simulasi_heksagon(
    h3_index: str,
    db: Annotated[Session, Depends(get_db)],
    pengguna: PenggunaOpsional = None,
    jenis_usaha: Annotated[str, Query()] = "kuliner_ringan",
    jam_buka: Annotated[int, Query(ge=1, le=24)] = JAM_BUKA_BAWAAN,
    luas_m2: Annotated[int, Query(ge=1, le=500)] = LUAS_BAWAAN_M2,
    pangsa_persen: Annotated[float, Query(gt=0, le=100)] = PANGSA_BAWAAN,
    margin_persen: Annotated[float, Query(gt=0, le=100)] = MARGIN_BAWAAN,
    # Keduanya OPSIONAL dan tanpa nilai bawaan. Bawaan apa pun di sini akan
    # jadi angka karangan yang menyamar jadi hitungan - persis yang dihindari
    # seluruh modul simulasi. Kosong berarti "belum diisi", dan simulasi jatuh
    # ke angka heksagon kalau ada.
    sewa_bulanan_diminta: Annotated[float | None, Query(ge=0, le=5_000_000_000)] = None,
    harga_rata_rata: Annotated[float | None, Query(ge=0, le=100_000_000)] = None,
    versi: str = "baseline",
) -> Simulasi:
    """Skenario "kalau saya buka usaha di sini".

    BUKAN skor dan BUKAN ramalan - lihat docstring `core/simulasi.py`. Yang
    dihitung di sini tidak pernah tersimpan, tidak pernah ikut memeringkat, dan
    tidak mengubah satu pun kuadran.

    Heksagon berzona terlarang TETAP dilayani, dan itu disengaja. Endpoint ini
    bukan jalur rekomendasi - pengguna sudah memilih heksagonnya sendiri, dan
    menolak menghitungnya hanya akan menyembunyikan alasan kenapa lokasi itu
    buruk. Yang dikirim adalah hitungannya PLUS peringatan zona di paling atas.
    """
    wajib_akses_penuh(db, pengguna, h3_index, "Simulasi usaha")
    if jenis_usaha not in JENIS_USAHA:
        raise KesalahanAPI(
            f"Jenis usaha '{jenis_usaha}' tidak dikenal.",
            {"tersedia": sorted(JENIS_USAHA)},
        )

    hx = ambil_hex(db, h3_index)
    sc = db.execute(
        select(LocationScore).where(
            LocationScore.h3_index == h3_index, LocationScore.versi == versi
        )
    ).scalar_one_or_none()

    b = badge(hx)
    hasil = hitung_simulasi(
        variabel={nama: getattr(hx, nama) for nama in SEMUA_VARIABEL},
        indeks_kompetisi=getattr(sc, "ikp", None),
        indeks_churn=hx.indeks_churn,
        zona_izin=hx.zona_izin_komersial,
        keyakinan=b.tingkat,
        jenis_usaha=jenis_usaha,
        jam_buka=jam_buka,
        luas_m2=luas_m2,
        pangsa_persen=pangsa_persen,
        margin_persen=margin_persen,
        sewa_bulanan_diminta=sewa_bulanan_diminta,
        harga_rata_rata=harga_rata_rata,
    )

    # Profil jam penuh: dipakai grafik batang di panel simulasi, DAN dipakai
    # menentukan tiga jam tersibuk. Satu kueri, bukan dua.
    baris_jam = db.execute(
        select(HexHourlyProfile)
        .where(HexHourlyProfile.h3_index == h3_index)
        .order_by(HexHourlyProfile.jam)
    ).scalars().all()

    puncak = max((r.nominal_total or 0) for r in baris_jam) if baris_jam else 0
    profil = [
        JamSimulasi(
            jam=r.jam,
            # Dinormalkan ke jam tersibuk, bukan ke rupiah mutlak: yang dicari
            # pembaca grafik ini "jam berapa paling ramai", bukan "berapa rupiah".
            relatif=((r.nominal_total or 0) / puncak) if puncak else 0.0,
            pangsa_captive=r.pangsa_captive,
        )
        for r in baris_jam
    ]
    jam = [
        r.jam
        for r in sorted(baris_jam, key=lambda r: r.nominal_total or 0, reverse=True)[:3]
    ]

    return Simulasi(
        h3_index=hx.h3_index,
        kawasan=hx.kawasan,
        masukan=hasil["masukan"],
        sumber=hasil["sumber"],
        terukur=hasil["terukur"],
        hasil=hasil["hasil"],
        rumus=hasil["rumus"],
        peringatan=hasil["peringatan"],
        sensitivitas=hasil["sensitivitas"],
        keyakinan=b,
        jam_teramai=sorted(int(j) for j in jam),
        profil_jam=profil,
        lingkungan=LingkunganSimulasi(
            populasi_100m=hx.pop_100m,
            populasi_usia_produktif=hx.pop_usia_produktif,
            n_kompetitor_langsung=hx.n_kompetitor_langsung,
            keragaman_kuliner=hx.keragaman_kuliner,
            n_menetap_kuliner=hx.n_menetap_kuliner,
            jarak_simpul_m=hx.jarak_simpul_m,
            waktu_jalan_menit=hx.waktu_jalan_menit,
            skor_simpul=hx.skor_simpul,
            ridership_proksi=hx.ridership_proksi,
            kepadatan_poi_total=hx.kepadatan_poi_total,
            kepadatan_kantor=hx.kepadatan_kantor,
            kepadatan_kos=hx.kepadatan_kos,
            rasio_weekend=hx.rasio_weekend,
        ),
    )


@router.get("/{h3_index}", response_model=DetailHeksagon, summary="Detail satu heksagon")
def detail_heksagon(
    h3_index: str,
    db: Annotated[Session, Depends(get_db)],
    pengguna: PenggunaOpsional = None,
    versi: str = "baseline",
) -> DetailHeksagon:
    """Isi panel insight saat heksagon diklik. Juga sumber jawaban jelaskan_skor().

    SATU RESPONS, DUA ISI. Yang gratis - skor, kuadran, Commuter Clock,
    ZoneGuard, RiskRadar, keempat indeks - selalu ikut. Yang berbayar - 43
    variabel granular dan rincian kontribusi tiap variabel ke skor - hanya ikut
    kalau pemanggilnya berlangganan atau sudah membuka heksagon ini dengan token.

    Yang ditahan TIDAK dikirim lalu diburamkan di frontend. Buram itu lapisan
    CSS; siapa pun yang membuka panel pengembang bisa mencabutnya, dan yang
    tersisa di baliknya adalah data lengkap yang tidak pernah dibayar. Yang
    ditahan di sini tidak pernah meninggalkan server.

    `terkunci` memberi tahu antarmuka bagian mana yang ditahan, jadi tirainya
    digambar dari keadaan backend yang sebenarnya - bukan dari tebakan frontend
    tentang siapa yang sedang masuk.
    """
    hx = ambil_hex(db, h3_index)

    if pengguna is None:
        tingkat_akun = "tamu"
        boleh_penuh = False
    elif langganan_aktif(db, pengguna):
        tingkat_akun = "premium"
        boleh_penuh = True
    else:
        tingkat_akun = "gratis"
        # Akun gratis yang sudah membelanjakan token untuk heksagon INI tetap
        # mendapat isi penuhnya. Ia sudah membayar; yang dibayar tidak boleh
        # hilang hanya karena ia belum berlangganan bulanan.
        boleh_penuh = sudah_terbuka(db, pengguna, h3_index)

    terkunci: list[str] = [] if boleh_penuh else ["variabel", "faktor"]

    skor = db.execute(
        select(LocationScore).where(
            LocationScore.h3_index == h3_index, LocationScore.versi == versi
        )
    ).scalar_one_or_none()

    faktor = db.execute(
        select(ScoreFactor)
        .where(ScoreFactor.h3_index == h3_index, ScoreFactor.versi == versi)
        .order_by(ScoreFactor.kontribusi.desc().nullslast())
    ).scalars().all()

    p75, p90 = persentil_churn(db, hx.kawasan)

    return DetailHeksagon(
        skor=skor_heksagon(hx, skor),
        indeks=IndeksKomposit(
            ipt=skor.ipt if skor else None,
            iae=skor.iae if skor else None,
            ikp=skor.ikp if skor else None,
            ibr=skor.ibr if skor else None,
            # Diturunkan dari `faktor`, yang sudah dimuat di atas apa pun tingkat
            # akunnya. Ini keterangan MUTU, bukan isi berbayar: ia menyebut
            # berapa bahan yang terukur, tidak menyebut satu pun nilainya.
            cakupan=cakupan_indeks(faktor),
        ),
        variabel=(
            {nama: getattr(hx, nama) for kolom in DIMENSI.values() for nama in kolom}
            if boleh_penuh
            else {}
        ),
        faktor=(
            [
                FaktorSkor(
                    kode_variabel=f.kode_variabel,
                    indeks=f.indeks,  # type: ignore[arg-type]
                    nilai_mentah=f.nilai_mentah,
                    nilai_normalisasi=f.nilai_normalisasi,
                    persentil=f.persentil,
                    kontribusi=f.kontribusi,
                )
                for f in faktor
            ]
            if boleh_penuh
            else []
        ),
        terkunci=terkunci,
        tingkat_akun=tingkat_akun,
        commuter_clock={
            "pagi_06_09": hx.puncak_pagi,
            "siang_11_14": hx.puncak_siang,
            "sore_16_20": hx.puncak_sore,
            "malam_20_24": hx.puncak_malam,
        },
        zoneguard=zoneguard(hx),
        risiko=peringatan_risiko(hx, p75, p90),
        kuadran_penjelasan=(
            PENJELASAN_KUADRAN.get(skor.kuadran) if skor and skor.kuadran else None
        ),
    )
