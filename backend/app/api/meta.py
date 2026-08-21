"""Kesehatan, kesiapan, dan cakupan data.

Dua endpoint yang sering dikira sama padahal jawabannya berbeda:

  /health      Apakah prosesnya hidup?   -> untuk Render, HARUS murah dan cepat
  /meta/siap   Apakah bisa melayani?     -> memeriksa basis data, migrasi, isi data

Memakai /health yang menyentuh basis data adalah kesalahan yang mahal: Render
memanggilnya tiap beberapa detik, dan setiap panggilan jadi satu koneksi ke
Supabase free tier. Sebaliknya, /health yang selalu menjawab "ok" tidak berguna
untuk memutuskan apakah demo layak dimulai - itu tugas /meta/siap.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.ai import ALAT_BACKEND, ALAT_FRONTEND
from app.core import cache
from app.core.aturan import KAWASAN_PILOT
from app.core.batas import PLAFON_HARIAN_USD, biaya_hari_ini
from app.core.config import settings
from app.core.database import get_db
from app.core.llm import model_aktif, tersedia
from app.models import HexFeature, HexHourlyProfile, LocationScore

router = APIRouter(tags=["meta"])


@router.get("/health", summary="Apakah prosesnya hidup")
def health() -> dict[str, str]:
    """Sengaja tidak menyentuh basis data. Dipanggil Render tiap beberapa detik."""
    return {"status": "ok"}


@router.get("/meta/siap", summary="Apakah backend siap melayani")
def kesiapan(db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    """Pemeriksaan lengkap sebelum demo dimulai.

    Menjawab tiga hal yang perlu diketahui dan tidak bisa dijawab dari luar:
    basis datanya terjangkau atau tidak, migrasinya sudah versi terbaru atau
    belum, dan datanya sudah masuk atau masih kosong.

    Yang terakhir yang paling sering terlewat. Backend yang sehat di atas basis
    data kosong akan menjawab semua permintaan dengan daftar kosong, dan itu
    terlihat seperti bug di frontend padahal pipeline-nya yang belum dijalankan.
    """
    hasil: dict[str, Any] = {
        "siap": False,
        "lingkungan": settings.lingkungan,
        "basis_data": {"terjangkau": False},
        "cache": cache.statistik(),
    }

    try:
        revisi = db.execute(text("SELECT version_num FROM alembic_version")).scalar()
        n_hex = db.execute(select(func.count()).select_from(HexFeature)).scalar_one()
        n_skor = db.execute(select(func.count()).select_from(LocationScore)).scalar_one()
        n_jam = db.execute(select(func.count()).select_from(HexHourlyProfile)).scalar_one()
        n_kawasan = db.execute(
            select(func.count(func.distinct(HexFeature.kawasan)))
        ).scalar_one()
        versi_skor = db.execute(
            select(LocationScore.versi).distinct().order_by(LocationScore.versi)
        ).scalars().all()

        hasil["basis_data"] = {
            "terjangkau": True,
            "revisi_migrasi": revisi,
            "heksagon": n_hex,
            "skor": n_skor,
            "profil_jam": n_jam,
            "kawasan_terisi": n_kawasan,
            "versi_skor": list(versi_skor),
        }
        # "Siap" berarti bisa menjawab dengan isi, bukan sekadar tidak error.
        hasil["siap"] = bool(n_hex and n_skor)
        if not n_hex:
            hasil["catatan"] = "Tabel hex_features kosong - jalankan pipeline s1-s7."
        elif not n_skor:
            hasil["catatan"] = "Skor belum dihitung - jalankan pipeline s6_score lalu s7_publish."
    except SQLAlchemyError as e:
        hasil["basis_data"] = {"terjangkau": False, "galat": type(e).__name__}
        hasil["catatan"] = (
            "Basis data tidak terjangkau. Supabase free tier dijeda kalau lama "
            "menganggur - buka dasbornya sekali untuk membangunkannya."
        )

    siap_ai = tersedia()
    try:
        terpakai = biaya_hari_ini(db)
    except SQLAlchemyError:
        terpakai = None

    hasil["ai"] = {
        "siap": siap_ai,
        "model": model_aktif() if siap_ai else None,
        "n_alat_backend": len(ALAT_BACKEND),
        "n_alat_peta": len(ALAT_FRONTEND),
        "biaya_hari_ini_usd": round(terpakai, 4) if terpakai is not None else None,
        "plafon_harian_usd": settings.llm_plafon_harian_usd or PLAFON_HARIAN_USD,
    }
    return hasil


@router.get("/meta/kawasan", summary="Enam kawasan pilot dan cakupan datanya")
def daftar_kawasan(db: Annotated[Session, Depends(get_db)]) -> list[dict[str, Any]]:
    """Kawasan yang sah beserta seberapa lengkap datanya.

    Dipakai frontend untuk mengisi pemilih kawasan, dan dipakai siapa pun yang
    ingin tahu kawasan mana yang sudah layak didemokan. Kawasan pilot yang belum
    punya satu baris pun tetap muncul dengan angka nol - menyembunyikannya akan
    membuat cakupan terlihat lebih baik daripada kenyataannya.
    """
    baris = {
        r.kawasan: r
        for r in db.execute(
            select(
                HexFeature.kawasan,
                func.count().label("heksagon"),
                func.count(HexFeature.harga_sewa_per_m2).label("berharga"),
                func.count()
                .filter(HexFeature.data_source == "observed")
                .label("observed"),
                func.count()
                .filter(HexFeature.tingkat_keyakinan == "TINGGI")
                .label("keyakinan_tinggi"),
            ).group_by(HexFeature.kawasan)
        ).all()
    }

    keluar = []
    for nama in KAWASAN_PILOT:
        r = baris.get(nama)
        total = r.heksagon if r else 0
        keluar.append(
            {
                "kawasan": nama,
                "heksagon": total,
                "cakupan_harga": round(r.berharga / total, 3) if r and total else 0.0,
                "cakupan_survei": round(r.observed / total, 3) if r and total else 0.0,
                "keyakinan_tinggi": r.keyakinan_tinggi if r else 0,
                "siap_demo": bool(total and r and r.observed),
            }
        )
    return keluar


@router.post("/meta/cache/bersihkan", summary="Kosongkan cache baca")
def bersihkan_cache(awalan: str | None = None) -> dict[str, Any]:
    """Dipanggil setelah pipeline memuat data baru.

    Tanpa ini, persentil kawasan yang sudah di-cache akan bertahan sampai TTL
    habis, dan angka baru hasil pipeline tidak muncul sampai sepuluh menit
    kemudian. Saat demo, sepuluh menit itu selamanya.
    """
    return {"dibuang": cache.bersihkan(awalan), "sisa": cache.statistik()}
