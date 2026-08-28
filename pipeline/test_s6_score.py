"""Uji mesin skoring dengan data sintetis.

Dijalankan tanpa database dan tanpa data lapangan, jadi bisa dipakai kapan saja
untuk memastikan rumus tidak rusak setelah diubah:

    cd pipeline && python -m pytest test_s6_score.py -v
    atau:  python test_s6_score.py
"""

import numpy as np
import pandas as pd

from config import SENSITIVITAS_RHO_MIN
from s6_score import (
    hitung_indeks,
    hitung_iptt,
    hitung_opportunity,
    norm,
    rincian_faktor,
    skor_lengkap,
    tentukan_kuadran,
    uji_sensitivitas,
)

KOLOM = [
    "pop_100m", "pop_usia_produktif", "jarak_simpul_m", "waktu_jalan_menit",
    "skor_simpul", "ridership_proksi", "kepadatan_kos", "kepadatan_kantor",
    "generator_keramaian", "skor_ramai_terkoreksi", "intensitas_transaksi",
    "aktivitas_komunitas", "puncak_pagi", "puncak_siang", "puncak_sore",
    "puncak_malam", "rasio_weekend", "pangsa_digital", "harga_median_porsi",
    "spread_harga", "nominal_median_struk", "n_kompetitor_langsung",
    "kepadatan_poi_total", "keragaman_usaha", "keragaman_kuliner",
    "pangsa_waralaba", "rasio_kompetitor_per_kapita", "rasio_keliling",
    "n_menetap_kuliner", "njop_m2", "njop_persentil", "pasokan_sewa_komersial",
    "rasio_sewa_jual", "harga_sewa_median", "indeks_churn", "risiko_banjir",
    "rasio_tutupan_bangunan", "luas_bangunan_median", "skor_prestise_visual",
]


