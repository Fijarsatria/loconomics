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

from sqlalchemy.orm import Session

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

    Sesi basis data disaring menurut TIPE, bukan menurut posisi.

    Versi sebelumnya membuang `args[0]` apa adanya, dengan alasan "argumen
    posisional pertama selalu sesi basis data pada pemakaian di proyek ini".
    Alasan itu tidak benar: `simpul_terdekat(h3_index, db)` menaruh h3 di
    posisi itu. Akibatnya dua heksagon yang berbeda berbagi satu kunci, dan
    yang kedua menerima jawaban milik yang pertama.

    Kegagalannya nyaris tak terlihat, dan itu yang membuatnya berbahaya: lewat
    HTTP semuanya benar, karena FastAPI memanggil endpoint dengan KATA-KUNCI
    sehingga `args` kosong. Yang salah cuma pemanggilan langsung dari kode -
    alat AI, skrip, dan uji - jadi bug ini bisa hidup lama di balik rangkaian
    uji yang hijau.

    Menyaring menurut tipe menghapus asumsinya sama sekali. Tidak ada lagi
    posisi yang harus benar.
    """
    posisi = [repr(a) for a in args if not isinstance(a, Session)]
    bagian = [awalan, nama_fn, *posisi]
    bagian += [f"{k}={v!r}" for k, v in sorted(kwargs.items()) if k not in ABAIKAN]
    return "|".join(bagian)


def ber_cache(awalan: str, ttl: float = TTL_DETIK) -> Callable:
    """Dekorator untuk fungsi baca yang mahal.

    Sesi basis data tidak pernah ikut jadi kunci. Konsekuensinya: jangan pakai
    dekorator ini pada fungsi yang hasilnya bergantung pada isi sesi - misalnya
    pembacaan di dalam transaksi yang belum di-commit. Uji yang bekerja dalam
    transaksi ber-rollback WAJIB memanggil bersihkan() sebelum dan sesudahnya,
    kalau tidak data ujinya bertahan di cache setelah rollback.

    JANGAN PERNAH memasang dekorator ini pada endpoint yang isinya bergantung
    pada SIAPA yang memanggil. Sejak ada akun dan langganan, sebagian endpoint
    mengirim isi berbeda untuk pelanggan dan untuk tamu - dan cache yang tidak
    tahu soal itu akan menyajikan jawaban milik pelanggan kepada tamu berikutnya
    yang meminta jalur yang sama. Kegagalannya diam: tidak ada galat, cuma data
    berbayar yang keluar gratis.

    Dua jalan keluar, keduanya sah, tetapi HARUS dipilih sadar:
      - biarkan endpoint itu tidak di-cache (yang dipilih `/hex/{h3_index}`), atau
      - masukkan pembeda tingkatnya ke kunci sebagai NILAI, bukan sebagai objek
        pengguna. `repr()` sebuah objek User memuat alamat memorinya, jadi
        memakainya sebagai kunci berarti tidak pernah kena cache sekaligus
        menumbuhkan tabelnya tanpa batas.
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
