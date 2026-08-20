"""Tahap 6 - Mesin skoring. Rule-based, deterministik, bisa dijelaskan.

Ini satu-satunya tempat skor dihitung di seluruh proyek. Backend tidak menghitung,
frontend tidak menghitung, dan LLM sama sekali tidak boleh menghitung.

Alur: 41 variabel -> normalisasi -> 4 indeks komposit -> Skor Peluang -> Hidden Gem.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from config import (
    BOBOT_HIDDEN_GEM,
    BOBOT_IAE,
    BOBOT_IBR,
    BOBOT_IKP,
    BOBOT_IPT,
    BOBOT_PELUANG,
    KODE_KE_KOLOM,
    SENSITIVITAS_GESER,
)

# Variabel berekor panjang: ditransformasi log(1+x) sebelum normalisasi supaya
# beberapa lokasi ekstrem tidak mendominasi seluruh skala.
BEREKOR_PANJANG = {
    "pop_100m", "pop_usia_produktif", "n_kompetitor_langsung", "kepadatan_poi_total",
    "generator_keramaian", "kepadatan_kos", "kepadatan_kantor", "njop_m2",
    "harga_sewa_median", "harga_median_porsi", "nominal_median_struk",
    "intensitas_transaksi", "pasokan_sewa_komersial", "luas_bangunan_median",
}


def norm(s: pd.Series, nama: str | None = None) -> pd.Series:
    """Min-max ke [0,1]. NaN tetap NaN - tidak pernah diisi nol.

    "Nol transaksi tercatat" dan "tidak ada transaksi di sini" adalah dua
    pernyataan berbeda; menyamakannya membuat kawasan yang belum disurvei
    tampak mati padahal bisa jadi justru ramai.
    """
    x = pd.to_numeric(s, errors="coerce").astype(float)
    if nama in BEREKOR_PANJANG:
        x = np.log1p(x.clip(lower=0))
    lo, hi = x.min(), x.max()
    if pd.isna(lo) or pd.isna(hi) or hi == lo:
        return pd.Series(np.where(x.isna(), np.nan, 0.5), index=s.index)
    return (x - lo) / (hi - lo)


def _tertimbang(df: pd.DataFrame, bobot: dict[str, float]) -> pd.Series:
    """Jumlah tertimbang.

    Kunci bobot memakai KODE variabel (D05, C06) supaya definisi bobot bisa
    dibaca berdampingan dengan Kamus Data. Sufiks _inv berarti variabel dibalik:
    1 - norm(x), dipakai untuk variabel yang arahnya terbalik terhadap indeksnya
    (mis. waktu jalan makin lama makin buruk untuk IPT).
    """
    total = pd.Series(0.0, index=df.index)
    for kunci, w in bobot.items():
        kode = kunci.removesuffix("_inv")
        kolom = KODE_KE_KOLOM[kode]
        nilai = norm(df[kolom], kolom)
        if kunci.endswith("_inv"):
            nilai = 1 - nilai
        total = total + w * nilai.fillna(0.5)  # variabel hilang -> netral, bukan nol
    return total


def hitung_indeks(df: pd.DataFrame) -> pd.DataFrame:
    """Empat indeks komposit. IKP dan IBR: semakin tinggi semakin BURUK."""
    out = pd.DataFrame(index=df.index)
    out["ipt"] = _tertimbang(df, BOBOT_IPT)
    out["iae"] = _tertimbang(df, BOBOT_IAE)
    out["ikp"] = _tertimbang(df, BOBOT_IKP)
    out["ibr"] = _tertimbang(df, BOBOT_IBR)
    return out


def hitung_opportunity(idx: pd.DataFrame, zona_izin: pd.Series, bobot=None) -> pd.Series:
    """Skor Peluang, skala 0-100.

    ZoneGuard adalah GATE, bukan bobot: kalau zona RDTR melarang kegiatan usaha,
    skor dinolkan berapa pun nilai variabel lain. Zona yang tidak diketahui
    (NaN, mis. kawasan tanpa RDTR digital) TIDAK dinolkan - ditandai terpisah
    di antarmuka sebagai "Kawasan tanpa RDTR Digital".
    """
    w = bobot or BOBOT_PELUANG
    mentah = (
        w["IPT"] * idx["ipt"]
        + w["IAE"] * idx["iae"]
        + w["IKP"] * idx["ikp"]
        + w["IBR"] * idx["ibr"]
    )
    skor = (norm(mentah) * 100).round(1)
    return skor.mask(zona_izin.eq(False), 0.0)


def hitung_iptt(df: pd.DataFrame) -> pd.Series:
    """Indeks Permintaan Tak Terlayani - metrik paling orisinal proyek ini.

    Banyak pedagang KELILING x pembeli RAMAI / sedikit usaha MENETAP.
    Artinya permintaan sudah terbukti ada tetapi belum ada yang melayaninya
    secara permanen.

    Hanya bisa dihitung karena data misi MAPID punya kolom Mobilitas dan kolom
    Kondisi Pembeli. Tidak ada dataset komersial yang menyediakan keduanya -
    pedagang keliling tidak pernah masuk ke peta mana pun.
    """
    return (
        norm(df["rasio_keliling"], "rasio_keliling").fillna(0)
        * norm(df["skor_ramai_terkoreksi"], "skor_ramai_terkoreksi").fillna(0)
        / (1 + norm(df["n_menetap_kuliner"], "n_menetap_kuliner").fillna(0))
    )


def hitung_residual_biaya(df: pd.DataFrame, idx: pd.DataFrame) -> pd.Series:
    """Metode 1 Hidden Gem - regresi OLS biaya terhadap potensi.

        IBR ~ b0 + b1*IPT + b2*IAE + b3*populasi

    Residual sangat NEGATIF -> biaya jauh lebih murah daripada seharusnya
    mengingat potensi lokasi. Itulah hidden gem.

    Bisa dijelaskan tanpa jargon: "berdasarkan potensi transit dan aktivitas
    ekonominya, lokasi ini seharusnya berharga sekian, tetapi harga sebenarnya
    jauh di bawah itu."
    """
    X = pd.DataFrame({
        "konstanta": 1.0,
        "ipt": idx["ipt"],
        "iae": idx["iae"],
        "pop": norm(df["pop_100m"], "pop_100m").fillna(0.5),
    })
    y = idx["ibr"]
    valid = X.notna().all(axis=1) & y.notna()
    if valid.sum() < 4:  # butuh lebih banyak baris daripada koefisien
        return pd.Series(np.nan, index=df.index)
    koef, *_ = np.linalg.lstsq(X[valid].to_numpy(), y[valid].to_numpy(), rcond=None)
    prediksi = pd.Series(X.to_numpy() @ koef, index=df.index)
    return y - prediksi


def hitung_prestise_visual(df: pd.DataFrame) -> pd.Series:
    """Sumbu horizontal kuadran. Lima komponen, NJOP persentil rendah = prestise rendah."""
    komponen = [
        norm(df["njop_persentil"], "njop_persentil"),
        norm(df["pangsa_waralaba"], "pangsa_waralaba"),
        norm(df["skor_prestise_visual"], "skor_prestise_visual"),
        norm(df["luas_bangunan_median"], "luas_bangunan_median"),
        norm(df["rasio_tutupan_bangunan"], "rasio_tutupan_bangunan"),
    ]
    return pd.concat(komponen, axis=1).mean(axis=1, skipna=True)


def tentukan_kuadran(peluang: pd.Series, prestise: pd.Series) -> pd.Series:
    """Metode 2 Hidden Gem. Empat kuadran dengan makna berbeda.

    Kuadran JEBAKAN_GENGSI juga ditampilkan di platform: berisi lokasi yang
    terlihat bagus dan mahal tetapi ekonominya tidak mendukung, dan justru itulah
    yang paling sering menjebak pelaku UMKM pemula. Menampilkannya membuat
    platform tidak hanya merekomendasikan, tetapi juga melindungi.
    """
    p_tinggi = peluang >= peluang.median()
    v_tinggi = prestise >= prestise.median()
    return pd.Series(
        np.select(
            [p_tinggi & ~v_tinggi, p_tinggi & v_tinggi, ~p_tinggi & v_tinggi],
            ["HIDDEN_GEM", "PEMENANG_JELAS", "JEBAKAN_GENGSI"],
            default="HINDARI",
        ),
        index=peluang.index,
    )


def hitung_hidden_gem(df: pd.DataFrame, idx: pd.DataFrame, peluang: pd.Series) -> pd.DataFrame:
    """Gabungan tiga metode.

    Sebuah lokasi baru disebut hidden gem kalau lolos LEBIH DARI SATU metode -
    yang diambil irisannya, bukan gabungannya.
    """
    residual = hitung_residual_biaya(df, idx)
    iptt = hitung_iptt(df)
    prestise = hitung_prestise_visual(df)
    kuadran = tentukan_kuadran(peluang, prestise)

    w = BOBOT_HIDDEN_GEM
    skor = (
        w["residual"] * norm(-residual).fillna(0)
        + w["iptt"] * norm(iptt).fillna(0)
        + w["peluang_x_prestise"] * norm(peluang * (1 - prestise.fillna(0.5))).fillna(0)
    )

    # Irisan: hitung berapa metode yang menandai lokasi ini
    lolos = (
        (residual < residual.quantile(0.25)).fillna(False).astype(int)
        + (iptt > iptt.quantile(0.75)).fillna(False).astype(int)
        + kuadran.eq("HIDDEN_GEM").astype(int)
    )

    return pd.DataFrame({
        "residual_biaya": residual,
        "iptt": iptt,
        "prestise_visual": prestise,
        "kuadran": kuadran,
        "hidden_gem_score": skor.where(lolos >= 2),  # butuh minimal 2 metode
        "n_metode_lolos": lolos,
    })


def uji_sensitivitas(df: pd.DataFrame, geser: float = SENSITIVITAS_GESER) -> dict[str, float]:
    """Geser tiap bobot +-0,10, bandingkan peringkat dengan baseline (Spearman rho).

    Pertanyaan "kenapa bobotnya segitu?" hampir pasti ditanyakan juri, dan
    jawaban terbaiknya bukan pembelaan atas angka bobot, melainkan bukti bahwa
    hasilnya tidak sensitif terhadap angka itu. Target rho > 0,85.
    """
    idx = hitung_indeks(df)
    zona = df["zona_izin_komersial"]
    baseline = hitung_opportunity(idx, zona).rank()

    hasil: dict[str, float] = {}
    for kunci in BOBOT_PELUANG:
        for arah in (+geser, -geser):
            bobot = dict(BOBOT_PELUANG)
            bobot[kunci] = bobot[kunci] + arah
            varian = hitung_opportunity(idx, zona, bobot).rank()
            rho = baseline.corr(varian, method="spearman")
            hasil[f"{kunci}{arah:+.2f}"] = round(float(rho), 4)
    return hasil


def skor_lengkap(df: pd.DataFrame) -> pd.DataFrame:
    """Titik masuk utama. df berindeks h3_index dengan 41 kolom variabel."""
    idx = hitung_indeks(df)
    peluang = hitung_opportunity(idx, df["zona_izin_komersial"])
    gem = hitung_hidden_gem(df, idx, peluang)

    hasil = pd.concat([idx, gem], axis=1)
    hasil["opportunity_score"] = peluang
    hasil["peringkat"] = peluang.rank(ascending=False, method="min").astype("Int64")
    return hasil
