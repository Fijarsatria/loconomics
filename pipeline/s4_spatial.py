"""Tahap 4 - Analisis spasial: dari titik menjadi 43 variabel per heksagon.

Empat level unit analisis (docs/data.md bagian 2.3):

  Level 1  SIMPUL TRANSPORTASI     ±120-150 simpul
  Level 2  KAWASAN JANGKAU         isochrone jalan kaki 5/10/15 menit
  Level 3  HEKSAGON H3 res-9       <- UNIT ANALISIS UTAMA, ini yang diskor
  Level 4  TITIK (POI individual)  detail saat diklik

Dua keputusan yang bukan detail kosmetik:

1. Isochrone, bukan buffer lingkaran. Buffer mengasumsikan orang bisa berjalan
   menembus tembok, sungai, dan rel. Lokasi yang secara garis lurus 200 m dari
   stasiun bisa butuh jalan memutar 900 m karena terhalang rel. Perbedaan ini
   persis yang membuat sebagian lokasi terlihat bagus di peta tetapi sepi
   di kenyataan.

2. Heksagon H3 res-9, bukan kelurahan. Kelurahan rata-rata 1-3 km2, sehingga
   sebuah hidden gem tenggelam dalam rata-rata seluruh kelurahan. Heksagon juga
   punya sifat berguna: jarak dari pusat ke semua tetangganya sama, sehingga
   analisis k-ring tidak bias arah seperti pada grid persegi.

SELURUH tahap ini berjalan OFFLINE. Backend tidak boleh menghitung routing
jaringan jalan saat peta dimuat.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from config import (
    H3_RESOLUSI,
    ISOCHRONE_MENIT,
    JAM_OPERASIONAL,
    JAM_PUNCAK_BERANGKAT,
    JAM_PUNCAK_PULANG,
    KAWASAN_PILOT,
)


def bangun_isochrone() -> None:
    """Level 2. OSRM atau Valhalla di atas jaringan jalan OSM, mode pejalan kaki.

    Keluaran -> tabel catchment_areas, satu baris per (simpul, menit).
    """
    raise NotImplementedError


def bangun_grid_h3() -> None:
    """Level 3. Heksagon res-9 yang beririsan dengan isochrone 15 menit mana pun.

    Membatasi grid ke dalam catchment (bukan seluruh Jabodetabek) menjaga jumlah
    heksagon tetap masuk akal untuk free tier dan sesuai ruang lingkup PRD.
    """
    raise NotImplementedError


def hitung_dimensi_permintaan() -> None:
    """D01-D12. WorldPop zonal stats, jarak/waktu ke simpul, generator keramaian,
    skor ramai terkoreksi (Menu Go), intensitas transaksi (Struk Go)."""
    raise NotImplementedError


def hitung_dimensi_perilaku() -> None:
    """B01-B09. Distribusi jam transaksi (bahan Commuter Clock), rasio weekend,
    pangsa digital, harga median porsi, spread, nominal median struk."""
    raise NotImplementedError


# ---------------------------------------------------------------------------
# Commuter Clock - profil per jam + pemisahan captive / choice rider
# ---------------------------------------------------------------------------
# Bagian ini SUDAH JALAN. Ia hanya butuh dua DataFrame dan tidak menyentuh
# jaringan jalan, jadi bisa diuji sekarang tanpa menunggu data lapangan.

# Minimal struk berjam nyata dalam satu jam sebelum jam itu disebut "observed".
# Di bawah ini, angkanya tetap disimpan tetapi ditandai proxy - satu struk tidak
# cukup untuk menyebut sesuatu "pola".
MIN_STRUK_OBSERVED = 3

# Bobot bentuk jam. Captive rider terikat jadwal: ia berangkat dan pulang pada
# jendela yang sempit dan hampir sama setiap hari kerja, dan belanjanya menempel
# pada perjalanan itu. Pembelian pukul 06:30 di sebelah stasiun hampir pasti
# pembelian orang yang sedang mengejar kereta; pembelian pukul 14:00 hampir pasti
# bukan.
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
    """Kecenderungan captive satu heksagon, dari konteksnya. Skala [0,1].

    Empat proksi, dipilih karena masing-masing tersedia di seluruh wilayah studi
    dan arahnya bisa dipertahankan saat ditanya:

      D07 kepadatan_kos    naik  -> captive naik. Penghuni kos jarang punya mobil.
      D08 kepadatan_kantor naik  -> captive TURUN. Kawasan kantor menarik pekerja
                                    yang punya pilihan moda.
      P02 njop_persentil   naik  -> captive TURUN. Kawasan mahal, penghuninya
                                    lebih mungkin punya kendaraan sendiri.
      B06 pangsa_digital   naik  -> captive TURUN. Proksi kasar daya beli.

    Ini estimasi, bukan pengukuran. Dataset misi tidak menanyakan kepemilikan
    kendaraan kepada siapa pun, dan tidak ada dataset publik yang menyediakannya
    pada resolusi heksagon. Yang bisa dilakukan adalah memakai proksi yang jelas
    arahnya, membatasi hasilnya supaya tidak pernah terdengar pasti, dan
    mengatakan terus terang bahwa ini proksi - ketiganya dilakukan di sini.
    """
    return (
        0.35 * _norm01(hex_df["kepadatan_kos"])
        + 0.20 * (1 - _norm01(hex_df["kepadatan_kantor"]))
        + 0.25 * (1 - _norm01(hex_df["njop_persentil"]))
        + 0.20 * (1 - _norm01(hex_df["pangsa_digital"]))
    )


def profil_jam(struk: pd.DataFrame, hex_df: pd.DataFrame) -> pd.DataFrame:
    """Bangun isi tabel hex_hourly_profiles.

    Masukan
      struk  : kolom h3_index, jam (0-23), total_nominal
               Struk tanpa jam TIDAK boleh masuk - aturan prompt A2. Saring di
               pemanggil, bukan di sini, supaya jumlah yang tersaring terlihat.
      hex_df : berindeks h3_index, memuat D07, D08, P02, B06

    Keluaran: satu baris per (h3_index, jam) untuk jam yang ada transaksinya,
    siap dimuat ke basis data. Jam tanpa transaksi TIDAK dibuat barisnya - API
    yang melengkapinya jadi 18 titik saat menyajikan, supaya "tidak ada baris"
    dan "nol transaksi" tetap bisa dibedakan di lapisan penyimpanan.
    """
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
    """B10 - rupiah yang berpindah per jam operasional, per heksagon.

    Pembaginya jumlah jam yang BERISI transaksi, bukan 18. Heksagon yang hanya
    ramai empat jam sehari tidak boleh terlihat sepi hanya karena empat belas jam
    sisanya tutup - yang ingin diketahui calon penyewa adalah seberapa deras
    uang mengalir saat tokonya buka.
    """
    if profil.empty:
        return pd.Series(dtype=float)
    g = profil.groupby("h3_index")
    return (g["nominal_total"].sum() / g["jam"].nunique()).round(0)


# ---------------------------------------------------------------------------
# PriceLens - harga sewa per m²
# ---------------------------------------------------------------------------


def harga_sewa_per_m2(properti: pd.DataFrame) -> pd.Series:
    """P07 - median sewa bulanan per m², per heksagon.

    Masukan: kolom h3_index, harga_nominal, periode, luas_m2 (keluaran A1).

    Dua keputusan yang menentukan benar tidaknya angka ini:

    1. Periode "tidak_disebut" DIBUANG, tidak ditebak (aturan pembersihan 9.6).
       "45jt" bisa berarti per bulan atau per tahun dan selisihnya dua belas kali
       lipat. Salah arah menggeser seluruh peta biaya satu kawasan, dan itu jenis
       kesalahan yang langsung terlihat begitu dibandingkan dengan NJOP.

    2. Yang diambil MEDIAN DARI RASIO, bukan rasio dari median. Median harga
       dibagi median luas bukan besaran yang punya arti - ia mencampur dua properti
       yang berbeda. Median dari (harga tiap properti / luas properti itu) adalah
       harga per m² yang benar-benar ada di pasar.
    """
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


def hitung_dimensi_kompetisi() -> None:
    """C01-C08.

    Kompetitor langsung (C01) = POI dalam KELAS INDUK YANG SAMA, di heksagon ini
    DITAMBAH k-ring 1. Bukan seluruh POI yang ada di sana.

    Kalau pengguna berencana membuka kedai kopi, apotek dan bengkel di sebelahnya
    bukan kompetitor - keduanya justru menambah alasan orang datang. Menghitung
    semua POI sebagai kompetitor membuat kawasan ramai dan bervariasi selalu
    terlihat "penuh kompetitor", padahal justru itu yang dicari.

    k-ring 1 dipakai karena jarak antarpusat heksagon res-9 sekitar 350 m dan
    konsumen pejalan kaki tidak berhenti di batas heksagon.
    """
    raise NotImplementedError


def hitung_dimensi_biaya() -> None:
    """P01-P06. NJOP zonal median + persentil, pasokan sewa, rasio sewa/jual,
    harga sewa median (dari A1), indeks churn."""
    raise NotImplementedError


def hitung_dimensi_risiko() -> None:
    """L01-L03.

    L01 zona_izin_komersial adalah GATE, bukan variabel biasa: kalau FALSE,
    skor peluang dinolkan berapa pun nilai variabel lain.

    Kawasan tanpa RDTR digital ditandai eksplisit, bukan diasumsikan mengizinkan.
    """
    raise NotImplementedError


def hitung_dimensi_morfologi() -> None:
    """M01-M03. Tutupan bangunan, luas median (Open Buildings), prestise visual (A3)."""
    raise NotImplementedError


def hitung_penanda_kualitas() -> None:
    """Q01-Q03. n_titik_misi -> tingkat_keyakinan lewat config.tingkat_keyakinan().

    data_source = 'observed' kalau ada titik misi, 'predicted' kalau nilainya
    berasal dari s5_impute. Heksagon tanpa data misi TIDAK diisi nol -
    "nol transaksi tercatat" dan "tidak ada transaksi di sini" adalah dua
    pernyataan yang sama sekali berbeda.
    """
    raise NotImplementedError


if __name__ == "__main__":
    print(f"Kawasan   : {len(KAWASAN_PILOT)} pilot")
    print(f"Resolusi  : H3 res-{H3_RESOLUSI}")
    print(f"Isochrone : {ISOCHRONE_MENIT} menit")
