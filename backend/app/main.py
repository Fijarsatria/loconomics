"""Loconomics API.

Modular monolith. Lima modul.

Yang TIDAK ada di sini sama pentingnya dengan yang ada: domain "lokasi usaha",
"kompetitor", dan "properti" tidak punya endpoint sendiri. Kalau punya, endpoint
itu tidak akan punya apa-apa untuk dikirim selain baris survei individual -
persis yang dilarang ketentuan B.7. Ketiganya hanya muncul sebagai variabel
agregat di /hex.

  /hex        heksagon, detail 43 variabel, Commuter Clock
  /pricelens  peta harga - fitur prioritas tertinggi
  /transit    simpul dan isochrone
  /skor       peringkat, GemFinder, RiskRadar, ZoneGuard
  /ai         AI Consultant
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import ai, hex, pricelens, skor, transit
from app.core.config import settings

app = FastAPI(
    title="Loconomics API",
    description="Transit-oriented Retail Recommender - MAPID WebGIS Competition 2026",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(hex.router)
app.include_router(pricelens.router)
app.include_router(transit.router)
app.include_router(skor.router)
app.include_router(ai.router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}
