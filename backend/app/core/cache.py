"""Cache dalam proses, ber-TTL.

Kenapa bukan Redis: Render free tier hanya memberi satu proses tanpa layanan
tambahan. Menambah Redis berarti menambah biaya dan satu lagi hal yang bisa mati
saat demo. Cache dalam proses cukup karena beban yang dihadapi bukan ribuan
pengguna serentak, melainkan satu juri yang mengklik-klik peta.

Batasnya jujur disebut: kalau nanti dijalankan dengan beberapa worker, tiap
worker punya cache sendiri. Konsekuensinya cuma cache miss yang lebih sering,
bukan data yang salah - isi cache selalu hasil query yang sama.

Yang di-cache hanya BACAAN yang mahal dan jarang berubah:
  - persentil kawasan (PriceLens, RiskRadar) - berubah hanya saat pipeline jalan
  - layer GeoJSON - ribuan baris + ST_AsGeoJSON per permintaan

Yang TIDAK pernah di-cache: apa pun yang menyentuh LLM, dan apa pun yang menulis.
"""

from __future__ import annotations

import functools
import threading
import time
from typing import Any, Callable

# Sepuluh menit. Isi tabel hanya berubah saat pipeline dijalankan, yang terjadi
# beberapa kali sehari saat pengembangan dan tidak sama sekali saat demo. Nilai
# ini kompromi antara "juri tidak menunggu" dan "perubahan pipeline terlihat
# tanpa perlu restart".
TTL_DETIK = 600

_kunci = threading.Lock()
_isi: dict[str, tuple[float, Any]] = {}

# Statistik dipakai endpoint /meta/siap. Angka hit rate yang rendah saat demo
# adalah tanda cache-nya tidak menolong dan TTL-nya perlu ditinjau.
_hit = _miss = 0


def _sekarang() -> float:
    return time.monotonic()


def ambil(kunci: str) -> tuple[bool, Any]:
    """Kembalikan (ketemu, nilai). Tidak memakai None sebagai penanda kosong,
    karena None adalah nilai yang sah untuk sebagian query."""
    global _hit, _miss
    with _kunci:
        entri = _isi.get(kunci)
        if entri and entri[0] > _sekarang():
            _hit += 1
            return True, entri[1]
        if entri:
            del _isi[kunci]  # kedaluwarsa, buang sekalian
        _miss += 1
        return False, None


def simpan(kunci: str, nilai: Any, ttl: float = TTL_DETIK) -> None:
    with _kunci:
        _isi[kunci] = (_sekarang() + ttl, nilai)


def bersihkan(awalan: str | None = None) -> int:
    """Kosongkan cache. Dipakai setelah pipeline memuat data baru, dan oleh uji.

    Tanpa `awalan`, semuanya dibuang.
    """
    with _kunci:
        if awalan is None:
            n = len(_isi)
            _isi.clear()
            return n
        buang = [k for k in _isi if k.startswith(awalan)]
        for k in buang:
            del _isi[k]
        return len(buang)


def statistik() -> dict[str, Any]:
    with _kunci:
        total = _hit + _miss
        return {
            "entri": len(_isi),
            "hit": _hit,
            "miss": _miss,
            "rasio_hit": round(_hit / total, 3) if total else None,
            "ttl_detik": TTL_DETIK,
        }


# Parameter yang TIDAK boleh ikut jadi kunci cache. Ketiganya objek yang berbeda
# di setiap permintaan; kalau ikut, kunci selalu unik dan cache tidak pernah kena
# - gejala yang paling sulit disadari karena semuanya tetap berjalan benar,
# hanya saja tidak pernah lebih cepat.
ABAIKAN = frozenset({"db", "request", "respons", "response"})


def _kunci_dari(awalan: str, nama_fn: str, args: tuple, kwargs: dict) -> str:
    """Susun kunci dari argumen yang benar-benar memengaruhi hasil.

    Argumen posisional pertama dilewati karena selalu sesi basis data pada
    pemakaian di proyek ini. Argumen kata-kunci disaring menurut namanya - dan
    inilah yang penting, karena FastAPI memanggil endpoint dengan kata-kunci,
    sehingga penyaringan berdasarkan posisi saja tidak cukup.
    """
    bagian = [awalan, nama_fn, *map(repr, args[1:])]
    bagian += [f"{k}={v!r}" for k, v in sorted(kwargs.items()) if k not in ABAIKAN]
    return "|".join(bagian)


def ber_cache(awalan: str, ttl: float = TTL_DETIK) -> Callable:
    """Dekorator untuk fungsi baca yang mahal.

    Sesi basis data tidak pernah ikut jadi kunci. Konsekuensinya: jangan pakai
    dekorator ini pada fungsi yang hasilnya bergantung pada isi sesi - misalnya
    pembacaan di dalam transaksi yang belum di-commit. Uji yang bekerja dalam
    transaksi ber-rollback WAJIB memanggil bersihkan() sebelum dan sesudahnya,
    kalau tidak data ujinya bertahan di cache setelah rollback.
    """

    def bungkus(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def dalam(*args, **kwargs):
            kunci = _kunci_dari(awalan, fn.__name__, args, kwargs)
            ketemu, nilai = ambil(kunci)
            if ketemu:
                return nilai
            hasil = fn(*args, **kwargs)
            simpan(kunci, hasil, ttl)
            return hasil

        dalam.bersihkan = lambda: bersihkan(awalan)  # type: ignore[attr-defined]
        return dalam

    return bungkus
