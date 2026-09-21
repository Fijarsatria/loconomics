"""Tahap 4 - Analisis spasial: dari titik menjadi 43 variabel per heksagon."""

from __future__ import annotations

import h3
import numpy as np
import pandas as pd

from config import (
    BOBOT_RUTE,
    H3_RESOLUSI,
    ISOCHRONE_MENIT,
    JAM_OPERASIONAL,
    JAM_PUNCAK_BERANGKAT,
    JAM_PUNCAK_PULANG,
    KAWASAN_PILOT,
    KELAS_INDUK,
    KELAS_KULINER,
    NILAI_KONDISI_PEMBELI,
)

#: C04 baru dihitung kalau sebanyak ini POI kuliner heksagon itu punya tag
#: `cuisine`. Tiga, bukan satu: entropi atas satu titik selalu tepat nol, dan
#: nol itu tidak bisa dibedakan dari "seluruhnya masakan yang sama".
MIN_CUISINE_BERTAG = 3

#: ...dan sebanyak ini pangsanya. Enam rumah makan dengan tiga bertag lolos;
#: dua puluh rumah makan dengan tiga bertag TIDAK - yang tiga itu tidak bisa
#: mewakili tujuh belas yang tidak diketahui.
MIN_CUISINE_PANGSA = 0.5

CINCIN_SIMPUL = 1


def bangun_isochrone() -> None:
    """Level 2. OSRM atau Valhalla di atas jaringan jalan OSM, mode pejalan kaki."""
    raise NotImplementedError


def bangun_grid_h3() -> None:
    """Level 3. Heksagon res-9 yang beririsan dengan isochrone 15 menit mana pun."""
    raise NotImplementedError


def hitung_dimensi_permintaan() -> None:
    """D01-D12. WorldPop zonal stats, jarak/waktu ke simpul, generator keramaian,
    skor ramai terkoreksi (Menu Go), intensitas transaksi (Struk Go).
    """
    raise NotImplementedError


def hitung_dimensi_perilaku() -> None:
    """B01-B09. Distribusi jam transaksi (bahan Commuter Clock), rasio weekend,
    pangsa digital, harga median porsi, spread, nominal median struk."""
    raise NotImplementedError




def simpul_terdekat_dari_rute(rute: pd.DataFrame) -> pd.DataFrame:
    """D03 jarak dan D04 waktu ke simpul terdekat, per heksagon."""
    kosong = pd.DataFrame(columns=["jarak_simpul_m", "waktu_jalan_menit"], dtype=float)
    if rute.empty:
        return kosong

    layak = rute[rute["menit"].notna() & (rute["menit"] > 0)]
    if layak.empty:
        return kosong

    pilih = layak.loc[layak.groupby("h3_index")["menit"].idxmin()].set_index("h3_index")
    hasil = pd.DataFrame(
        {
            "jarak_simpul_m": pilih["jarak_m"].round(1),
            "waktu_jalan_menit": pilih["menit"].round(2),
        }
    )
    hasil.index.name = "h3_index"
    return hasil


def waktu_jalan_dari_rute(rute: pd.DataFrame) -> pd.Series:
    """D04 saja. Tipis di atas `simpul_terdekat_dari_rute` supaya pemanggil
    yang cuma butuh menit tidak perlu tahu D03 ikut dihitung."""
    return simpul_terdekat_dari_rute(rute)["waktu_jalan_menit"]



# Minimal struk berjam nyata dalam satu jam sebelum jam itu disebut "observed".
# Di bawah ini, angkanya tetap disimpan tetapi ditandai proxy - satu struk tidak
# cukup untuk menyebut sesuatu "pola".
MIN_STRUK_OBSERVED = 3

BENTUK_JAM_JENDELA = 0.85
BENTUK_JAM_TENGAH_HARI = 0.35
BENTUK_JAM_MALAM = 0.20

# Seberapa besar bentuk jam menentukan hasil, dibanding konteks heksagon.
# Setengah-setengah: keduanya proksi, tidak ada alasan memihak salah satunya.
BOBOT_BENTUK_JAM = 0.5

# Hasil tidak pernah menyentuh 0 atau 1. Keduanya berarti "pasti", dan tidak ada
# proksi yang berhak sepasti itu. Batas ini yang menjaga angkanya tetap jujur.
CAPTIVE_MIN, CAPTIVE_MAKS = 0.05, 0.95


def _bentuk_jam(jam: int) -> float:
    """Kecenderungan captive dari jamnya saja, sebelum konteks heksagon."""
    if JAM_PUNCAK_BERANGKAT[0] <= jam <= JAM_PUNCAK_BERANGKAT[1]:
        return BENTUK_JAM_JENDELA
    if JAM_PUNCAK_PULANG[0] <= jam <= JAM_PUNCAK_PULANG[1]:
        return BENTUK_JAM_JENDELA
    if jam >= 20:
        return BENTUK_JAM_MALAM
    return BENTUK_JAM_TENGAH_HARI


