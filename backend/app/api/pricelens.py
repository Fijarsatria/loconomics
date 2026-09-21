"""PriceLens - peta harga. Fitur prioritas tertinggi."""

import json

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Float, func, select
from sqlalchemy.orm import Session

from app.api.bersama import ambil_hex, badge, kolom_sampel_tunggal, periksa_kawasan_banyak
from app.core.akun import PenggunaOpsional, wajib_akses_penuh
from app.core.database import get_db
from app.models import HexFeature
from app.schemas import PriceLensHeksagon, RentangWajar

router = APIRouter(prefix="/pricelens", tags=["pricelens"])

BATAS_BAWAH, BATAS_TENGAH, BATAS_ATAS = 0.25, 0.50, 0.75


def _persentil(db: Session, kolom, kawasan: str) -> RentangWajar:
    """Persentil 25/50/75 satu kolom dalam satu kawasan."""
    kuartil = [
        func.percentile_cont(q).within_group(kolom.cast(Float)).label(f"p{int(q * 100)}")
        for q in (BATAS_BAWAH, BATAS_TENGAH, BATAS_ATAS)
    ]
    baris = db.execute(
        select(*kuartil, func.count(kolom))
        .where(HexFeature.kawasan == kawasan, kolom.is_not(None))
    ).one()
    return RentangWajar(p25=baris[0], p50=baris[1], p75=baris[2], n_sampel=baris[3] or 0)


def _posisi(nilai: float | None, wajar: RentangWajar) -> str:
    """Murah, wajar, atau mahal - relatif terhadap kawasannya sendiri."""
    if nilai is None or wajar.p25 is None or wajar.p75 is None:
        return "TIDAK_DIKETAHUI"
    if nilai < wajar.p25:
        return "MURAH"
    if nilai > wajar.p75:
        return "MAHAL"
    return "WAJAR"


def _selisih_persen(nilai: float | None, median: float | None) -> float | None:
    if nilai is None or not median:
        return None
    return round((nilai - median) / median * 100, 1)


def kartu_harga(db: Session, hx: HexFeature) -> PriceLensHeksagon:
    """Kartu PriceLens satu heksagon. Dipakai endpoint detail dan AI Consultant."""
    wajar_sewa = _persentil(db, HexFeature.harga_sewa_per_m2, hx.kawasan)
    wajar_belanja = _persentil(db, HexFeature.belanja_per_jam, hx.kawasan)

    return PriceLensHeksagon(
        h3_index=hx.h3_index,
        kawasan=hx.kawasan,
        harga_sewa_per_m2=hx.harga_sewa_per_m2,
        harga_sewa_median=hx.harga_sewa_median,
        belanja_per_jam=hx.belanja_per_jam,
        # Aturan 2 - lihat `kolom_sampel_tunggal`.
        harga_median_porsi=(
            None
            if "harga_median_porsi" in kolom_sampel_tunggal(db, hx.h3_index).get(hx.h3_index, set())
            else hx.harga_median_porsi
        ),
        njop_m2=hx.njop_m2,
        wajar_sewa_per_m2=wajar_sewa,
        wajar_belanja_per_jam=wajar_belanja,
        posisi_sewa=_posisi(hx.harga_sewa_per_m2, wajar_sewa),  # type: ignore[arg-type]
        selisih_persen_dari_median=_selisih_persen(hx.harga_sewa_per_m2, wajar_sewa.p50),
        keyakinan=badge(hx),
    )


