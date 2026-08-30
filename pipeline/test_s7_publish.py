"""Uji tahap terbit: pembersihan nilai dan pemotongan batch.

    cd pipeline && python test_s7_publish.py

Tidak menyentuh basis data. Yang diuji hanya bagian yang murni - tetapi justru
bagian itu yang paling berbahaya kalau salah, karena kesalahannya tidak pernah
memunculkan galat.
"""

import numpy as np
import pandas as pd

import csv
import tempfile
from pathlib import Path

from s7_publish import KOLOM_SURVEI, RENTANG_SURVEI, _bersih, _potong, baca_survei

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


# ---------------------------------------------------------------------------
# Survei lapangan: penguraian CSV
#
# Yang diuji di sini bukan "apakah angkanya masuk", melainkan empat cara
# berkas isian tangan bisa salah TANPA memunculkan galat. Ketiganya pernah
# terjadi di sumber data lain di repo ini.
# ---------------------------------------------------------------------------


def _csv(baris, kolom=None):
    """Tulis CSV sementara, kembalikan jalurnya."""
    kolom = kolom or ["h3_index", "nama_surveyor", *KOLOM_SURVEI]
    f = Path(tempfile.mkdtemp()) / "survei.csv"
    with f.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=kolom)
        w.writeheader()
        for b in baris:
            w.writerow({k: b.get(k, "") for k in kolom})
    return f


def test_templat_kosong_bukan_galat():
    """Templat dicetak kosong. Memuatnya sebelum diisi harus tenang, bukan meledak."""
    ringkas, kunjungan = baca_survei(_csv([{"h3_index": "898c1079d27ffff"}]))
    cek("berkas kosong -> tidak ada heksagon", ringkas.empty)
    cek("berkas kosong -> tidak ada kunjungan", len(kunjungan) == 0)


def test_sel_kosong_tetap_kosong():
    """Aturan 4. `read_csv` dengan dtype yang dipaksa akan mengubahnya jadi 0."""
    ringkas, _ = baca_survei(_csv([
        {"h3_index": "898c1079d27ffff", "skor_prestise_visual": 4},
    ]))
    cek("kolom yang diisi tersimpan", ringkas.loc["898c1079d27ffff", "skor_prestise_visual"] == 4)
    cek(
        "kolom yang TIDAK diisi tetap NaN, bukan 0",
        pd.isna(ringkas.loc["898c1079d27ffff", "harga_sewa_median"]),
    )


def test_kunjungan_ganda_diringkas_median():
    """Median, bukan rata-rata: satu salah ketik tidak boleh menggeser hasilnya."""
    h = "898c1079d27ffff"
    ringkas, kunjungan = baca_survei(_csv([
        {"h3_index": h, "puncak_pagi": 40},
        {"h3_index": h, "puncak_pagi": 44},
        {"h3_index": h, "puncak_pagi": 42},
    ]))
    cek("tiga kunjungan jadi satu baris", len(ringkas) == 1)
    cek("jumlah kunjungan dihitung", int(kunjungan[h]) == 3)
    cek("nilainya median", ringkas.loc[h, "puncak_pagi"] == 42)


def test_rata_rata_akan_tergeser_median_tidak():
    """Bukti kenapa median dipilih, bukan selera."""
    h = "898c1079d27ffff"
    # 45 juta ditulis sebagai 45 (satuan juta) - salah ketik yang paling sering.
    ringkas, _ = baca_survei(_csv([
        {"h3_index": h, "puncak_siang": 50},
        {"h3_index": h, "puncak_siang": 52},
        {"h3_index": h, "puncak_siang": 5000},
    ]))
    cek("median tahan terhadap satu pencilan", ringkas.loc[h, "puncak_siang"] == 52)


def test_satuan_tertukar_ditolak():
    """Rp15 juta ditulis '15'. Ditolak, TIDAK dipangkas diam-diam."""
    try:
        baca_survei(_csv([{"h3_index": "898c1079d27ffff", "harga_sewa_median": 15}]))
        cek("satuan tertukar ditolak", False, "- tidak melempar apa pun")
    except ValueError as e:
        cek("satuan tertukar ditolak", True)
        cek("pesannya menyebut kolomnya", "harga_sewa_median" in str(e), f"- {e}")
        cek("pesannya menyebut nilainya", "15" in str(e))


def test_skala_1_5_menolak_nol():
    """M03 skala 1-5. Nol berarti 'belum diisi', dan itu sel kosong - bukan 0."""
    try:
        baca_survei(_csv([{"h3_index": "898c1079d27ffff", "skor_prestise_visual": 0}]))
        cek("skor visual 0 ditolak", False, "- lolos")
    except ValueError:
        cek("skor visual 0 ditolak", True)


def test_kolom_asing_tidak_pernah_masuk():
    """Daftar POSITIF. Kolom bantu tidak boleh sampai ke UPDATE."""
    f = _csv([{"h3_index": "898c1079d27ffff", "puncak_pagi": 30, "nama_surveyor": "Fijar"}])
    ringkas, _ = baca_survei(f)
    cek("nama_surveyor tidak ikut", "nama_surveyor" not in ringkas.columns)
    cek("hanya kolom survei yang ikut", set(ringkas.columns) <= set(KOLOM_SURVEI))


def test_teks_bukan_angka_jadi_kosong_bukan_nol():
    """Surveyor menulis 'tidak ada'. Itu kosong, bukan nol."""
    ringkas, _ = baca_survei(_csv([
        {"h3_index": "898c1079d27ffff", "puncak_pagi": "tidak ada", "puncak_sore": 12},
    ]))
    cek("teks -> NaN", pd.isna(ringkas.loc["898c1079d27ffff", "puncak_pagi"]))
    cek("angka di baris yang sama tetap masuk",
        ringkas.loc["898c1079d27ffff", "puncak_sore"] == 12)


def test_setiap_kolom_survei_punya_rentang():
    """Kolom tanpa rentang akan meledak dengan KeyError saat dipakai, bukan saat ditulis."""
    kurang = [k for k in KOLOM_SURVEI if k not in RENTANG_SURVEI]
    cek("semua kolom survei punya rentang", not kurang, f"- {kurang}")


if __name__ == "__main__":
    for nama, fn in sorted(globals().items()):
        if nama.startswith("test_"):
            fn()
    print(f"\n{lolos} lolos, {gagal} gagal")
    raise SystemExit(1 if gagal else 0)