def _norm01(s: pd.Series) -> pd.Series:
    """Min-max ke [0,1]. Nilai kosong jadi 0,5 - netral, bukan nol."""
    x = pd.to_numeric(s, errors="coerce").astype(float)
    lo, hi = x.min(), x.max()
    if pd.isna(lo) or pd.isna(hi) or hi == lo:
        return pd.Series(0.5, index=s.index)
    return ((x - lo) / (hi - lo)).fillna(0.5)


def konteks_captive(hex_df: pd.DataFrame) -> pd.Series:
    """Kecenderungan captive satu heksagon, dari konteksnya. Skala [0,1]."""
    return (
        0.35 * _norm01(hex_df["kepadatan_kos"])
        + 0.20 * (1 - _norm01(hex_df["kepadatan_kantor"]))
        + 0.25 * (1 - _norm01(hex_df["njop_persentil"]))
        + 0.20 * (1 - _norm01(hex_df["pangsa_digital"]))
    )


def profil_jam(struk: pd.DataFrame, hex_df: pd.DataFrame) -> pd.DataFrame:
    """Bangun isi tabel hex_hourly_profiles."""
    if struk.empty:
        return pd.DataFrame(
            columns=["h3_index", "jam", "n_transaksi", "nominal_total",
                     "nominal_median", "pangsa_captive", "metode"]
        )

    dalam_rentang = struk[struk["jam"].isin(JAM_OPERASIONAL)]
    agg = (
        dalam_rentang.groupby(["h3_index", "jam"])
        .agg(
            n_transaksi=("total_nominal", "size"),
            nominal_total=("total_nominal", "sum"),
            nominal_median=("total_nominal", "median"),
        )
        .reset_index()
    )

    konteks = konteks_captive(hex_df)
    agg["_konteks"] = agg["h3_index"].map(konteks).fillna(0.5)
    agg["_bentuk"] = agg["jam"].map(_bentuk_jam)

    agg["pangsa_captive"] = (
        BOBOT_BENTUK_JAM * agg["_bentuk"] + (1 - BOBOT_BENTUK_JAM) * agg["_konteks"]
    ).clip(CAPTIVE_MIN, CAPTIVE_MAKS).round(4)

    agg["metode"] = np.where(agg["n_transaksi"] >= MIN_STRUK_OBSERVED, "observed", "proxy")

    return agg.drop(columns=["_konteks", "_bentuk"])


def belanja_per_jam(profil: pd.DataFrame) -> pd.Series:
    """B10 - rupiah yang berpindah per jam operasional, per heksagon."""
    if profil.empty:
        return pd.Series(dtype=float)
    g = profil.groupby("h3_index")
    return (g["nominal_total"].sum() / g["jam"].nunique()).round(0)


# ---------------------------------------------------------------------------
# PriceLens - harga sewa per m²
# ---------------------------------------------------------------------------


def harga_sewa_per_m2(properti: pd.DataFrame) -> pd.Series:
    """P07 - median sewa bulanan per m², per heksagon."""
    if properti.empty:
        return pd.Series(dtype=float)

    layak = properti[
        properti["periode"].isin(["bulan", "tahun"])
        & properti["harga_nominal"].notna()
        & properti["luas_m2"].notna()
        & (properti["luas_m2"] > 0)
    ].copy()
    if layak.empty:
        return pd.Series(dtype=float)

    bulanan = np.where(
        layak["periode"] == "tahun", layak["harga_nominal"] / 12, layak["harga_nominal"]
    )
    layak["_per_m2"] = bulanan / layak["luas_m2"]
    return layak.groupby("h3_index")["_per_m2"].median().round(0)




def kelas_dominan(poi: pd.DataFrame) -> pd.Series:
    """Kelas induk yang paling banyak berdiri di tiap heksagon."""
    if poi.empty:
        return pd.Series(dtype=object)
    prioritas = {k: i for i, k in enumerate(KELAS_INDUK)}
    n = poi.groupby(["h3_index", "kelas_induk"]).size().rename("n").reset_index()
    n["_urut"] = n["kelas_induk"].map(prioritas)
    n = n.sort_values(["h3_index", "n", "_urut"], ascending=[True, False, True])
    return n.groupby("h3_index")["kelas_induk"].first()


def n_kompetitor_langsung(poi: pd.DataFrame, dominan: pd.Series) -> pd.Series:
    """C01 - POI sekelas dominan di heksagon ini DITAMBAH k-ring 1."""
    if poi.empty or dominan.empty:
        return pd.Series(dtype=float)
    hitung = poi.groupby(["h3_index", "kelas_induk"]).size().to_dict()
    hasil = {
        h3i: sum(hitung.get((t, kelas), 0) for t in h3.grid_disk(h3i, 1))
        for h3i, kelas in dominan.items()
    }
    return pd.Series(hasil, dtype=float)


