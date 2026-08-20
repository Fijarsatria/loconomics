"""Endpoint heksagon - sumber data utama untuk peta dan panel insight.

Catatan arsitektur: tidak ada endpoint yang menyajikan POI, menu, struk, atau
properti satu per satu. Semuanya hanya keluar sebagai agregat per heksagon,
karena ketentuan lomba melarang data misi MAPID mentah diekspos ke publik.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import HexFeature, LocationScore, ScoreFactor
from app.schemas import (
    BadgeKeyakinan,
    DetailHeksagon,
    FaktorSkor,
    IndeksKomposit,
    SkorHeksagon,
)

router = APIRouter(prefix="/hex", tags=["heksagon"])

# 41 variabel analisis, dikelompokkan sesuai Kamus Data Final (docs/data.md).
DIMENSI: dict[str, list[str]] = {
    "permintaan": [
        "pop_100m", "pop_usia_produktif", "jarak_simpul_m", "waktu_jalan_menit",
        "skor_simpul", "ridership_proksi", "kepadatan_kos", "kepadatan_kantor",
        "generator_keramaian", "skor_ramai_terkoreksi", "intensitas_transaksi",
        "aktivitas_komunitas",
    ],
    "perilaku": [
        "puncak_pagi", "puncak_siang", "puncak_sore", "puncak_malam",
        "rasio_weekend", "pangsa_digital", "harga_median_porsi", "spread_harga",
        "nominal_median_struk",
    ],
    "kompetisi": [
        "n_kompetitor_langsung", "kepadatan_poi_total", "keragaman_usaha",
        "keragaman_kuliner", "pangsa_waralaba", "rasio_kompetitor_per_kapita",
        "rasio_keliling", "n_menetap_kuliner",
    ],
    "biaya": [
        "njop_m2", "njop_persentil", "pasokan_sewa_komersial", "rasio_sewa_jual",
        "harga_sewa_median", "indeks_churn",
    ],
    "risiko": ["zona_izin_komersial", "kelas_zona", "risiko_banjir"],
    "morfologi": ["rasio_tutupan_bangunan", "luas_bangunan_median", "skor_prestise_visual"],
}


def badge(hex_row: HexFeature) -> BadgeKeyakinan:
    """Satu-satunya cara membangun badge. Dipakai semua endpoint yang mengirim skor."""
    return BadgeKeyakinan(
        n_titik_misi=hex_row.n_titik_misi,
        tingkat=hex_row.tingkat_keyakinan,  # type: ignore[arg-type]
        sumber=hex_row.data_source,  # type: ignore[arg-type]
    )


@router.get("/layer", summary="Layer heksagon untuk peta (GeoJSON)")
def layer_heksagon(
    db: Session = Depends(get_db),
    kawasan: str | None = Query(default=None, description="Filter salah satu dari 6 kawasan pilot"),
    min_score: float | None = Query(default=None, description="Ambang Opportunity Score"),
    versi: str = Query(default="baseline"),
    limit: int = Query(default=5000, le=20000),
) -> dict:
    """FeatureCollection siap render.

    Dalam produksi layer ini disajikan sebagai GeoJSON statis dari CDN Cloudflare
    (mitigasi free tier, lihat docs/arsitektur.md). Endpoint ini dipakai saat
    pengembangan dan sebagai sumber untuk membangkitkan berkas statis itu.
    """
    stmt = (
        select(
            HexFeature.h3_index,
            HexFeature.kawasan,
            HexFeature.tingkat_keyakinan,
            HexFeature.n_titik_misi,
            HexFeature.data_source,
            HexFeature.zona_izin_komersial,
            # Dua variabel biaya ikut di layer supaya PriceLens bisa mewarnai peta
            # tanpa memanggil endpoint detail satu per satu untuk ribuan heksagon.
            HexFeature.harga_sewa_median,
            HexFeature.njop_m2,
            LocationScore.opportunity_score,
            LocationScore.hidden_gem_score,
            LocationScore.kuadran,
            func.ST_AsGeoJSON(HexFeature.geom).label("geom"),
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

    import json

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
                "harga_sewa_median": r.harga_sewa_median,
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


@router.get("/{h3_index}", response_model=DetailHeksagon, summary="Detail satu heksagon")
def detail_heksagon(
    h3_index: str, db: Session = Depends(get_db), versi: str = "baseline"
) -> DetailHeksagon:
    """Isi panel insight saat heksagon diklik. Juga sumber jawaban jelaskan_skor()."""
    hx = db.get(HexFeature, h3_index)
    if hx is None:
        raise HTTPException(status_code=404, detail=f"Heksagon {h3_index} tidak ditemukan")

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

    variabel = {
        nama: getattr(hx, nama)
        for kolom in DIMENSI.values()
        for nama in kolom
    }

    return DetailHeksagon(
        skor=SkorHeksagon(
            h3_index=hx.h3_index,
            kawasan=hx.kawasan,
            opportunity_score=skor.opportunity_score if skor else None,
            hidden_gem_score=skor.hidden_gem_score if skor else None,
            kuadran=skor.kuadran if skor else None,  # type: ignore[arg-type]
            peringkat=skor.peringkat if skor else None,
            zona_izin_komersial=hx.zona_izin_komersial,
            keyakinan=badge(hx),
        ),
        indeks=IndeksKomposit(
            ipt=skor.ipt if skor else None,
            iae=skor.iae if skor else None,
            ikp=skor.ikp if skor else None,
            ibr=skor.ibr if skor else None,
        ),
        variabel=variabel,
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
    )
