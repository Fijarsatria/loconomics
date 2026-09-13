"""Endpoint heksagon - sumber data utama untuk peta dan panel insight.

Catatan arsitektur: tidak ada endpoint yang menyajikan POI, menu, struk, atau
properti satu per satu. Semuanya hanya keluar sebagai agregat per heksagon,
karena ketentuan lomba melarang data misi MAPID mentah diekspos ke publik.
"""

import json

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.akun import (
    PenggunaOpsional,
    langganan_aktif,
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
    KELAS_USAHA,
    KODE_PERKIRAAN,
    MEMUTAR_MENCOLOK,
    BAHASA_BAWAAN,
    Bahasa,
    PENJELASAN_KUADRAN,
    PENJELASAN_KUADRAN_EN,
    JENIS_KE_KELAS,
    alasan_blok,
    kalimat,
    kontribusi_blok,
    kalimat_perkiraan,
    pilih,
    cakupan_indeks,
    cakupan_prestise,
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
from app.models import (
    BlokHeksagon,
    HexFeature,
    HexHourlyProfile,
    HexPerkiraan,
    LocationScore,
    ScoreFactor,
)
from app.schemas import (
    BlokSimulasi,
    BedahBlok,
    BlokDalamHeksagon,
    CakupanPrestise,
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
    PerkiraanHeksagon,
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
    bahasa: Annotated[Bahasa, Query(description="Bahasa kalimat: id atau en")] = BAHASA_BAWAAN,
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
        catatan = kalimat("jam_tanpa_baris", bahasa)
    elif semua_proxy:
        catatan = kalimat("jam_semua_proxy", bahasa)

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
    "/{h3_index}/blok",
    response_model=BedahBlok,
    summary="Tujuh blok di dalam satu heksagon, dibandingkan berdampingan",
)
@ber_cache("blok", ttl=900)
def blok_heksagon(
    h3_index: str,
    db: Annotated[Session, Depends(get_db)],
    kelas: Annotated[
        str | None,
        Query(description="Kelas induk usaha (F1, F2, R1, R2, S1, S2, K1, T1). Kosong = skor umum."),
    ] = None,
    bahasa: Annotated[Bahasa, Query(description="Bahasa kalimat: id atau en")] = BAHASA_BAWAAN,
) -> BedahBlok:
    """Jawaban untuk "di dalam heksagon yang sudah saya pilih, sisi mana yang layak?".

    GRATIS dan aman di-cache: isinya sama untuk siapa pun, seluruhnya dari data
    terbuka, dan hanya berubah saat pipeline dijalankan (`s7_publish --blok`).
    Kelas dan bahasa ikut jadi kunci cache karena keduanya parameter.

    Blok berzona terlarang TETAP dikirim - berskor 0 dan berperingatan - supaya
    orang melihat bahwa sisi itu dikecualikan dan kenapa, bukan cuma melihat
    enam blok dan bertanya ke mana yang ketujuh.
    """
    if kelas is not None and kelas not in KELAS_USAHA:
        raise KesalahanAPI(
            f"Kelas usaha '{kelas}' tidak dikenal.", {"tersedia": sorted(KELAS_USAHA)}
        )
    hx = ambil_hex(db, h3_index)

    baris = db.execute(
        select(BlokHeksagon, func.ST_AsGeoJSON(BlokHeksagon.geom, 6).label("gj"))
        .where(BlokHeksagon.h3_induk == h3_index)
    ).all()

    simpul = db.execute(
        text(
            """
            SELECT n.nama FROM transport_nodes n, hex_features h
            WHERE h.h3_index = :h3
            ORDER BY n.geom <-> ST_Centroid(h.geom) LIMIT 1
            """
        ),
        {"h3": h3_index},
    ).scalar()

    mentah = [
        {
            **{k: getattr(b, k) for k in (
                "h3_blok", "lat", "lon", "menit_jalan", "jarak_jalan_m", "jarak_jalan_utama_m",
                "nama_jalan_utama", "kelas_jalan_utama", "n_usaha_150m", "usaha_per_kelas_150m",
                "n_penarik_250m", "penarik_250m", "jarak_halte_m", "n_bangunan",
                "rasio_tutupan_bangunan", "izin_komersial", "kelas_zona", "pangsa_zona_usaha",
                "risiko_banjir", "skor_blok", "skor_per_kelas", "kontribusi",
                "peringkat_induk",
            )},
            "koordinat": json.loads(gj)["coordinates"][0],
        }
        for b, gj in baris
    ]
    # Urutan tampil = skor pipeline untuk kelas yang diminta. Mengurutkan skor
    # yang sudah jadi bukan menghitung skor (aturan 1): angkanya tetap milik s6.
    skor_dari = (lambda m: (m["skor_per_kelas"] or {}).get(kelas)) if kelas else (lambda m: m["skor_blok"])
    urut = sorted(mentah, key=lambda m: (skor_dari(m) is None, -(skor_dari(m) or 0), m["h3_blok"]))

    blok: list[BlokDalamHeksagon] = []
    peringkat = 0
    skor_sebelum: float | None = None
    for i, m in enumerate(urut, 1):
        s = skor_dari(m)
        # Skor sama -> peringkat sama (metode "min"), persis seperti
        # `peringkat_induk` yang dihitung pipeline.
        if s is None or s != skor_sebelum:
            peringkat = i
        skor_sebelum = s
        alasan, peringatan = alasan_blok(m, mentah, simpul, kelas, bahasa)
        blok.append(
            BlokDalamHeksagon(
                h3_blok=m["h3_blok"],
                peringkat=peringkat,
                skor=s,
                skor_umum=m["skor_blok"],
                lat=m["lat"],
                lon=m["lon"],
                koordinat=m["koordinat"],
                menit_jalan=m["menit_jalan"],
                jarak_jalan_m=m["jarak_jalan_m"],
                jarak_jalan_utama_m=m["jarak_jalan_utama_m"],
                nama_jalan_utama=m["nama_jalan_utama"],
                kelas_jalan_utama=m["kelas_jalan_utama"],
                n_usaha_150m=m["n_usaha_150m"],
                n_pesaing_150m=(int((m["usaha_per_kelas_150m"] or {}).get(kelas, 0)) if kelas else None),
                usaha_per_kelas_150m=m["usaha_per_kelas_150m"] or {},
                n_penarik_250m=m["n_penarik_250m"],
                penarik_250m=m["penarik_250m"] or {},
                jarak_halte_m=m["jarak_halte_m"],
                n_bangunan=m["n_bangunan"],
                rasio_tutupan_bangunan=m["rasio_tutupan_bangunan"],
                izin_komersial=m["izin_komersial"],
                kelas_zona=m["kelas_zona"],
                pangsa_zona_usaha=m["pangsa_zona_usaha"],
                risiko_banjir=m["risiko_banjir"],
                alasan=alasan,
                peringatan=peringatan,
                kontribusi=kontribusi_blok(m["kontribusi"], bahasa),
            )
        )

    return BedahBlok(
        h3_index=h3_index,
        kawasan=hx.kawasan,
        kelas=kelas,
        kelas_tersedia={k: (en if bahasa == "en" else id_) for k, (id_, en) in KELAS_USAHA.items()},
        nama_simpul=simpul,
        blok=blok,
        keyakinan=badge(hx),
        catatan=kalimat("blok_catatan", bahasa),
    )


#: Kata kerja tiap profil di kalimat catatan. Satu tabel, bukan ternary di dua
#: tempat: ternary dua cabang yang dulu berdiri di sini akan diam-diam menyebut
#: rute sepeda "jalan kaki", karena cabang `else`-nya menangkap apa pun yang
#: bukan mobil. Profil yang tidak ada di tabel ini gagal KERAS (KeyError),
#: dan `Literal` di parameter endpoint menjaga pintunya lebih dulu.
KUNCI_CARA = {
    "foot-walking": "simpul_cara_kaki",
    "driving-car": "simpul_cara_mobil",
    "cycling-regular": "simpul_cara_sepeda",
}


@router.get(
    "/{h3_index}/simpul-terdekat",
    response_model=KonteksSimpul,
    summary="Rute jalan kaki dari satu heksagon ke stasiun terdekat",
)
@ber_cache("simpul", ttl=900)
def simpul_terdekat(
    h3_index: str,
    db: Annotated[Session, Depends(get_db)],
    profil: Annotated[
        Literal["foot-walking", "driving-car", "cycling-regular"],
        Query(description="Profil rute. Motor tidak ada di ORS; sepeda ada."),
    ] = "foot-walking",
    bahasa: Annotated[Bahasa, Query(description="Bahasa kalimat: id atau en")] = BAHASA_BAWAAN,
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
            catatan=kalimat("simpul_kosong", bahasa),
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
            SELECT urutan, jarak_m, menit, profil, ST_AsGeoJSON(geom, 5) AS geojson
            FROM hex_routes
            WHERE h3_index = :h3 AND profil = :profil
            ORDER BY urutan
            """
        ),
        {"h3": h3_index, "profil": profil},
    ).mappings().all()

    # Profil apa saja yang PUNYA baris untuk heksagon ini. Dikirim supaya
    # antarmuka tidak menawarkan tombol yang isinya kosong - rute mobil ditarik
    # terpisah dan mungkin belum pernah dijalankan sama sekali.
    tersedia = [
        r[0]
        for r in db.execute(
            text("SELECT DISTINCT profil FROM hex_routes WHERE h3_index = :h3 ORDER BY profil"),
            {"h3": h3_index},
        ).all()
    ]

    rute = [
        RuteJalan(
            urutan=r["urutan"],
            jarak_m=round(float(r["jarak_m"])),
            menit=round(float(r["menit"]), 1),
            utama=r["urutan"] == 0,
            profil=r["profil"],
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
            profil=profil,
            profil_tersedia=tersedia,
            garis_lurus=True,
            catatan=kalimat(
                "simpul_lurus",
                bahasa,
                nama=baris["nama"],
                cara=kalimat(KUNCI_CARA[profil], bahasa),
            ),
        )

    utama = rute[0]
    memutar = faktor_memutar(utama.jarak_m, lurus)

    # Kalimatnya menyebut angka yang paling berguna lebih dulu, dan menambahkan
    # peringatan HANYA kalau memang ada yang perlu diperingatkan. Catatan yang
    # selalu berisi peringatan berhenti dibaca sebagai peringatan.
    cara = kalimat(KUNCI_CARA[profil], bahasa)
    catatan = kalimat(
        "simpul_rute", bahasa, menit=f"{utama.menit:.0f}", cara=cara, nama=baris["nama"]
    )
    if memutar and memutar >= MEMUTAR_MENCOLOK:
        catatan += kalimat("simpul_memutar", bahasa, faktor=f"{memutar:.1f}", lurus=lurus)
    if len(rute) > 1:
        catatan += kalimat("simpul_alternatif", bahasa, n=len(rute) - 1)

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
        profil=profil,
        profil_tersedia=tersedia,
        garis_lurus=False,
        catatan=catatan,
    )


#: Batas faktor permintaan blok. Sempit dengan sengaja: yang diketahui cuma
#: bahwa satu sisi heksagon LEBIH BAIK dari sisi lain, bukan berapa kali lipat
#: uang yang lewat di depannya. Tanpa batas, blok terbaik di heksagon yang
#: ketujuh bloknya jomplang akan "menghasilkan" tiga kali omzet heksagonnya.
FAKTOR_BLOK_MIN = 0.6
FAKTOR_BLOK_MAKS = 1.4


def _persempit_ke_blok(db, h3_index, h3_blok, jenis_usaha, variabel, zona_izin):
    """Angka heksagon -> angka satu blok. Mengembalikan (blok, variabel, zona).

    Yang disesuaikan HANYA belanja per jam - satu-satunya besaran yang wajar
    berbeda antar-sisi heksagon dan tidak diukur per blok. Sewa dan harga
    struk tidak disentuh: tidak ada dasar untuk menebak bahwa ruko di tepi
    jalan utama lebih mahal PERSIS sekian persen.

    Skor pembandingnya skor KELAS usaha kalau jenisnya punya kelas - pesaing
    sekelas ikut menurunkan peringkatnya, dan itu yang relevan untuk usaha
    yang sedang disimulasikan - dan skor umum kalau tidak.
    """
    from app.core.galat import TidakDitemukan

    saudara = db.execute(
        select(BlokHeksagon).where(BlokHeksagon.h3_induk == h3_index)
    ).scalars().all()
    target = next((s for s in saudara if s.h3_blok == h3_blok), None)
    if target is None:
        raise TidakDitemukan(
            "Blok itu tidak ada di dalam heksagon ini.",
            {"h3_index": h3_index, "h3_blok": h3_blok},
        )

    kelas = JENIS_KE_KELAS.get(jenis_usaha)

    def skor(s):
        if kelas and isinstance(s.skor_per_kelas, dict) and s.skor_per_kelas.get(kelas) is not None:
            return float(s.skor_per_kelas[kelas])
        return None if s.skor_blok is None else float(s.skor_blok)

    nilai = [v for v in (skor(s) for s in saudara) if v is not None]
    rata = sum(nilai) / len(nilai) if nilai else None
    sk = skor(target)
    berlaku = sk is not None and rata is not None and rata > 0
    faktor = (
        min(FAKTOR_BLOK_MAKS, max(FAKTOR_BLOK_MIN, sk / rata)) if berlaku else 1.0
    )

    variabel = dict(variabel)
    if variabel.get("belanja_per_jam") is not None:
        variabel["belanja_per_jam"] = float(variabel["belanja_per_jam"]) * faktor

    pesaing = None
    if kelas and isinstance(target.usaha_per_kelas_150m, dict):
        pesaing = target.usaha_per_kelas_150m.get(kelas)

    blok = BlokSimulasi(
        h3_blok=target.h3_blok,
        peringkat=target.peringkat_induk,
        nama_jalan_utama=target.nama_jalan_utama,
        skor_blok=None if sk is None else round(sk, 1),
        rata_skor_heksagon=None if rata is None else round(rata, 1),
        faktor_permintaan=round(faktor, 3),
        faktor_berlaku=berlaku,
        menit_jalan=target.menit_jalan,
        jarak_jalan_utama_m=target.jarak_jalan_utama_m,
        n_pesaing_150m=pesaing,
        izin_komersial=target.izin_komersial,
        kelas_zona=target.kelas_zona,
    )
    # Zona BLOK menang atas zona heksagon kalau diketahui: satu heksagon bisa
    # memuat blok berzona perdagangan dan blok berzona perumahan sekaligus.
    return blok, variabel, (target.izin_komersial if target.izin_komersial is not None else zona_izin)


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
    h3_blok: Annotated[
        str | None,
        Query(description="Persempit ke satu blok res-10 di dalam heksagon ini"),
    ] = None,
    versi: str = "baseline",
    bahasa: Annotated[Bahasa, Query(description="Bahasa kalimat: id atau en")] = BAHASA_BAWAAN,
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
    variabel = {nama: getattr(hx, nama) for nama in SEMUA_VARIABEL}
    zona_izin = hx.zona_izin_komersial
    blok_sim = None
    if h3_blok:
        blok_sim, variabel, zona_izin = _persempit_ke_blok(
            db, h3_index, h3_blok, jenis_usaha, variabel, zona_izin
        )

    hasil = hitung_simulasi(
        variabel=variabel,
        indeks_kompetisi=getattr(sc, "ikp", None),
        indeks_churn=hx.indeks_churn,
        zona_izin=zona_izin,
        keyakinan=b.tingkat,
        jenis_usaha=jenis_usaha,
        jam_buka=jam_buka,
        luas_m2=luas_m2,
        pangsa_persen=pangsa_persen,
        margin_persen=margin_persen,
        sewa_bulanan_diminta=sewa_bulanan_diminta,
        harga_rata_rata=harga_rata_rata,
        bahasa=bahasa,
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

    rumus = dict(hasil["rumus"])
    if blok_sim is not None:
        rumus["faktor_permintaan"] = (
            "skor blok ÷ rata-rata skor ketujuh blok, dibatasi "
            f"{FAKTOR_BLOK_MIN:g}–{FAKTOR_BLOK_MAKS:g}; mengalikan belanja per jam"
        )

    return Simulasi(
        h3_index=hx.h3_index,
        kawasan=hx.kawasan,
        blok=blok_sim,
        masukan=hasil["masukan"],
        sumber=hasil["sumber"],
        terukur=hasil["terukur"],
        hasil=hasil["hasil"],
        rumus=rumus,
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
    bahasa: Annotated[Bahasa, Query(description="Bahasa kalimat: id atau en")] = BAHASA_BAWAAN,
) -> DetailHeksagon:
    """Isi panel insight saat heksagon diklik. Juga sumber jawaban jelaskan_skor().

    SATU RESPONS, DUA ISI. Yang gratis - skor, kuadran, Commuter Clock,
    ZoneGuard, RiskRadar - selalu ikut. Yang berbayar - 43 variabel granular,
    rincian kontribusi tiap variabel ke skor, NILAI keempat indeks, dan kalimat
    penjelasan kuadran - hanya ikut kalau pemanggilnya berlangganan atau sudah
    membuka heksagon ini dengan token.

    KEEMPAT INDEKS DAN PENJELASAN KUADRAN PINDAH KE SISI BERBAYAR 11 Sep 2026,
    keputusan pemilik repo. Keduanya menjawab "kenapa angkanya segitu", dan itu
    pertanyaan yang sama dengan yang sudah dijawab bagian berbayar di bawahnya -
    memberikannya gratis di satu tempat dan menagihnya di tempat lain membuat
    batas berbayarnya tidak bisa diterangkan ke siapa pun.

    YANG TETAP GRATIS meski keduanya ditahan: `cakupan` dan `cakupan_prestise`.
    Keduanya keterangan MUTU - berapa bahan sebuah indeks yang benar-benar
    terukur, dan bahan mana yang menyusun sumbu prestise - dan tidak memuat satu
    pun nilai. Menahannya berarti menahan pengakuan bahwa datanya tipis, dan
    pengakuan tidak boleh pernah jadi barang dagangan.

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
        # Akun gratis = hak tamu. Jalur token satuan dihapus 13 Sep 2026.
        boleh_penuh = False

    terkunci: list[str] = (
        [] if boleh_penuh else ["variabel", "faktor", "indeks", "kuadran", "perkiraan"]
    )

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

    # PERKIRAAN. Diminta hanya kalau boleh dikirim - sebuah kueri yang hasilnya
    # sudah pasti dibuang cuma membebani basis data untuk tiap tamu yang
    # mengklik heksagon.
    perkiraan: list[PerkiraanHeksagon] = []
    if boleh_penuh:
        for baris in db.execute(
            select(HexPerkiraan).where(HexPerkiraan.h3_index == h3_index)
        ).scalars():
            rincian = baris.rincian or {}
            kolom = KODE_PERKIRAAN.get(baris.kode)
            if kolom is None:
                # Kode yang tidak kita kenal DILEWATI, bukan dikirim apa adanya.
                # Antarmuka menamai perkiraan lewat nama kolomnya; kode tanpa
                # kolom akan tampil sebagai baris tanpa nama.
                continue
            perkiraan.append(
                PerkiraanHeksagon(
                    kode=baris.kode,
                    kolom=kolom,
                    nilai=baris.nilai,
                    metode=baris.metode,
                    keterangan=kalimat_perkiraan(baris.kode, baris.metode, rincian, bahasa),
                    n_sumber=baris.n_sumber,
                    mutu=rincian,
                )
            )
        perkiraan.sort(key=lambda p: p.kode)

    p75, p90 = persentil_churn(db, hx.kawasan)

    return DetailHeksagon(
        skor=skor_heksagon(hx, skor),
        indeks=IndeksKomposit(
            # Nilainya DITAHAN untuk yang belum membayar, tidak dikirim lalu
            # diburamkan. Buram itu lapisan CSS; siapa pun yang membuka panel
            # pengembang bisa mencabutnya.
            ipt=skor.ipt if (skor and boleh_penuh) else None,
            iae=skor.iae if (skor and boleh_penuh) else None,
            ikp=skor.ikp if (skor and boleh_penuh) else None,
            ibr=skor.ibr if (skor and boleh_penuh) else None,
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
        zoneguard=zoneguard(hx, bahasa),
        risiko=peringatan_risiko(hx, p75, p90, bahasa),
        kuadran_penjelasan=(
            pilih(PENJELASAN_KUADRAN, PENJELASAN_KUADRAN_EN, bahasa).get(skor.kuadran)
            if (skor and skor.kuadran and boleh_penuh)
            else None
        ),
        # Alasannya sama dengan `cakupan` di atas, dan taruhannya lebih besar:
        # kuadran adalah tesis produk ini, dan sumbu datarnya berdiri di atas
        # bahan yang dua di antaranya kosong di SELURUH wilayah studi. Yang
        # dikirim daftar kodenya saja - tidak satu pun nilai, jadi ia tetap di
        # sisi gratis bersama kuadrannya sendiri.
        cakupan_prestise=CakupanPrestise(**cakupan_prestise([hx])),  # type: ignore[arg-type]
        perkiraan=perkiraan,
    )