def kepadatan_poi_total(poi: pd.DataFrame) -> pd.Series:
    """C02 - seluruh tempat usaha di heksagon itu. Hitungan, bukan per km2:
    luas heksagon res-9 sama untuk semuanya, jadi membaginya cuma menggeser
    skala tanpa menambah satu pun informasi."""
    if poi.empty:
        return pd.Series(dtype=float)
    return poi.groupby("h3_index").size().astype(float)


def keragaman_usaha(poi: pd.DataFrame) -> pd.Series:
    """C03 - entropi Shannon delapan kelas induk, dibagi ln(8) supaya [0,1]."""
    if poi.empty:
        return pd.Series(dtype=float)
    n = poi.groupby(["h3_index", "kelas_induk"]).size()
    pembagi = np.log(len(KELAS_INDUK))

    def _entropi(s: pd.Series) -> float:
        p = s.to_numpy(dtype=float)
        p = p / p.sum()
        # `+ 0.0` meniadakan nol NEGATIF. Satu kelas tunggal menghasilkan
        # -(1 * ln 1) = -0.0, yang sama dengan 0.0 di mana pun tetapi terbaca
        # seperti galat oleh siapa pun yang melihatnya di basis data.
        return float(-(p * np.log(p)).sum() / pembagi) + 0.0

    return n.groupby(level=0).apply(_entropi)


def pangsa_waralaba(poi: pd.DataFrame) -> pd.Series:
    """C05 - persen POI bermerek nasional/internasional."""
    if poi.empty:
        return pd.Series(dtype=float)
    return (poi.groupby("h3_index")["is_waralaba"].mean() * 100).round(2)


def rasio_kompetitor_per_kapita(c01: pd.Series, pop: pd.Series) -> pd.Series:
    """C06 = C01 / D01. Bobot 0,45 di indeks kompetisi - yang terbesar."""
    a = pd.to_numeric(c01, errors="coerce").astype(float)
    b = pd.to_numeric(pop, errors="coerce").astype(float)
    b = b.where(b > 0)
    return (a / b).replace([np.inf, -np.inf], np.nan)


ISI_NOL = ("n_kompetitor_langsung", "kepadatan_poi_total")
BIARKAN_KOSONG = ("keragaman_usaha", "keragaman_kuliner", "pangsa_waralaba")


def keragaman_kuliner(
    poi: pd.DataFrame,
    min_bertag: int = MIN_CUISINE_BERTAG,
    min_pangsa: float = MIN_CUISINE_PANGSA,
) -> pd.Series:
    """C04 - entropi Shannon JENIS MASAKAN, dari tag `cuisine` OSM."""
    if poi.empty or "cuisine" not in poi.columns:
        return pd.Series(dtype=float)

    kul = poi[poi["kelas_induk"].isin(KELAS_KULINER)]
    if kul.empty:
        return pd.Series(dtype=float)

    # Satu POI boleh membawa beberapa masakan ("indonesian;chinese"). Keduanya
    # dihitung - rumah makan yang menyajikan dua masakan memang menambah dua
    # pilihan bagi orang yang lewat.
    baris = []
    for h3i, c in zip(kul["h3_index"], kul["cuisine"]):
        for jenis in str(c).split(";"):
            jenis = jenis.strip().lower()
            if jenis:
                baris.append((h3i, jenis))
    if not baris:
        return pd.Series(dtype=float)

    tag = pd.DataFrame(baris, columns=["h3_index", "jenis"])
    n_jenis_global = tag["jenis"].nunique()
    pembagi = np.log(n_jenis_global) if n_jenis_global > 1 else 1.0

    n_kuliner = kul.groupby("h3_index").size()
    n_bertag = (
        kul[kul["cuisine"].astype(str).str.len() > 0].groupby("h3_index").size()
    )

    hasil = {}
    for h3i, sub in tag.groupby("h3_index"):
        bertag = int(n_bertag.get(h3i, 0))
        if bertag < min_bertag:
            continue
        if bertag / float(n_kuliner.get(h3i, bertag)) < min_pangsa:
            continue
        pp = sub["jenis"].value_counts().to_numpy(dtype=float)
        pp = pp / pp.sum()
        hasil[h3i] = float(-(pp * np.log(pp)).sum() / pembagi) + 0.0

    return pd.Series(hasil, dtype=float).sort_index()


