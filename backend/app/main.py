"""Loconomics API.

Modular monolith. Empat modul, bukan tujuh: domain "lokasi usaha", "kompetitor",
dan "properti" tidak punya endpoint sendiri karena data misi MAPID mentah tidak
boleh diekspos - ketiganya hanya muncul sebagai variabel agregat di /hex.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import ai, hex, skor, transit
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
app.include_router(transit.router)
app.include_router(skor.router)
app.include_router(ai.router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}
