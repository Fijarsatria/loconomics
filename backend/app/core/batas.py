"""Pembatas laju dan plafon biaya untuk AI Consultant.

Ini satu-satunya bagian backend yang membelanjakan uang sungguhan. Tanpa berkas
ini, satu skrip sederhana yang memanggil POST /ai/tanya dalam perulangan bisa
menghabiskan seluruh kuota LLM dalam hitungan menit - dan yang paling mungkin
melakukannya bukan penyerang, melainkan bug di frontend sendiri: satu useEffect
tanpa dependensi yang benar sudah cukup.

Dua lapis yang saling menutup celah:

  1. Laju per pemanggil  - mencegah satu sumber membanjiri
  2. Plafon biaya harian - mencegah banyak sumber pelan-pelan menghabiskan

Lapis pertama saja tidak cukup: sepuluh alamat IP yang masing-masing di bawah
batas tetap bisa menguras anggaran dalam sehari.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from datetime import date, datetime, time as jam_hari

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.galat import AnggaranHabis, TerlaluBanyakPermintaan
from app.models import AICallLog

# --- Laju per pemanggil ----------------------------------------------------
# Jendela geser, bukan ember per menit. Batas per menit kaku punya celah yang
# sudah dikenal: 10 permintaan di detik ke-59 lalu 10 lagi di detik ke-61 lolos
# sebagai "10 per menit" padahal 20 permintaan dalam dua detik.

MAKS_PERMINTAAN = 10
JENDELA_DETIK = 60

_kunci = threading.Lock()
_jejak: dict[str, deque[float]] = {}


def periksa_laju(pemanggil: str) -> None:
    """Lempar TerlaluBanyakPermintaan kalau pemanggil melewati batas."""
    sekarang = time.monotonic()
    with _kunci:
        antre = _jejak.setdefault(pemanggil, deque())
        while antre and antre[0] <= sekarang - JENDELA_DETIK:
            antre.popleft()
        if len(antre) >= MAKS_PERMINTAAN:
            tunggu = int(JENDELA_DETIK - (sekarang - antre[0])) + 1
            raise TerlaluBanyakPermintaan(
                f"Terlalu banyak pertanyaan ke asisten. Coba lagi dalam {tunggu} detik.",
                {"maks_per_menit": MAKS_PERMINTAAN, "tunggu_detik": tunggu},
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
    """Lempar AnggaranHabis kalau plafon hari ini sudah terlampaui.

    Diperiksa SEBELUM memanggil model, bukan sesudah. Memeriksa sesudah berarti
    plafon selalu terlampaui minimal satu panggilan - dan panggilan pertama
    setelah plafon justru yang paling mungkin panggilan berulang dari bug.

    Konsekuensinya satu panggilan bisa sedikit melewati plafon, karena biayanya
    baru diketahui setelah selesai. Itu penyimpangan yang bisa diterima; yang
    tidak bisa diterima adalah plafon yang tidak pernah menghentikan apa pun.
    """
    terpakai = biaya_hari_ini(db)
    if terpakai >= plafon:
        raise AnggaranHabis(
            "Plafon biaya AI untuk hari ini sudah tercapai. Asisten akan aktif "
            "lagi besok, atau naikkan LLM_PLAFON_HARIAN_USD di backend/.env.",
            {"terpakai_usd": round(terpakai, 4), "plafon_usd": plafon},
        )
    return terpakai