def bobot_simpul(
    henti: pd.DataFrame,
    rute: pd.DataFrame,
    semua_hex: pd.Index | None = None,
    cincin: int = CINCIN_SIMPUL,
) -> pd.Series:
    """D05 `skor_simpul` - jumlah bobot RUTE UNIK yang berhenti di sekitar."""
    if henti.empty or rute.empty:
        return pd.Series(dtype=float)

    gabung = rute.merge(henti[["ref", "h3_index"]], on="ref", how="inner")
    if gabung.empty:
        return pd.Series(dtype=float)

    if cincin > 0:
        sebar = []
        for h3i, lin, moda in zip(
            gabung["h3_index"], gabung["lin"], gabung["moda"]
        ):
            for tetangga in h3.grid_disk(h3i, cincin):
                sebar.append((tetangga, lin, moda))
        gabung = pd.DataFrame(sebar, columns=["h3_index", "lin", "moda"])

    unik = gabung.drop_duplicates(subset=["h3_index", "lin"])
    unik = unik.assign(bobot=unik["moda"].map(BOBOT_RUTE).fillna(BOBOT_RUTE["bus"]))
    hasil = unik.groupby("h3_index")["bobot"].sum().round(2)

    if semua_hex is not None:
        hasil = hasil.reindex(semua_hex).fillna(0.0)
    return hasil


def dimensi_kompetisi(
    poi: pd.DataFrame,
    pop: pd.Series | None = None,
    semua_hex: pd.Index | None = None,
) -> pd.DataFrame:
    """C01, C02, C03, C04, C05, dan - kalau D01 diberikan - C06."""
    dominan = kelas_dominan(poi)
    hasil = pd.DataFrame(
        {
            "n_kompetitor_langsung": n_kompetitor_langsung(poi, dominan),
            "kepadatan_poi_total": kepadatan_poi_total(poi),
            "keragaman_usaha": keragaman_usaha(poi),
            "keragaman_kuliner": keragaman_kuliner(poi),
            "pangsa_waralaba": pangsa_waralaba(poi),
        }
    )
    if semua_hex is not None:
        hasil = hasil.reindex(semua_hex)
        for k in ISI_NOL:
            hasil[k] = hasil[k].fillna(0.0)
    hasil.index.name = "h3_index"

    # C06 dihitung SESUDAH pengisian nol, bukan sebelumnya. Heksagon tanpa
    # kompetitor punya rasio nol per kapita - itu angka yang sah dan penting,
    # dan menghitungnya lebih dulu akan meninggalkannya kosong selamanya.
    if pop is not None:
        hasil["rasio_kompetitor_per_kapita"] = rasio_kompetitor_per_kapita(
            hasil["n_kompetitor_langsung"], pop.reindex(hasil.index)
        )
    return hasil



def dimensi_konteks(
    konteks: pd.DataFrame, semua_hex: pd.Index | None = None
) -> pd.DataFrame:
    """D08 kepadatan_kantor dan D09 generator_keramaian, dari POI konteks OSM."""
    if konteks.empty:
        return pd.DataFrame(columns=["kepadatan_kantor", "generator_keramaian"])
    n = konteks.pivot_table(
        index="h3_index", columns="jenis", aggfunc="size", fill_value=0
    )
    if semua_hex is not None:
        n = n.reindex(semua_hex).fillna(0)
    ramai = [j for j in ("sekolah", "rumah_sakit", "pasar", "ibadah") if j in n.columns]
    hasil = pd.DataFrame(index=n.index)
    hasil["kepadatan_kantor"] = n["kantor"].astype(float) if "kantor" in n else 0.0
    hasil["generator_keramaian"] = n[ramai].sum(axis=1).astype(float) if ramai else 0.0
    hasil.index.name = "h3_index"
    return hasil



SUBPIKSEL = 5


def penduduk_per_heksagon(
    nilai: np.ndarray,
    kiri: float,
    atas: float,
    lebar_piksel: float,
    tinggi_piksel: float,
    nodata: float | None = None,
    subpiksel: int = SUBPIKSEL,
) -> pd.Series:
    """Jumlahkan raster penduduk ke heksagon H3 res-9."""
    if nilai.size == 0:
        return pd.Series(dtype=float)

    baris, kolom = nilai.shape
    sah = np.isfinite(nilai)
    if nodata is not None:
        sah &= nilai != nodata
    sah &= nilai > 0
    if not sah.any():
        return pd.Series(dtype=float)

    # Offset titik tengah tiap subpiksel, dalam pecahan satu piksel.
    off = (np.arange(subpiksel) + 0.5) / subpiksel
    bagian = 1.0 / (subpiksel * subpiksel)

    i, j = np.nonzero(sah)
    v = nilai[i, j].astype(float) * bagian

    kantong: dict[str, float] = {}
    for di in off:
        lat = atas - (i + di) * tinggi_piksel
        for dj in off:
            lon = kiri + (j + dj) * lebar_piksel
            for la, lo, x in zip(lat, lon, v):
                sel = h3.latlng_to_cell(la, lo, H3_RESOLUSI)
                kantong[sel] = kantong.get(sel, 0.0) + x

    hasil = pd.Series(kantong, dtype=float).round(1)
    hasil.index.name = "h3_index"
    return hasil



