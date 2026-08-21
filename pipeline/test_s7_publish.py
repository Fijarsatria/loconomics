"""Uji tahap terbit: pembersihan nilai dan pemotongan batch.

    cd pipeline && python test_s7_publish.py

Tidak menyentuh basis data. Yang diuji hanya bagian yang murni - tetapi justru
bagian itu yang paling berbahaya kalau salah, karena kesalahannya tidak pernah
memunculkan galat.
"""

import numpy as np
import pandas as pd

from s7_publish import _bersih, _potong

lolos = gagal = 0


def cek(nama, syarat, catatan=""):
    global lolos, gagal
    if syarat:
        print(f"  PASS  {nama}")
        lolos += 1
    else:
        print(f"  FAIL  {nama} {catatan}")
        gagal += 1


def test_nan_jadi_none():
    """NaN yang lolos ke PostgreSQL tersimpan sebagai 'NaN'::float, BUKAN NULL.

    Akibatnya `WHERE kolom IS NULL` tidak menemukannya, sementara setiap
    perbandingan dengannya bernilai false - jadi heksagonnya diam-diam hilang
    dari setiap filter tanpa pernah memunculkan galat. Ini kelas bug yang bisa
    bertahan sampai hari presentasi.
    """
    cek("float nan -> None", _bersih(float("nan")) is None)
    cek("np.nan -> None", _bersih(np.nan) is None)
    cek("pd.NA lewat kolom float -> None", _bersih(pd.Series([np.nan])[0]) is None)


def test_nilai_sah_tidak_diubah():
    cek("nol tetap nol, bukan None", _bersih(0.0) == 0.0 and _bersih(0.0) is not None)
    cek("False tetap False", _bersih(False) is False)
    cek("string kosong tetap string", _bersih("") == "")
    cek("angka biasa lewat", _bersih(3.14) == 3.14)


def test_skalar_numpy_jadi_python():
    """psycopg tidak tahu cara mengikat np.int64 sebagai parameter."""
    hasil = _bersih(np.int64(7))
    cek("np.int64 -> int Python", isinstance(hasil, int) and not isinstance(hasil, np.integer))
    hasil = _bersih(np.float64(1.5))
    cek("np.float64 -> float Python", type(hasil) is float)


def test_timestamp_jadi_datetime():
    from datetime import datetime

    hasil = _bersih(pd.Timestamp("2026-08-21 10:00"))
    cek("Timestamp -> datetime", isinstance(hasil, datetime))


def test_potong_utuh():
    baris = [{"i": i} for i in range(1050)]
    bagian = list(_potong(baris, 500))
    cek("jumlah potongan benar", len(bagian) == 3, f"- {len(bagian)}")
    cek("ukuran potongan benar", [len(b) for b in bagian] == [500, 500, 50])
    cek("tidak ada baris hilang", sum(len(b) for b in bagian) == len(baris))
    cek("urutan terjaga", bagian[0][0]["i"] == 0 and bagian[-1][-1]["i"] == 1049)


def test_potong_kosong():
    cek("daftar kosong tidak meledak", list(_potong([], 500)) == [])


if __name__ == "__main__":
    for nama, fn in sorted(globals().items()):
        if nama.startswith("test_"):
            fn()
    print(f"\n{lolos} lolos, {gagal} gagal")
    raise SystemExit(1 if gagal else 0)
