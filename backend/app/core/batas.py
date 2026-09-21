"""Pembatas laju dan plafon biaya."""

from __future__ import annotations

import threading
import time
from collections import deque
from datetime import date, datetime, time as jam_hari

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.galat import AnggaranHabis, TerlaluBanyakPermintaan
from app.models import AICallLog


MAKS_PERMINTAAN = 10
JENDELA_DETIK = 60

_kunci = threading.Lock()
_jejak: dict[str, deque[float]] = {}


def periksa_laju(
    pemanggil: str,
    maks: int = MAKS_PERMINTAAN,
    kalimat: str = "Terlalu banyak pertanyaan ke asisten.",
) -> None:
    """Lempar TerlaluBanyakPermintaan kalau pemanggil melewati batas."""
    sekarang = time.monotonic()
    with _kunci:
        antre = _jejak.setdefault(pemanggil, deque())
        while antre and antre[0] <= sekarang - JENDELA_DETIK:
            antre.popleft()
        if len(antre) >= maks:
            tunggu = int(JENDELA_DETIK - (sekarang - antre[0])) + 1
            raise TerlaluBanyakPermintaan(
                f"{kalimat} Coba lagi dalam {tunggu} detik.",
                {"maks_per_menit": maks, "tunggu_detik": tunggu},
            )
        antre.append(sekarang)

        # Bersihkan pemanggil yang sudah lama diam, supaya dict tidak tumbuh
        # tanpa batas di proses yang hidup berhari-hari.
        if len(_jejak) > 1000:
            for k in [k for k, v in _jejak.items() if not v]:
                del _jejak[k]


def lupakan(pemanggil: str | None = None) -> None:
    """Kosongkan jejak laju. Dipakai uji."""
    with _kunci:
        if pemanggil is None:
            _jejak.clear()
        else:
            _jejak.pop(pemanggil, None)


MAKS_BERAT = 6


def identitas_pemanggil(request: Request) -> str:
    """Kunci pembatas: id akun kalau tiketnya sah, kalau tidak alamat IP."""
    from app.core.akun import baca_tiket

    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        uid = baca_tiket(auth[7:].strip())
        if uid is not None:
            return f"akun:{uid}"
    return f"ip:{request.client.host if request.client else '-'}"


def penjaga_berat(request: Request) -> None:
    """Dependensi untuk endpoint yang mahal di CPU, bukan di uang."""
    periksa_laju(
        f"berat:{identitas_pemanggil(request)}",
        maks=MAKS_BERAT,
        kalimat="Terlalu banyak berkas diminta sekaligus.",
    )



# --- Plafon biaya harian ---------------------------------------------------
# Dihitung dari ai_call_logs.biaya_usd, tabel yang memang sudah dicatat untuk
# ketentuan C.1. Jadi tidak ada penyimpanan tambahan hanya untuk pembatas ini.

PLAFON_HARIAN_USD = 2.0


def biaya_hari_ini(db: Session) -> float:
    awal = datetime.combine(date.today(), jam_hari.min)
    total = db.execute(
        select(func.coalesce(func.sum(AICallLog.biaya_usd), 0.0)).where(
            AICallLog.dibuat_pada >= awal, AICallLog.fitur == "B1"
        )
    ).scalar_one()
    return float(total or 0.0)


def periksa_anggaran(db: Session, plafon: float = PLAFON_HARIAN_USD) -> float:
    """Lempar AnggaranHabis kalau plafon hari ini sudah terlampaui."""
    terpakai = biaya_hari_ini(db)
    if terpakai >= plafon:
        raise AnggaranHabis(
            "Plafon biaya AI untuk hari ini sudah tercapai. Asisten akan aktif "
            "lagi besok, atau naikkan LLM_PLAFON_HARIAN_USD di backend/.env.",
            {"terpakai_usd": round(terpakai, 4), "plafon_usd": plafon},
        )
    return terpakai
