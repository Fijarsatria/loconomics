"""Pembatas laju dan plafon biaya.

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

Sejak 13 Sep 2026 ada anggaran KEDUA yang bisa dihabiskan, dan ia tidak
berbentuk uang: backend berjalan di Azure F1, yang memberi jatah **60 menit CPU
per hari** dan menghentikan seluruh aplikasi sampai tengah malam begitu jatah
itu habis. Perakitan satu PDF memakan 1-3 detik CPU karena ia menggambar
belasan grafik, jadi beberapa ratus permintaan sudah cukup mematikan situs -
untuk semua orang, termasuk juri - tanpa satu sen pun terpakai dan tanpa satu
pun galat yang terlihat dari luar selain 403 dari Azure sendiri. `penjaga_berat`
di bawah yang menjaga jatah itu.
"""

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

# --- Laju per pemanggil ----------------------------------------------------
# Jendela geser, bukan ember per menit. Batas per menit kaku punya celah yang
# sudah dikenal: 10 permintaan di detik ke-59 lalu 10 lagi di detik ke-61 lolos
# sebagai "10 per menit" padahal 20 permintaan dalam dua detik.

MAKS_PERMINTAAN = 10
JENDELA_DETIK = 60

_kunci = threading.Lock()
_jejak: dict[str, deque[float]] = {}


def periksa_laju(
    pemanggil: str,
    maks: int = MAKS_PERMINTAAN,
    kalimat: str = "Terlalu banyak pertanyaan ke asisten.",
) -> None:
    """Lempar TerlaluBanyakPermintaan kalau pemanggil melewati batas.

    `kalimat` ikut jadi parameter karena pembatas ini tidak lagi menjaga satu
    endpoint saja: "terlalu banyak pertanyaan ke asisten" adalah kalimat yang
    salah untuk orang yang sedang mengunduh PDF, dan pesan galat yang
    menerangkan fitur LAIN terbaca sebagai kerusakan, bukan sebagai batas.
    """
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


# --- Endpoint berat di CPU -------------------------------------------------
#: Berapa berkas berat per menit per pemanggil. Enam itu longgar untuk manusia -
#: satu orang mengunduh PDF paling cepat sekali per sepuluh detik, dan itu sudah
#: termasuk membuka berkasnya - dan cukup rapat untuk membuat perulangan
#: membentur batas sebelum membentur jatah CPU harian Azure.
MAKS_BERAT = 6


def identitas_pemanggil(request: Request) -> str:
    """Kunci pembatas: id akun kalau tiketnya sah, kalau tidak alamat IP.

    Per AKUN lebih dulu, bukan per IP, dan itu bukan kerapian. Juri lomba bisa
    membuka situs ini dari satu jaringan kantor yang sama, yang dari sisi server
    berarti satu alamat IP untuk beberapa orang - batas per IP akan membuat
    seorang juri diblokir karena juri di sebelahnya baru mengunduh PDF. IP
    tetap dipakai untuk yang belum masuk, karena bagi mereka tidak ada identitas
    lain yang tersedia.

    Impor lokal: `core.akun` mengimpor `core.galat` dan `models` yang sama
    dengan berkas ini, dan mengangkat impornya ke kepala berkas mengikat dua
    modul core yang sampai sekarang tidak pernah perlu saling tahu.
    """
    from app.core.akun import baca_tiket

    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        uid = baca_tiket(auth[7:].strip())
        if uid is not None:
            return f"akun:{uid}"
    return f"ip:{request.client.host if request.client else '-'}"


def penjaga_berat(request: Request) -> None:
    """Dependensi untuk endpoint yang mahal di CPU, bukan di uang.

    Dipasang lewat `dependencies=[...]` di dekorator rutenya, BUKAN sebagai
    parameter fungsi. Dua alasan, dan keduanya disengaja:

      - tanda tangan fungsinya tidak berubah, jadi pemanggil Python langsung
        (uji, dan alat Konsultan AI yang memanggil endpoint sebagai fungsi)
        tidak ikut terkena batas yang ditujukan untuk lalu lintas HTTP;
      - penjaga yang harus diingat untuk dipanggil di dalam badan fungsi adalah
        penjaga yang suatu saat lupa dipanggil.
    """
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