@router.get("/layer", summary="Layer harga untuk peta (GeoJSON)")
def layer_harga(
    db: Annotated[Session, Depends(get_db)],
    kawasan: Annotated[str | None, Query()] = None,
    maks_sewa_per_m2: Annotated[float | None, Query(description="Hanya heksagon dengan sewa per m² di bawah angka ini")] = None,
    hanya_berdata: Annotated[bool, Query(description="Buang heksagon yang belum punya angka harga sama sekali")] = False,
    limit: Annotated[int, Query(le=20000)] = 5000,
) -> dict:
    """FeatureCollection untuk mewarnai peta menurut harga."""
    stmt = (
        select(
            HexFeature.h3_index,
            HexFeature.kawasan,
            HexFeature.harga_sewa_per_m2,
            HexFeature.harga_sewa_median,
            HexFeature.belanja_per_jam,
            HexFeature.harga_median_porsi,
            HexFeature.njop_m2,
            HexFeature.tingkat_keyakinan,
            HexFeature.n_titik_misi,
            HexFeature.data_source,
            func.ST_AsGeoJSON(HexFeature.geom).label("geom"),
        )
        .limit(limit)
    )
    daftar_kawasan = periksa_kawasan_banyak(kawasan)
    if daftar_kawasan:
        stmt = stmt.where(HexFeature.kawasan.in_(daftar_kawasan))
    if maks_sewa_per_m2 is not None:
        stmt = stmt.where(HexFeature.harga_sewa_per_m2 <= maks_sewa_per_m2)
    if hanya_berdata:
        stmt = stmt.where(HexFeature.harga_sewa_per_m2.is_not(None))

    ditahan = kolom_sampel_tunggal(db)
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": r.h3_index,
                "geometry": json.loads(r.geom),
                "properties": {
                    "h3_index": r.h3_index,
                    "kawasan": r.kawasan,
                    "harga_sewa_per_m2": r.harga_sewa_per_m2,
                    "harga_sewa_median": r.harga_sewa_median,
                    "belanja_per_jam": r.belanja_per_jam,
                    # Aturan 2: median dari satu baris survei = baris itu.
                    "harga_median_porsi": (
                        None
                        if "harga_median_porsi" in ditahan.get(r.h3_index, set())
                        else r.harga_median_porsi
                    ),
                    "njop_m2": r.njop_m2,
                    "tingkat_keyakinan": r.tingkat_keyakinan,
                    "n_titik_misi": r.n_titik_misi,
                    "data_source": r.data_source,
                },
            }
            for r in db.execute(stmt)
        ],
    }


@router.get("/ringkasan", summary="Rentang harga wajar per kawasan")
def ringkasan_kawasan(db: Annotated[Session, Depends(get_db)]) -> list[dict]:
    """Rentang wajar tiap kawasan, untuk legenda peta dan pembanding cepat."""
    kawasan_list = db.execute(
        select(HexFeature.kawasan).distinct().order_by(HexFeature.kawasan)
    ).scalars().all()

    hasil = []
    for kw in kawasan_list:
        total = db.execute(
            select(func.count()).select_from(HexFeature).where(HexFeature.kawasan == kw)
        ).scalar_one()
        sewa = _persentil(db, HexFeature.harga_sewa_per_m2, kw)
        belanja = _persentil(db, HexFeature.belanja_per_jam, kw)
        hasil.append(
            {
                "kawasan": kw,
                "total_heksagon": total,
                "sewa_per_m2": sewa.model_dump(),
                "belanja_per_jam": belanja.model_dump(),
                "cakupan_harga": round(sewa.n_sampel / total, 3) if total else 0.0,
            }
        )
    return hasil


@router.get(
    "/{h3_index}", response_model=PriceLensHeksagon, summary="Kartu harga satu heksagon"
)
def detail_harga(
    h3_index: str,
    db: Annotated[Session, Depends(get_db)],
    pengguna: PenggunaOpsional = None,
) -> PriceLensHeksagon:
    # Layer harga di PETA tetap gratis; yang berbayar kartu rincian per
    # heksagon ini - sewa/bulan, NJOP, posisi terhadap rentang wajar.
    wajib_akses_penuh(db, pengguna, h3_index, "Kartu harga PriceLens")
    hx = ambil_hex(db, h3_index)
    return kartu_harga(db, hx)