def morfologi_bangunan(
    bangunan: pd.DataFrame, semua_hex: pd.Index | None = None
) -> pd.DataFrame:
    """M01 rasio tutupan bangunan dan M02 luas bangunan median."""
    kolom = ["rasio_tutupan_bangunan", "luas_bangunan_median"]
    if bangunan.empty:
        return pd.DataFrame(columns=kolom, dtype=float)

    g = bangunan.groupby("h3_index")["luas_m2"]
    hasil = pd.DataFrame({"_total": g.sum(), "luas_bangunan_median": g.median()})
    luas_sel = pd.Series(
        {s: h3.cell_area(s, unit="m^2") for s in hasil.index}, dtype=float
    )
    hasil["rasio_tutupan_bangunan"] = (hasil["_total"] / luas_sel * 100).round(2)
    hasil["luas_bangunan_median"] = hasil["luas_bangunan_median"].round(1)
    hasil = hasil[kolom]

    if semua_hex is not None:
        hasil = hasil.reindex(semua_hex)
        hasil["rasio_tutupan_bangunan"] = hasil["rasio_tutupan_bangunan"].fillna(0.0)
    hasil.index.name = "h3_index"
    return hasil





def _pangsa(seri: pd.Series, syarat) -> float:
    """Persen anggota yang memenuhi syarat. Kosong -> NaN, bukan nol."""
    layak = seri.dropna()
    if layak.empty:
        return float("nan")
    return round(float(syarat(layak).mean()) * 100, 2)


def dimensi_misi(
    menu: pd.DataFrame,
    struk: pd.DataFrame,
    properti: pd.DataFrame,
    aktivitas: pd.DataFrame,
    semua_hex: pd.Index | None = None,
) -> pd.DataFrame:
    """B06, B07, B08, C07, C08, D10, D12, P03, dan penanda Q01."""
    kolom = [
        "harga_median_porsi", "spread_harga", "pangsa_digital", "rasio_keliling",
        "n_menetap_kuliner", "skor_ramai_terkoreksi", "aktivitas_komunitas",
        "pasokan_sewa_komersial",
    ]
    bagian: dict[str, pd.Series] = {}

    if not menu.empty:
        g = menu.groupby("h3_index")
        bagian["harga_median_porsi"] = g["harga_rata_porsi"].median().round(0)

        def _sebar(s: pd.Series) -> float:
            s = s.dropna()
            if len(s) < 2 or s.median() <= 0:
                return float("nan")
            return round(float(s.max() - s.min()) / float(s.median()), 3)

        bagian["spread_harga"] = g["harga_rata_porsi"].apply(_sebar)
        bagian["rasio_keliling"] = g["mobilitas_keliling"].apply(
            lambda s: _pangsa(s, lambda x: x.astype(bool))
        )
        bagian["n_menetap_kuliner"] = g["mobilitas_keliling"].apply(
            lambda s: float((~s.dropna().astype(bool)).sum()) if s.notna().any() else float("nan")
        )
        bagian["skor_ramai_terkoreksi"] = g["kondisi_pembeli"].apply(
            lambda s: round(float(
                s.dropna().str.lower().map(NILAI_KONDISI_PEMBELI).dropna().mean()
            ), 3) if s.notna().any() else float("nan")
        )

    if not struk.empty:
        bagian["pangsa_digital"] = struk.groupby("h3_index")["metode_bayar"].apply(
            lambda s: _pangsa(s, lambda x: x.str.strip().str.lower() != "tunai")
        )

    if not properti.empty:
        bagian["pasokan_sewa_komersial"] = properti.groupby("h3_index")["status"].apply(
            lambda s: float((s.dropna() == "sewa").sum()) if s.notna().any() else float("nan")
        )

    if not aktivitas.empty:
        bagian["aktivitas_komunitas"] = (
            aktivitas.groupby("h3_index").size().astype(float)
        )

    hasil = pd.DataFrame(bagian) if bagian else pd.DataFrame(columns=kolom, dtype=float)
    for k in kolom:
        if k not in hasil.columns:
            hasil[k] = float("nan")
    hasil = hasil[kolom]

    # Q01: upaya survei. Menghitung TITIK, bukan heksagon - dan menjumlahkan
    # ketiga misi karena badge keyakinan menjawab "seberapa banyak orang sudah
    # datang ke sini", bukan "misi mana yang dikerjakan".
    n = pd.concat(
        [d["h3_index"] for d in (menu, struk, properti) if not d.empty]
    ).value_counts() if any(not d.empty for d in (menu, struk, properti)) else pd.Series(dtype=int)

    if semua_hex is not None:
        hasil = hasil.reindex(semua_hex)
        n = n.reindex(semua_hex).fillna(0)
    hasil["n_titik_misi"] = n.reindex(hasil.index).fillna(0).astype(int)
    hasil.index.name = "h3_index"
    return hasil




