"""Tahap 5 - GapFill: mengisi heksagon yang tidak pernah disurvei."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from config import tingkat_keyakinan

FITUR_PREDIKTOR = [
    "kepadatan_poi_total",  # C02  OSM + Overture
    "pop_100m",             # D01  WorldPop
    "pop_usia_produktif",   # D02
    "skor_simpul",          # D05
    "jarak_simpul_m",       # D03
    "rasio_tutupan_bangunan",  # M01
    "luas_bangunan_median",    # M02
    "njop_m2",              # P01
    "pangsa_waralaba",      # C05
    "kepadatan_kantor",     # D08
]

TARGET = ["skor_ramai_terkoreksi", "harga_median_porsi"]

MIN_GROUND_TRUTH = 30

#: Kawasan berbeda minimum. Spatial k-fold membagi PER KAWASAN, jadi dengan dua
#: kawasan hanya ada dua lipatan dan tiap lipatan melatih di satu kawasan saja -
#: yang diukurnya bukan generalisasi melainkan kebetulan.
MIN_KAWASAN = 3

#: Prediktor minimum yang benar-benar terisi. Dari sepuluh yang didaftarkan,
#: sebagian ikut dikosongkan 27 Agu 2026 (D02, P01); model tetap boleh jalan
#: dengan sisanya, tetapi tidak dengan segelintir.
MIN_FITUR = 4


@dataclass
class HasilLatih:
    """Apa yang model pelajari, dan seberapa layak ia dipercaya."""

    target: str
    n_latih: int
    kawasan: list[str]
    fitur: list[str]
    r2: float
    mae: float
    baseline_mae: float
    pentingnya: dict[str, float] = field(default_factory=dict)
    model: object | None = None

    @property
    def lebih_baik_dari_menebak(self) -> bool:
        """Apakah model mengalahkan 'selalu tebak rata-rata'?"""
        return self.mae < self.baseline_mae

    def ringkas(self) -> str:
        arah = "LEBIH BAIK" if self.lebih_baik_dari_menebak else "TIDAK LEBIH BAIK"
        return (
            f"{self.target}: n={self.n_latih} di {len(self.kawasan)} kawasan, "
            f"{len(self.fitur)} fitur | R2={self.r2:+.3f} "
            f"MAE={self.mae:.4f} (menebak rata-rata: {self.baseline_mae:.4f}) "
            f"-> {arah}"
        )


class DataTidakCukup(RuntimeError):
    """Ground truth-nya terlalu tipis untuk melatih apa pun yang jujur."""


def _periksa_kecukupan(df: pd.DataFrame, target: str, fitur: list[str]) -> None:
    """Penjaga. Melempar sebelum satu baris pun dilatih."""
    n = len(df)
    kawasan = sorted(df["kawasan"].dropna().unique()) if "kawasan" in df else []
    kurang = []
    if n < MIN_GROUND_TRUTH:
        kurang.append(f"{n} baris ground truth (butuh >= {MIN_GROUND_TRUTH})")
    if len(kawasan) < MIN_KAWASAN:
        kurang.append(f"{len(kawasan)} kawasan (butuh >= {MIN_KAWASAN})")
    if len(fitur) < MIN_FITUR:
        kurang.append(f"{len(fitur)} prediktor terisi (butuh >= {MIN_FITUR})")
    if kurang:
        raise DataTidakCukup(
            f"'{target}' belum bisa di-GapFill: " + "; ".join(kurang) + ".\n"
            "  Yang menghalangi BUKAN kode ini melainkan cakupan survei. "
            "Lihat docs/data.md bagian 11."
        )


def _fitur_terpakai(df: pd.DataFrame) -> list[str]:
    """Prediktor yang benar-benar punya isi. Kolom kosong tidak mengajari apa pun."""
    return [k for k in FITUR_PREDIKTOR if k in df.columns and df[k].notna().sum() > 0]


def latih_model(df_ground_truth: pd.DataFrame, target: str) -> HasilLatih:
    """Gradient Boosting / Random Forest."""
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.metrics import mean_absolute_error, r2_score
    from sklearn.model_selection import LeaveOneGroupOut

    df = df_ground_truth[df_ground_truth[target].notna()].copy()
    fitur = _fitur_terpakai(df)
    _periksa_kecukupan(df, target, fitur)

    X = df[fitur].to_numpy(dtype=float)
    y = df[target].to_numpy(dtype=float)
    grup = df["kawasan"].to_numpy()

    # NaN di prediktor dinetralkan ke MEDIAN kolomnya, bukan ke nol. Alasannya
    # sama dengan `_tertimbang()` di s6: nol adalah pernyataan ("tidak ada"),
    # median bukan pernyataan apa-apa.
    median = np.nanmedian(X, axis=0)
    median = np.where(np.isnan(median), 0.0, median)
    X = np.where(np.isnan(X), median, X)

    # Spatial k-fold: satu kawasan ditahan penuh tiap lipatan.
    duga = np.empty_like(y)
    for latih, uji in LeaveOneGroupOut().split(X, y, groups=grup):
        m = RandomForestRegressor(
            n_estimators=300, min_samples_leaf=2, random_state=0, n_jobs=-1
        )
        m.fit(X[latih], y[latih])
        duga[uji] = m.predict(X[uji])

    # Model akhir dilatih di SELURUH ground truth; angka mutunya datang dari
    # lipatan di atas, bukan dari model ini - melaporkan mutu model yang sudah
    # melihat seluruh datanya adalah cara paling umum menipu diri sendiri.
    final = RandomForestRegressor(
        n_estimators=300, min_samples_leaf=2, random_state=0, n_jobs=-1
    )
    final.fit(X, y)

    return HasilLatih(
        target=target,
        n_latih=len(df),
        kawasan=sorted(pd.unique(grup).tolist()),
        fitur=fitur,
        r2=float(r2_score(y, duga)),
        mae=float(mean_absolute_error(y, duga)),
        baseline_mae=float(mean_absolute_error(y, np.full_like(y, y.mean()))),
        pentingnya=dict(
            sorted(
                zip(fitur, (round(float(v), 4) for v in final.feature_importances_)),
                key=lambda kv: -kv[1],
            )
        ),
        model=final,
    )


def prediksi_seluruh_heksagon(hasil: HasilLatih, df_semua: pd.DataFrame) -> pd.DataFrame:
    """Terapkan model ke heksagon tanpa data misi."""
    if hasil.model is None:
        raise ValueError("HasilLatih tidak membawa model")

    X = df_semua[hasil.fitur].to_numpy(dtype=float)
    median = np.nanmedian(X, axis=0)
    median = np.where(np.isnan(median), 0.0, median)
    X = np.where(np.isnan(X), median, X)

    per_pohon = np.stack([p.predict(X) for p in hasil.model.estimators_])
    keluar = pd.DataFrame(
        {
            hasil.target: per_pohon.mean(axis=0),
            f"{hasil.target}__sebaran": per_pohon.std(axis=0),
            f"{hasil.target}__sumber": "predicted",
        },
        index=df_semua.index,
    )

    # Heksagon yang PUNYA nilai terukur tidak pernah ditimpa prediksi.
    if hasil.target in df_semua.columns:
        terukur = df_semua[hasil.target].notna()
        keluar.loc[terukur, hasil.target] = df_semua.loc[terukur, hasil.target]
        keluar.loc[terukur, f"{hasil.target}__sebaran"] = 0.0
        keluar.loc[terukur, f"{hasil.target}__sumber"] = "observed"
    return keluar


def tandai_keyakinan(n_titik_misi: int) -> tuple[str, str]:
    """Q02 + Q03. Badge ini WAJIB tampil di antarmuka setiap kali skor ditampilkan."""
    tingkat = tingkat_keyakinan(n_titik_misi)
    sumber = "observed" if n_titik_misi > 0 else "predicted"
    return tingkat, sumber


def laporan_kesiapan(df: pd.DataFrame) -> str:
    """Apakah GapFill sudah bisa dijalankan, dan kalau belum, apa yang kurang."""
    fitur = _fitur_terpakai(df)
    baris = [
        f"Prediktor terisi : {len(fitur)}/{len(FITUR_PREDIKTOR)}  {fitur}",
        f"Ambang           : >= {MIN_GROUND_TRUTH} baris, >= {MIN_KAWASAN} kawasan, "
        f">= {MIN_FITUR} prediktor",
        "",
    ]
    for t in TARGET:
        ada = df[t].notna().sum() if t in df.columns else 0
        kaw = (
            df.loc[df[t].notna(), "kawasan"].nunique()
            if t in df.columns and "kawasan" in df.columns
            else 0
        )
        try:
            _periksa_kecukupan(df[df[t].notna()] if t in df.columns else df.iloc[:0], t, fitur)
            status = "SIAP"
        except DataTidakCukup:
            status = "BELUM"
        baris.append(f"  {t:24s} n={ada:4d}  kawasan={kaw}  -> {status}")
    return "\n".join(baris)
