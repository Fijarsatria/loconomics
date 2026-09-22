"""Endpoint simpul transportasi dan kawasan jangkau (isochrone)."""

import json

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.bersama import periksa_kawasan_banyak
from app.core.database import get_db
from app.core.galat import TidakDitemukan
from app.models import CatchmentArea, HexFeature, LocationScore, TransportNode
from app.schemas import SimpulTransit

router = APIRouter(prefix="/transit", tags=["transit"])

ISOCHRONE_MENIT = (5, 10, 15, 30, 60)

#: Pita menit per profil. Mobil dan sepeda jauh lebih cepat, jadi pita 5-60
#: menit yang sama membuat lapisan mobil menutupi seluruh peta. Angka ini
#: dijaga sama dengan `ISOCHRONE_MENIT_PROFIL` di pipeline/rute_ors.py.
ISOCHRONE_MENIT_PROFIL: dict[str, tuple[int, ...]] = {
    "foot-walking": ISOCHRONE_MENIT,
    "cycling-regular": (2, 4, 6, 10, 15),
    "driving-car": (1, 2, 4, 7, 10),
}

#: Profil yang punya kawasan jangkau sendiri. Motor tidak ada di ORS.
ProfilIso = Literal["foot-walking", "driving-car", "cycling-regular"]


@router.get("/nodes", response_model=list[SimpulTransit], summary="Daftar simpul transportasi")
def daftar_simpul(
    db: Annotated[Session, Depends(get_db)],
    kawasan: Annotated[str | None, Query()] = None,
    moda: Annotated[str | None, Query(description="KRL | MRT | LRT | BRT | TERMINAL")] = None,
) -> list[SimpulTransit]:
    stmt = select(
        TransportNode.id,
        TransportNode.nama,
        TransportNode.moda,
        TransportNode.kawasan,
        func.ST_Y(TransportNode.geom).label("lat"),
        func.ST_X(TransportNode.geom).label("lon"),
    )
    daftar_kawasan = periksa_kawasan_banyak(kawasan)
    if daftar_kawasan:
        stmt = stmt.where(TransportNode.kawasan.in_(daftar_kawasan))
    if moda:
        stmt = stmt.where(TransportNode.moda == moda)

    return [
        SimpulTransit(id=r.id, nama=r.nama, moda=r.moda, kawasan=r.kawasan, lat=r.lat, lon=r.lon)
        for r in db.execute(stmt)
    ]


@router.get("/simpul/{node_id}", summary="Detail satu simpul + heksagon yang dilayaninya")
def detail_simpul(
    node_id: int,
    db: Annotated[Session, Depends(get_db)],
    profil: Annotated[ProfilIso, Query(description="Profil kawasan jangkau")] = "foot-walking",
) -> dict:
    """Simpul beserta heksagon di dalam jangkauannya untuk satu profil."""
    simpul = db.get(TransportNode, node_id)
    if simpul is None:
        raise TidakDitemukan(f"Simpul transportasi {node_id} tidak ditemukan.")

    koordinat = db.execute(
        select(
            func.ST_Y(TransportNode.geom).label("lat"),
            func.ST_X(TransportNode.geom).label("lon"),
        ).where(TransportNode.id == node_id)
    ).one()

    jangkauan = []
    for menit in ISOCHRONE_MENIT_PROFIL[profil]:
        area = db.execute(
            select(CatchmentArea.geom).where(
                CatchmentArea.transport_node_id == node_id,
                CatchmentArea.menit == menit,
                CatchmentArea.profil == profil,
            )
        ).scalar_one_or_none()
        if area is None:
            jangkauan.append({"menit": menit, "tersedia": False})
            continue

        ringkas = db.execute(
            select(
                func.count().label("heksagon"),
                func.avg(LocationScore.opportunity_score).label("rata_skor"),
                func.count()
                .filter(LocationScore.kuadran == "HIDDEN_GEM")
                .label("hidden_gem"),
                func.count()
                .filter(HexFeature.zona_izin_komersial.is_(False))
                .label("zona_dilarang"),
                func.avg(HexFeature.harga_sewa_per_m2).label("rata_sewa_m2"),
            )
            .select_from(HexFeature)
            .join(
                LocationScore,
                (LocationScore.h3_index == HexFeature.h3_index)
                & (LocationScore.versi == "baseline"),
                isouter=True,
            )
            .where(func.ST_Intersects(HexFeature.geom, area))
        ).one()

        jangkauan.append(
            {
                "menit": menit,
                "tersedia": True,
                "heksagon": ringkas.heksagon,
                "rata_opportunity_score": (
                    round(float(ringkas.rata_skor), 1) if ringkas.rata_skor else None
                ),
                "hidden_gem": ringkas.hidden_gem,
                "zona_dilarang": ringkas.zona_dilarang,
                "rata_sewa_per_m2": (
                    round(float(ringkas.rata_sewa_m2)) if ringkas.rata_sewa_m2 else None
                ),
            }
        )

    return {
        "id": simpul.id,
        "nama": simpul.nama,
        "moda": simpul.moda,
        "kawasan": simpul.kawasan,
        "jumlah_jalur": simpul.jumlah_jalur,
        "ridership_harian": simpul.ridership_harian,
        "lat": koordinat.lat,
        "lon": koordinat.lon,
        "profil": profil,
        "jangkauan": jangkauan,
    }


@router.get("/catchment", summary="Layer kawasan jangkau satu profil (GeoJSON)")
def layer_catchment(
    db: Annotated[Session, Depends(get_db)],
    node_id: Annotated[int | None, Query()] = None,
    menit: Annotated[int | None, Query(description="Pita menit (lihat pita profilnya)")] = None,
    profil: Annotated[ProfilIso, Query(description="Profil kawasan jangkau")] = "foot-walking",
) -> dict:
    stmt = select(
        CatchmentArea.id,
        CatchmentArea.transport_node_id,
        CatchmentArea.menit,
        CatchmentArea.profil,
        func.ST_AsGeoJSON(CatchmentArea.geom).label("geom"),
    ).where(CatchmentArea.profil == profil)
    if node_id is not None:
        stmt = stmt.where(CatchmentArea.transport_node_id == node_id)
    if menit is not None:
        stmt = stmt.where(CatchmentArea.menit == menit)

    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": r.id,
                "geometry": json.loads(r.geom),
                "properties": {
                    "transport_node_id": r.transport_node_id,
                    "menit": r.menit,
                    "profil": r.profil,
                },
            }
            for r in db.execute(stmt)
        ],
    }
