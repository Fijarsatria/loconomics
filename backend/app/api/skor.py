"""Endpoint peringkat, GemFinder, dan RiskRadar.

Skor tidak pernah dihitung di sini. Seluruh perhitungan indeks dilakukan
offline oleh pipeline/s6_score.py dan hasilnya disimpan ke location_scores.
Endpoint ini hanya membaca dan mengurutkan.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.hex import badge
from app.core.database import get_db
from app.models import HexFeature, LocationScore
from app.schemas import SkorHeksagon

router = APIRouter(prefix="/skor", tags=["skor"])


def _baris_skor(rows) -> list[SkorHeksagon]:
    return [
        SkorHeksagon(
            h3_index=hx.h3_index,
            kawasan=hx.kawasan,
            opportunity_score=sc.opportunity_score,
            hidden_gem_score=sc.hidden_gem_score,
            kuadran=sc.kuadran,  # type: ignore[arg-type]
            peringkat=sc.peringkat,
            zona_izin_komersial=hx.zona_izin_komersial,
            keyakinan=badge(hx),
        )
        for hx, sc in rows
    ]


def _dasar(versi: str):
    return select(HexFeature, LocationScore).join(
        LocationScore,
        (LocationScore.h3_index == HexFeature.h3_index) & (LocationScore.versi == versi),
    )


@router.get("/ranking", response_model=list[SkorHeksagon], summary="Peringkat Opportunity Score")
def ranking(
    db: Session = Depends(get_db),
    kawasan: str | None = Query(default=None),
    limit: int = Query(default=20, le=200),
    versi: str = "baseline",
) -> list[SkorHeksagon]:
    stmt = _dasar(versi).order_by(LocationScore.opportunity_score.desc().nullslast()).limit(limit)
    if kawasan:
        stmt = stmt.where(HexFeature.kawasan == kawasan)
    return _baris_skor(db.execute(stmt).all())


@router.get("/hidden-gems", response_model=list[SkorHeksagon], summary="GemFinder")
def hidden_gems(
    db: Session = Depends(get_db),
    kawasan: str | None = Query(default=None),
    limit: int = Query(default=20, le=100, description="Acceptance criteria PRD: minimal 10"),
    versi: str = "baseline",
) -> list[SkorHeksagon]:
    """Layer Hidden Gems.

    Sebuah heksagon hanya masuk kalau lolos lebih dari satu metode deteksi
    (residual regresi, kuadran prestise, IPTT) - lihat docs/skoring.md.
    Penyaringan itu sudah dilakukan di pipeline; di sini tinggal mengurutkan.
    """
    stmt = (
        _dasar(versi)
        .where(LocationScore.hidden_gem_score.is_not(None))
        .order_by(LocationScore.hidden_gem_score.desc())
        .limit(limit)
    )
    if kawasan:
        stmt = stmt.where(HexFeature.kawasan == kawasan)
    return _baris_skor(db.execute(stmt).all())


@router.get("/risk-radar", response_model=list[SkorHeksagon], summary="RiskRadar (Jebakan Gengsi)")
def risk_radar(
    db: Session = Depends(get_db),
    kawasan: str | None = Query(default=None),
    limit: int = Query(default=50, le=200),
    versi: str = "baseline",
) -> list[SkorHeksagon]:
    """Kuadran kanan bawah: terlihat mewah, ekonominya tidak jalan.

    Ditampilkan sebagai peringatan - platform tidak hanya merekomendasikan,
    tapi juga melindungi pengguna dari lokasi yang paling sering menjebak.
    """
    stmt = (
        _dasar(versi)
        .where(LocationScore.kuadran == "JEBAKAN_GENGSI")
        .order_by(HexFeature.indeks_churn.desc().nullslast())
        .limit(limit)
    )
    if kawasan:
        stmt = stmt.where(HexFeature.kawasan == kawasan)
    return _baris_skor(db.execute(stmt).all())
