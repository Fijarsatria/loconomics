"""Endpoint simpul transportasi dan kawasan jangkau (isochrone).

Isochrone TIDAK PERNAH dihitung di sini. Perhitungan routing jaringan jalan
dilakukan offline oleh pipeline/s4_spatial.py dan hasilnya disimpan ke tabel
catchment_areas. Endpoint ini hanya membacanya.
"""

import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import CatchmentArea, TransportNode
from app.schemas import SimpulTransit

router = APIRouter(prefix="/transit", tags=["transit"])


@router.get("/nodes", response_model=list[SimpulTransit], summary="Daftar simpul transportasi")
def daftar_simpul(
    db: Session = Depends(get_db),
    kawasan: str | None = Query(default=None),
    moda: str | None = Query(default=None, description="KRL | MRT | LRT | BRT | TERMINAL"),
) -> list[SimpulTransit]:
    stmt = select(
        TransportNode.id,
        TransportNode.nama,
        TransportNode.moda,
        TransportNode.kawasan,
        func.ST_Y(TransportNode.geom).label("lat"),
        func.ST_X(TransportNode.geom).label("lon"),
    )
    if kawasan:
        stmt = stmt.where(TransportNode.kawasan == kawasan)
    if moda:
        stmt = stmt.where(TransportNode.moda == moda)

    return [
        SimpulTransit(id=r.id, nama=r.nama, moda=r.moda, kawasan=r.kawasan, lat=r.lat, lon=r.lon)
        for r in db.execute(stmt)
    ]


@router.get("/catchment", summary="Layer isochrone jalan kaki (GeoJSON)")
def layer_catchment(
    db: Session = Depends(get_db),
    node_id: int | None = Query(default=None),
    menit: int | None = Query(default=None, description="5 | 10 | 15"),
) -> dict:
    stmt = select(
        CatchmentArea.id,
        CatchmentArea.transport_node_id,
        CatchmentArea.menit,
        func.ST_AsGeoJSON(CatchmentArea.geom).label("geom"),
    )
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
                "properties": {"transport_node_id": r.transport_node_id, "menit": r.menit},
            }
            for r in db.execute(stmt)
        ],
    }
