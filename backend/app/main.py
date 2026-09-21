"""Loconomics API."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api import ai, akun, hex, meta, pricelens, skor, transit
from app.core import galat
from app.core.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)

KETERANGAN_TAG = [
    {"name": "heksagon", "description": "Satuan analisis utama: H3 res-9, ±0,10 km²."},
    {"name": "pricelens", "description": "Peta harga. Sewa per m² dan belanja per jam, keduanya dari OCR."},
    {"name": "transit", "description": "Simpul transportasi dan isochrone jalan kaki."},
    {"name": "skor", "description": "Peringkat, GemFinder, RiskRadar, ZoneGuard. Membaca saja - tidak menghitung."},
    {"name": "ai", "description": "AI Consultant. Satu-satunya bagian yang membelanjakan uang sungguhan."},
    {"name": "meta", "description": "Kesehatan, kesiapan, cakupan data."},
    {
        "name": "akun",
        "description": (
            "Akun, langganan Loconomics Premium, token, pemantauan, Laporan Kelayakan. "
            "Satu-satunya modul yang menyimpan data pribadi - dan ia tidak pernah "
            "ikut ter-JOIN dengan data misi MAPID."
        ),
    },
]

app = FastAPI(
    title="Loconomics API",
    version="0.2.0",
    summary="Transit-oriented Retail Recommender - MAPID WebGIS Competition 2026",
    description=__doc__,
    openapi_tags=KETERANGAN_TAG,
    # Di produksi, /docs disembunyikan. Bukan karena API-nya rahasia, tetapi
    # karena halaman itu mengundang orang mencoba POST /ai/tanya, dan endpoint
    # itu membelanjakan uang sungguhan.
    docs_url=None if settings.produksi else "/docs",
    redoc_url=None if settings.produksi else "/redoc",
    openapi_url=None if settings.produksi else "/openapi.json",
)

HEADER_KEAMANAN = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-site",
    # `frame-ancestors 'none'` saja - respons ini bukan halaman, jadi arahan
    # lain tidak punya arti di sini dan hanya akan jadi salinan kedua dari CSP
    # frontend yang cepat atau lambat berselisih dengannya.
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}


@app.middleware("http")
async def header_keamanan(request, panggil_berikutnya):
    """Menempelkan `HEADER_KEAMANAN` ke tiap respons, termasuk respons GALAT."""
    respons = await panggil_berikutnya(request)
    for k, v in HEADER_KEAMANAN.items():
        respons.headers.setdefault(k, v)
    # HSTS HANYA di produksi. Di localhost ia mengunci peramban pengembang ke
    # https untuk host yang tidak menyajikannya - dan kuncian itu bertahan
    # berbulan-bulan di profil perambannya.
    if settings.produksi:
        respons.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    return respons


# Urutan middleware penting: yang ditambahkan terakhir berjalan paling luar.
# GZip harus membungkus respons SETELAH CORS menempelkan header-nya.
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
    # Peramban menyembunyikan setiap header respons yang tidak disebut di sini,
    # termasuk header buatan sendiri. X-Total-Count adalah janji paginasi
    # /skor/ranking; tanpa didaftarkan, janji itu cuma berlaku untuk curl.
    expose_headers=[galat.HEADER_REQUEST_ID, skor.HEADER_TOTAL],
)


galat.pasang(app)

app.include_router(meta.router)
app.include_router(hex.router)
app.include_router(pricelens.router)
app.include_router(transit.router)
app.include_router(skor.router)
app.include_router(ai.router)
app.include_router(akun.router)
