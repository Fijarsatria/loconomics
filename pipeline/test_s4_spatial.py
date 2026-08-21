"""Uji Commuter Clock dan PriceLens dengan data sintetis.

Tidak butuh basis data maupun data lapangan:

    cd pipeline && python test_s4_spatial.py
    atau:  python -m pytest test_s4_spatial.py -v
"""

import numpy as np
import pandas as pd

from config import JAM_OPERASIONAL
from s4_spatial import (
    CAPTIVE_MAKS,
    CAPTIVE_MIN,
    MIN_STRUK_OBSERVED,
    belanja_per_jam,
    harga_sewa_per_m2,
    konteks_captive,
    profil_jam,
)

HEX = ["89hex00001", "89hex00002", "89hex00003"]


def contoh_hex() -> pd.DataFrame:
    """Tiga heksagon dengan konteks yang sengaja berlawanan."""
    return pd.DataFrame(
        {
            # hex 1: banyak kos, sedikit kantor, NJOP rendah  -> condong captive
            # hex 3: sedikit kos, banyak kantor, NJOP tinggi  -> condong choice
            "kepadatan_kos": [90.0, 40.0, 5.0],
            "kepadatan_kantor": [5.0, 40.0, 95.0],
            "njop_persentil": [10.0, 50.0, 95.0],
            "pangsa_digital": [0.1, 0.5, 0.9],
        },
        index=HEX,
    )