def contoh_data(n: int = 200, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    df = pd.DataFrame(
        {k: rng.random(n) * rng.choice([1, 100, 10_000]) for k in KOLOM},
        index=[f"89hex{i:05d}" for i in range(n)],
    )
    df["zona_izin_komersial"] = True
    return df


def test_jumlah_variabel():
    """Kamus Data Final: 41 variabel analisis."""
    # 39 numerik di KOLOM + zona_izin_komersial (L01) + kelas_zona (L02) = 41
    assert len(KOLOM) == 39, f"harusnya 39 kolom numerik, ada {len(KOLOM)}"


def test_norm_rentang():
    s = pd.Series([0, 5, 10, 100])
    hasil = norm(s)
    assert hasil.min() == 0 and hasil.max() == 1


def test_norm_pertahankan_nan():
    """Nilai kosong tidak pernah diisi nol - aturan 9.5."""
    hasil = norm(pd.Series([1.0, np.nan, 3.0]))
    assert pd.isna(hasil.iloc[1]), "NaN harus tetap NaN, bukan jadi 0"


def test_indeks_dalam_rentang():
    idx = hitung_indeks(contoh_data())
    for kolom in ["ipt", "iae", "ikp", "ibr"]:
        assert idx[kolom].between(0, 1).all(), f"{kolom} keluar rentang [0,1]"


def test_zoneguard_menolkan_skor():
    """L01 adalah gate, bukan bobot: FALSE -> skor 0 apa pun nilai variabel lain."""
    df = contoh_data()
    df.loc[df.index[:10], "zona_izin_komersial"] = False
    idx = hitung_indeks(df)
    skor = hitung_opportunity(idx, df["zona_izin_komersial"])
    assert (skor.iloc[:10] == 0).all(), "ZoneGuard gagal menolkan skor"
    assert (skor.iloc[10:] > 0).any(), "skor lain ikut ternol - gate terlalu luas"


def test_zona_tidak_diketahui_tidak_dinolkan():
    """Kawasan tanpa RDTR digital (NaN) ditandai, bukan dianggap melarang."""
    df = contoh_data()
    df["zona_izin_komersial"] = pd.Series([None] * len(df), index=df.index, dtype="object")
    skor = hitung_opportunity(hitung_indeks(df), df["zona_izin_komersial"])
    assert (skor > 0).any(), "zona NaN tidak boleh otomatis dinolkan"


def test_iptt_arah_benar():
    """Banyak keliling + ramai + sedikit menetap -> IPTT tinggi."""
    df = contoh_data(n=50)
    df["rasio_keliling"] = np.linspace(0, 1, 50)
    df["skor_ramai_terkoreksi"] = np.linspace(0, 1, 50)
    df["n_menetap_kuliner"] = np.linspace(1, 0, 50)  # berkurang
    iptt = hitung_iptt(df)
    assert iptt.iloc[-1] > iptt.iloc[0], "IPTT harus naik saat keliling+ramai naik"


def test_kuadran_lengkap():
    df = contoh_data()
    idx = hitung_indeks(df)
    peluang = hitung_opportunity(idx, df["zona_izin_komersial"])
    kuadran = tentukan_kuadran(peluang, norm(df["njop_persentil"]))
    assert set(kuadran.unique()) <= {"HIDDEN_GEM", "PEMENANG_JELAS", "JEBAKAN_GENGSI", "HINDARI"}
    assert "HIDDEN_GEM" in set(kuadran.unique())
    assert "JEBAKAN_GENGSI" in set(kuadran.unique())


def test_hidden_gem_butuh_dua_metode():
    """Sebuah lokasi baru disebut hidden gem kalau lolos LEBIH DARI SATU metode."""
    hasil = skor_lengkap(contoh_data())
    bergem = hasil["hidden_gem_score"].notna()
    assert (hasil.loc[bergem, "n_metode_lolos"] >= 2).all(), "ada gem yang lolos <2 metode"


def test_sensitivitas_bobot():
    """Peringkat harus stabil saat bobot digeser +-0,10. Target rho > 0,85."""
    hasil = uji_sensitivitas(contoh_data(n=300))
    terendah = min(hasil.values())
    assert terendah > SENSITIVITAS_RHO_MIN, f"rho terendah {terendah} <= {SENSITIVITAS_RHO_MIN}"


def test_faktor_menjumlah_jadi_indeksnya():
    """Uji terpenting untuk score_factors: rincian harus MENJELASKAN skornya.

    Kalau jumlah kontribusi sebuah indeks tidak sama dengan nilai indeks yang
    tersimpan, panel "Kenapa skornya segitu" menampilkan angka yang tidak
    menghasilkan skor di sebelahnya - dan itu jenis kesalahan yang langsung
    terlihat begitu juri menjumlahkannya sendiri.
    """
    df = contoh_data(n=300)
    idx = hitung_indeks(df)
    jml = rincian_faktor(df).groupby(["h3_index", "indeks"])["kontribusi"].sum().unstack()
    for nama in ("IPT", "IAE", "IKP", "IBR"):
        beda = (jml[nama].reindex(idx.index) - idx[nama.lower()]).abs().max()
        assert beda < 1e-9, f"{nama} meleset {beda}"


def test_faktor_hanya_variabel_berbobot():
    """Empat belas variabel, bukan 43. B10 dan P07 tidak membentuk indeks mana pun."""
    fak = rincian_faktor(contoh_data(n=50))
    assert len(fak) == 14 * 50, f"harus 14 baris per heksagon, ada {len(fak) / 50}"
    assert not fak.duplicated(["h3_index", "kode_variabel"]).any()
    assert set(fak["indeks"]) == {"IPT", "IAE", "IKP", "IBR"}
    assert {"B10", "P07"}.isdisjoint(set(fak["kode_variabel"]))


def test_faktor_persentil_dan_norm_dalam_rentang():
    fak = rincian_faktor(contoh_data(n=80))
    assert fak["nilai_normalisasi"].dropna().between(0, 1).all()
    assert fak["persentil"].dropna().between(0, 100).all()


def test_skor_lengkap_bentuk():
    hasil = skor_lengkap(contoh_data())
    for kolom in ["ipt", "iae", "ikp", "ibr", "opportunity_score", "hidden_gem_score",
                  "kuadran", "peringkat", "iptt", "residual_biaya"]:
        assert kolom in hasil.columns, f"kolom {kolom} hilang"
    assert hasil["opportunity_score"].between(0, 100).all()


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

    hasil = skor_lengkap(contoh_data())
    print("Contoh keluaran (5 skor tertinggi):")
    print(hasil.nlargest(5, "opportunity_score")[
        ["ipt", "iae", "ikp", "ibr", "opportunity_score", "kuadran", "peringkat"]
    ].round(3).to_string())

    print("\nUji sensitivitas bobot (Spearman rho terhadap baseline):")
    for k, v in uji_sensitivitas(contoh_data(n=300)).items():
        tanda = "OK " if v > SENSITIVITAS_RHO_MIN else "!! "
        print(f"  {tanda}{k:>12} -> rho {v}")
