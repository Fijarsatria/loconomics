"""Cache dalam proses, ber-TTL."""

from __future__ import annotations

import functools
import threading
import time
from typing import Any, Callable

from sqlalchemy.orm import Session

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
    """Kosongkan cache. Dipakai setelah pipeline memuat data baru, dan oleh uji."""
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


ABAIKAN = frozenset({"db", "request", "respons", "response"})


def _kunci_dari(awalan: str, nama_fn: str, args: tuple, kwargs: dict) -> str:
    """Susun kunci dari argumen yang benar-benar memengaruhi hasil."""
    posisi = [repr(a) for a in args if not isinstance(a, Session)]
    bagian = [awalan, nama_fn, *posisi]
    bagian += [f"{k}={v!r}" for k, v in sorted(kwargs.items()) if k not in ABAIKAN]
    return "|".join(bagian)


def ber_cache(awalan: str, ttl: float = TTL_DETIK) -> Callable:
    """Dekorator untuk fungsi baca yang mahal."""

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