#: Zona yang jelas mengizinkan kegiatan usaha.
ZONA_USAHA = {"K"}

ZONA_BUKAN_TEMPAT_USAHA = {"BA", "BJ", "RTH", "HK", "PTL"}


PANGSA_USAHA_MIN = 0.02

#: Cakupan RDTR minimum sebelum satu heksagon boleh dinyatakan DILARANG.
#: Heksagon di tepi DKI sebagian bidangnya tidak tertutup poligon RDTR mana pun,
#: dan menyimpulkan larangan dari potongan kecil sama saja menebak.
CAKUPAN_MIN = 0.80

#: KRB dari RDTR, dinormalkan ke [0,1]. "Tidak Ada" berarti tidak masuk kawasan
#: rawan - itu NOL yang sah, bukan kekosongan.
RISIKO_BANJIR_RDTR = {
    "sangat tinggi": 1.0, "tinggi": 0.75, "sedang": 0.5,
    "rendah": 0.25, "sangat rendah": 0.1, "tidak ada": 0.0,
}


def _skor_krb(teks: str | None) -> float | None:
    """'Kawasan Rawan Banjir - Sangat Tinggi' -> 1,0. Tak dikenal -> None."""
    if not teks:
        return None
    kunci = str(teks).split("-")[-1].strip().lower()
    return RISIKO_BANJIR_RDTR.get(kunci)


def dimensi_lahan(
    rdtr: dict[str, list], semua_hex: pd.Index | None = None
) -> pd.DataFrame:
    """L01 izin usaha, L02 kelas zona, L03 risiko banjir - dari RDTR."""
    kolom = ["zona_izin_komersial", "kelas_zona", "risiko_banjir"]
    baris: dict[str, dict] = {}

    for sel, zona in rdtr.items():
        if not zona:
            continue
        luas: dict[str, float] = {}
        nama: dict[str, str] = {}
        krb_tertimbang, krb_luas = 0.0, 0.0
        for z in zona:
            p = float(z.get("pangsa") or 0.0)
            if p <= 0:
                continue
            kod = z.get("KODZON")
            luas[kod] = luas.get(kod, 0.0) + p
            nama[kod] = z.get("NAMZON") or kod
            skor = _skor_krb(z.get("KRB_03"))
            if skor is not None:
                krb_tertimbang += skor * p
                krb_luas += p

        if not luas:
            continue
        total = sum(luas.values())
        dominan = max(luas, key=luas.get)
        pangsa_usaha = sum(v for k, v in luas.items() if k in ZONA_USAHA) / total

        if pangsa_usaha >= PANGSA_USAHA_MIN:
            izin = True
        elif total >= CAKUPAN_MIN and all(k in ZONA_BUKAN_TEMPAT_USAHA for k in luas):
            izin = False
        else:
            izin = None

        baris[sel] = {
            "zona_izin_komersial": izin,
            "kelas_zona": (nama.get(dominan) or "")[:40] or None,
            "risiko_banjir": round(krb_tertimbang / krb_luas, 3) if krb_luas else None,
        }

    hasil = pd.DataFrame.from_dict(baris, orient="index")
    for k in kolom:
        if k not in hasil.columns:
            hasil[k] = None
    hasil = hasil[kolom]

    hasil["zona_izin_komersial"] = hasil["zona_izin_komersial"].astype(object)

    if semua_hex is not None:
        hasil = hasil.reindex(semua_hex)
    hasil.index.name = "h3_index"
    return hasil

def hitung_dimensi_kompetisi() -> None:
    """C01-C08."""
    raise NotImplementedError


def hitung_dimensi_biaya() -> None:
    """P01-P06. NJOP zonal median + persentil, pasokan sewa, rasio sewa/jual,
    harga sewa median (dari A1), indeks churn."""
    raise NotImplementedError


def hitung_dimensi_risiko() -> None:
    """L01-L03."""
    raise NotImplementedError


def hitung_dimensi_morfologi() -> None:
    """M01-M03. Tutupan bangunan, luas median (Open Buildings), prestise visual (A3)."""
    raise NotImplementedError


def hitung_penanda_kualitas() -> None:
    """Q01-Q03. n_titik_misi -> tingkat_keyakinan lewat config.tingkat_keyakinan()."""
    raise NotImplementedError



