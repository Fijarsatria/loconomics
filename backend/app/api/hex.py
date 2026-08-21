"""Endpoint heksagon - sumber data utama untuk peta dan panel insight.

Catatan arsitektur: tidak ada endpoint yang menyajikan POI, menu, struk, atau
properti satu per satu. Semuanya hanya keluar sebagai agregat per heksagon,
karena ketentuan lomba melarang data misi MAPID mentah diekspos ke publik.
"""

import json

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.bersama import (
    DIMENSI,
    ambil_hex,
    badge,
    peringatan_risiko,
    periksa_kawasan,
    persentil_churn,
    skor_heksagon,
    zoneguard,
)
from app.core.aturan import JAM_OPERASIONAL, PENJELASAN_KUADRAN
from app.core.cache import ber_cache
from app.core.galat import KesalahanAPI
from app.core.database import get_db
from app.models import HexFeature, HexHourlyProfile, LocationScore, ScoreFactor
from app.schemas import (
    CommuterClock,
    DetailHeksagon,
    FaktorSkor,
    IndeksKomposit,
    TitikJam,
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
    kawasan: Annotated[str | None, Query(description="Filter salah satu dari 6 kawasan pilot")] = None,
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
    kawasan = periksa_kawasan(kawasan)
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
    if kawasan:
        stmt = stmt.where(HexFeature.kawasan == kawasan)
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
def commuter_clock(h3_index: str, db: Annotated[Session, Depends(get_db)]) -> CommuterClock:
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
        catatan = "Belum ada profil jam untuk heksagon ini - jalankan pipeline s4_spatial."
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


@router.get("/{h3_index}", response_model=DetailHeksagon, summary="Detail satu heksagon")
def detail_heksagon(
    h3_index: str, db: Annotated[Session, Depends(get_db)], versi: str = "baseline"
) -> DetailHeksagon:
    """Isi panel insight saat heksagon diklik. Juga sumber jawaban jelaskan_skor()."""
    hx = ambil_hex(db, h3_index)

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
        ),
        variabel={nama: getattr(hx, nama) for kolom in DIMENSI.values() for nama in kolom},
        faktor=[
            FaktorSkor(
                kode_variabel=f.kode_variabel,
                indeks=f.indeks,  # type: ignore[arg-type]
                nilai_mentah=f.nilai_mentah,
                nilai_normalisasi=f.nilai_normalisasi,
                persentil=f.persentil,
                kontribusi=f.kontribusi,
            )
            for f in faktor
        ],
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