def contoh_struk(seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    baris = []
    for h in HEX:
        for jam in JAM_OPERASIONAL:
            n = 8 if jam in (7, 17) else 4  # ada puncak supaya jam_puncak bermakna
            for _ in range(n):
                baris.append(
                    {"h3_index": h, "jam": jam, "total_nominal": float(rng.integers(5_000, 80_000))}
                )
    return pd.DataFrame(baris)


# --- konteks captive -------------------------------------------------------


def test_konteks_captive_rentang():
    k = konteks_captive(contoh_hex())
    assert k.between(0, 1).all(), "konteks captive harus di [0,1]"


def test_konteks_captive_arah():
    """Banyak kos + sedikit kantor + NJOP rendah harus lebih captive."""
    k = konteks_captive(contoh_hex())
    assert k[HEX[0]] > k[HEX[2]], "heksagon kos harus lebih captive daripada heksagon kantor"


# --- profil jam ------------------------------------------------------------


def test_profil_jam_bentuk():
    p = profil_jam(contoh_struk(), contoh_hex())
    assert set(p.columns) == {
        "h3_index", "jam", "n_transaksi", "nominal_total",
        "nominal_median", "pangsa_captive", "metode",
    }
    assert p["jam"].isin(JAM_OPERASIONAL).all(), "ada jam di luar 05-22"


def test_profil_jam_tidak_pernah_pasti():
    """Pangsa captive tidak pernah 0 atau 1 - tidak ada proksi yang sepasti itu."""
    p = profil_jam(contoh_struk(), contoh_hex())
    assert p["pangsa_captive"].between(CAPTIVE_MIN, CAPTIVE_MAKS).all()


def test_profil_jam_puncak_lebih_captive():
    """Jam jendela komuter harus lebih captive daripada tengah hari, di heksagon yang sama."""
    p = profil_jam(contoh_struk(), contoh_hex()).set_index(["h3_index", "jam"])
    for h in HEX:
        assert p.loc[(h, 7), "pangsa_captive"] > p.loc[(h, 13), "pangsa_captive"]


def test_profil_jam_menandai_proxy():
    """Jam dengan sedikit struk ditandai proxy, bukan diam-diam disebut observed."""
    struk = pd.DataFrame(
        [{"h3_index": HEX[0], "jam": 7, "total_nominal": 20_000}]  # cuma 1 struk
    )
    p = profil_jam(struk, contoh_hex())
    assert p.iloc[0]["metode"] == "proxy"
    assert MIN_STRUK_OBSERVED > 1


def test_profil_jam_struk_kosong():
    p = profil_jam(pd.DataFrame(columns=["h3_index", "jam", "total_nominal"]), contoh_hex())
    assert p.empty and "pangsa_captive" in p.columns


def test_profil_jam_buang_di_luar_rentang():
    struk = pd.DataFrame(
        [
            {"h3_index": HEX[0], "jam": 3, "total_nominal": 10_000},  # 03:00, di luar
            {"h3_index": HEX[0], "jam": 10, "total_nominal": 10_000},
        ]
    )
    p = profil_jam(struk, contoh_hex())
    assert list(p["jam"]) == [10]


# --- B10 belanja per jam ---------------------------------------------------


def test_belanja_per_jam_pembagi_jam_berisi():
    """Pembaginya jumlah jam berisi, bukan 18."""
    struk = pd.DataFrame(
        [
            {"h3_index": HEX[0], "jam": 7, "total_nominal": 100_000},
            {"h3_index": HEX[0], "jam": 8, "total_nominal": 300_000},
        ]
    )
    b = belanja_per_jam(profil_jam(struk, contoh_hex()))
    assert b[HEX[0]] == 200_000, f"harusnya 400rb / 2 jam, dapat {b[HEX[0]]}"


# --- P07 harga sewa per m2 -------------------------------------------------


def test_harga_per_m2_tahunan_dibagi_dua_belas():
    prop = pd.DataFrame(
        [
            {"h3_index": HEX[0], "harga_nominal": 120_000_000, "periode": "tahun", "luas_m2": 100.0},
            {"h3_index": HEX[1], "harga_nominal": 10_000_000, "periode": "bulan", "luas_m2": 100.0},
        ]
    )
    h = harga_sewa_per_m2(prop)
    assert h[HEX[0]] == 100_000, "120jt/tahun / 12 / 100 m2 = 100rb"
    assert h[HEX[1]] == 100_000, "10jt/bulan / 100 m2 = 100rb"


def test_harga_per_m2_buang_periode_tidak_jelas():
    """Aturan 9.6 - periode tidak jelas dibuang, tidak ditebak."""
    prop = pd.DataFrame(
        [
            {"h3_index": HEX[0], "harga_nominal": 45_000_000, "periode": "tidak_disebut", "luas_m2": 60.0},
            {"h3_index": HEX[0], "harga_nominal": 6_000_000, "periode": "bulan", "luas_m2": 60.0},
        ]
    )
    h = harga_sewa_per_m2(prop)
    assert h[HEX[0]] == 100_000, "record 'tidak_disebut' seharusnya tidak ikut"


def test_harga_per_m2_median_dari_rasio():
    """Median dari rasio, BUKAN rasio dari median.

    Dua properti: 10jt/100m2 = 100rb/m2, dan 3jt/10m2 = 300rb/m2.
    Median rasio  = 200rb.  Rasio median = 6,5jt / 55m2 = 118rb - salah.
    """
    prop = pd.DataFrame(
        [
            {"h3_index": HEX[0], "harga_nominal": 10_000_000, "periode": "bulan", "luas_m2": 100.0},
            {"h3_index": HEX[0], "harga_nominal": 3_000_000, "periode": "bulan", "luas_m2": 10.0},
        ]
    )
    assert harga_sewa_per_m2(prop)[HEX[0]] == 200_000


def test_harga_per_m2_luas_nol_tidak_bikin_pembagian_nol():
    prop = pd.DataFrame(
        [
            {"h3_index": HEX[0], "harga_nominal": 5_000_000, "periode": "bulan", "luas_m2": 0.0},
            {"h3_index": HEX[0], "harga_nominal": 5_000_000, "periode": "bulan", "luas_m2": 50.0},
        ]
    )
    h = harga_sewa_per_m2(prop)
    assert h[HEX[0]] == 100_000 and np.isfinite(h[HEX[0]])


if __name__ == "__main__":
    lolos = gagal = 0
    for nama, fn in sorted(globals().items()):
        if not nama.startswith("test_"):
            continue
        try:
            fn()
            print(f"  PASS  {nama}")
            lolos += 1
        except AssertionError as e:
            print(f"  FAIL  {nama}: {e}")
            gagal += 1

    print(f"\n{lolos} lolos, {gagal} gagal\n")

    p = profil_jam(contoh_struk(), contoh_hex())
    print("Contoh Commuter Clock (heksagon condong captive vs condong choice):")
    banding = p[p["h3_index"].isin([HEX[0], HEX[2]])].pivot(
        index="jam", columns="h3_index", values="pangsa_captive"
    )
    banding.columns = ["kos (captive)", "kantor (choice)"]
    print(banding.to_string())