#: Lintang acuan proyeksi ekuirektangular. Keenam kawasan pilot terbentang
#: -6,18..-6,39; pada lintang acuan -6,28 selisih skala bujurnya di bawah 0,05%,
#: jauh di bawah ketelitian titik OSM itu sendiri.
LAT_ACUAN_BLOK = -6.28
_M_LAT = 110_574.0
_M_LON = 111_320.0 * float(np.cos(np.radians(LAT_ACUAN_BLOK)))

USAHA_BLOK_M = 150
PENARIK_BLOK_M = 250

RADIUS_TARIK_M = 2600


def _xy(lat, lon) -> np.ndarray:
    """(lat, lon) derajat -> (x, y) meter, ekuirektangular di LAT_ACUAN_BLOK."""
    lat = np.asarray(lat, dtype=float)
    lon = np.asarray(lon, dtype=float)
    return np.column_stack(((lon - 106.85) * _M_LON, (lat - LAT_ACUAN_BLOK) * _M_LAT))


def blok_dari_heksagon(semua_hex, resolusi: int) -> pd.DataFrame:
    """Anak-anak H3 tiap heksagon -> satu baris per blok."""
    baris = []
    for induk in semua_hex:
        for anak in sorted(h3.cell_to_children(induk, resolusi)):
            la, lo = h3.cell_to_latlng(anak)
            baris.append(
                {
                    "h3_blok": anak,
                    "h3_induk": induk,
                    "lat": la,
                    "lon": lo,
                    "luas_m2": h3.cell_area(anak, unit="m^2"),
                }
            )
    return pd.DataFrame(baris, columns=["h3_blok", "h3_induk", "lat", "lon", "luas_m2"]).set_index("h3_blok")


def _hitung_dalam_radius(pusat: np.ndarray, titik: np.ndarray, radius: float) -> np.ndarray:
    """Berapa titik dalam `radius` meter dari tiap pusat. Nol yang SAH (OSM
    menanyai seluruh wilayah, jadi tidak ada = tidak terpetakan di sana)."""
    from scipy.spatial import cKDTree

    if len(titik) == 0:
        return np.zeros(len(pusat), dtype=int)
    pohon = cKDTree(titik)
    return np.array([len(x) for x in pohon.query_ball_point(pusat, r=radius)], dtype=int)


def indikator_blok(
    blok: pd.DataFrame,
    *,
    poi: pd.DataFrame,
    konteks: pd.DataFrame,
    henti: pd.DataFrame,
    jalan: pd.DataFrame,
    bangunan: pd.DataFrame,
    rdtr_blok: dict[str, list],
    ors_blok: dict[str, dict],
    pusat_kawasan: dict[str, tuple[float, float]],
    kawasan_induk: pd.Series,
) -> pd.DataFrame:
    """Seluruh indikator blok. Murni DataFrame - tanpa basis data, tanpa jaringan."""
    from shapely import STRtree
    from shapely.geometry import LineString

    hasil = pd.DataFrame(index=blok.index)
    pusat = _xy(blok["lat"], blok["lon"])

    # --- Sisa jarak ke tepi disc tarikan ---------------------------------------
    kaw = blok["h3_induk"].map(kawasan_induk)
    pusat_kaw = np.array([pusat_kawasan.get(k, (np.nan, np.nan)) for k in kaw], dtype=float)
    ke_pusat = np.hypot(*(pusat - _xy(pusat_kaw[:, 0], pusat_kaw[:, 1])).T)
    sisa_disc = RADIUS_TARIK_M - ke_pusat

    # --- 1. Waktu jalan kaki ke stasiun (ORS matrix) -------------------------
    hasil["menit_jalan"] = [
        (ors_blok.get(b) or {}).get("menit") for b in blok.index
    ]
    hasil["jarak_jalan_m"] = [
        (ors_blok.get(b) or {}).get("jarak_m") for b in blok.index
    ]

    # --- 2. Jalan utama & jalan terdekat ---------------------------------------
    hasil["jarak_jalan_utama_m"] = np.nan
    hasil["nama_jalan_utama"] = None
    hasil["kelas_jalan_utama"] = None
    hasil["jarak_jalan_terdekat_m"] = np.nan
    if not jalan.empty:
        garis = [
            LineString(_xy([la for _, la in k], [lo for lo, _ in k]))
            for k in jalan["koordinat"]
        ]
        from shapely.geometry import Point

        titik_blok = [Point(x, y) for x, y in pusat]
        for kolom_jarak, saring in (("jarak_jalan_terdekat_m", None), ("jarak_jalan_utama_m", True)):
            idx = np.arange(len(garis)) if saring is None else np.flatnonzero(jalan["utama"].to_numpy())
            if len(idx) == 0:
                continue
            pohon = STRtree([garis[i] for i in idx])
            ke, jarak = pohon.query_nearest(titik_blok, return_distance=True, all_matches=False)
            dekat = np.full(len(titik_blok), np.nan)
            pilih = np.full(len(titik_blok), -1)
            dekat[ke[0]] = jarak
            pilih[ke[0]] = idx[ke[1]]
            # Jalan yang lebih jauh daripada sisa disc tarikan tidak bisa
            # dipercaya: jalan yang sebenarnya terdekat mungkin di luar disc.
            tak_pasti = dekat > np.maximum(sisa_disc, 0)
            dekat[tak_pasti] = np.nan
            hasil[kolom_jarak] = np.round(dekat, 1)
            if saring:
                hasil["nama_jalan_utama"] = [
                    (jalan["nama"].iloc[p] if p >= 0 and not tp else None)
                    for p, tp in zip(pilih, tak_pasti)
                ]
                hasil["kelas_jalan_utama"] = [
                    (jalan["kelas"].iloc[p] if p >= 0 and not tp else None)
                    for p, tp in zip(pilih, tak_pasti)
                ]

    # --- 3. Usaha & pesaing sekelas dalam 150 m --------------------------------
    xy_poi = _xy(poi["lat"], poi["lon"]) if not poi.empty else np.empty((0, 2))
    hasil["n_usaha_150m"] = _hitung_dalam_radius(pusat, xy_poi, USAHA_BLOK_M)
    for kelas in KELAS_INDUK:
        pilih = poi["kelas_induk"].eq(kelas).to_numpy() if not poi.empty else np.zeros(0, bool)
        hasil[f"n_{kelas}_150m"] = _hitung_dalam_radius(pusat, xy_poi[pilih], USAHA_BLOK_M)

    # --- 4. Penarik keramaian dalam 250 m --------------------------------------
    jenis_penarik = ("sekolah", "rumah_sakit", "pasar", "ibadah", "kantor")
    total = np.zeros(len(pusat), dtype=int)
    for j in jenis_penarik:
        sub = konteks[konteks["jenis"].eq(j)] if not konteks.empty else konteks
        n = _hitung_dalam_radius(pusat, _xy(sub["lat"], sub["lon"]) if len(sub) else np.empty((0, 2)), PENARIK_BLOK_M)
        hasil[f"n_{j}_250m"] = n
        total = total + n
    hasil["n_penarik_250m"] = total

    # --- 5. Halte / titik henti angkutan terdekat ------------------------------
    hasil["jarak_halte_m"] = np.nan
    if not henti.empty:
        from scipy.spatial import cKDTree

        jarak, _ = cKDTree(_xy(henti["lat"], henti["lon"])).query(pusat)
        jarak = np.where(jarak > np.maximum(sisa_disc, 0), np.nan, jarak)
        hasil["jarak_halte_m"] = np.round(jarak, 1)

    # --- 6. Tutupan bangunan di dalam blok -------------------------------------
    if not bangunan.empty:
        sel = [h3.latlng_to_cell(la, lo, h3.get_resolution(blok.index[0])) for la, lo in zip(bangunan["lat"], bangunan["lon"])]
        per_sel = pd.DataFrame({"sel": sel, "luas": bangunan["luas_m2"].to_numpy()}).groupby("sel")["luas"].agg(["sum", "size"])
        luas = per_sel["sum"].reindex(blok.index)
        hasil["n_bangunan"] = per_sel["size"].reindex(blok.index).fillna(0).astype(int)
        # Nol yang SAH: footprint ditarik untuk seluruh disc, jadi blok tanpa
        # satu pun titik tengah bangunan memang tidak terbangun di OSM.
        hasil["rasio_tutupan_bangunan"] = (luas.fillna(0) / blok["luas_m2"]).round(4)
    else:
        hasil["n_bangunan"] = 0
        hasil["rasio_tutupan_bangunan"] = np.nan

    # --- 7. Zonasi RDTR per blok (DKI saja) -------------------------------------
    lahan = dimensi_lahan(rdtr_blok, semua_hex=blok.index)
    hasil["izin_komersial"] = lahan["zona_izin_komersial"].astype(object)
    hasil["kelas_zona"] = lahan["kelas_zona"]
    hasil["risiko_banjir"] = lahan["risiko_banjir"]
    pangsa_usaha = {}
    for b, zona in rdtr_blok.items():
        tot = sum(float(z.get("pangsa") or 0) for z in zona)
        if tot > 0:
            pangsa_usaha[b] = round(
                sum(float(z.get("pangsa") or 0) for z in zona if z.get("KODZON") in ZONA_USAHA) / tot, 4
            )
    hasil["pangsa_zona_usaha"] = pd.Series(pangsa_usaha).reindex(blok.index)
    return hasil


if __name__ == "__main__":
    print(f"Kawasan   : {len(KAWASAN_PILOT)} pilot")
    print(f"Resolusi  : H3 res-{H3_RESOLUSI}")
    print(f"Isochrone : {ISOCHRONE_MENIT} menit")
