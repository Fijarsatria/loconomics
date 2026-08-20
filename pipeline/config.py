"""Sumber kebenaran tunggal untuk seluruh pipeline.

Semua skrip s1-s6 mengimpor dari sini. Jangan pernah menulis ulang nilai-nilai
di bawah langsung di dalam skrip - kalau ada dua tempat, cepat atau lambat
keduanya berbeda dan hasil analisis jadi tidak bisa direproduksi.
"""

from pathlib import Path

# --- Wilayah studi ---------------------------------------------------------

# Enam kawasan pilot (PRD bagian 3). Ruang lingkup dikunci di sini - jangan melebar.
KAWASAN_PILOT = [
    "Manggarai",
    "Tanah Abang",
    "Depok Baru",
    "Bekasi",
    "Dukuh Atas BNI",
    "Harjamukti",
]

# Bounding box Jabodetabek. Titik di luar ini dibuang saat pembersihan koordinat.
BBOX = {"lon_min": 106.30, "lon_max": 107.10, "lat_min": -6.95, "lat_max": -5.95}

CRS = "EPSG:4326"
H3_RESOLUSI = 9  # ±0,10 km², lebar ±350 m
ISOCHRONE_MENIT = [5, 10, 15]

# Moda yang dicakup. Pelabuhan dan bandara sengaja dikecualikan karena pola
# belanja penumpangnya berbeda fundamental dari komuter harian.
MODA = ["KRL", "MRT", "LRT", "BRT", "TERMINAL"]


# --- Taksonomi usaha terpadu (docs/data.md bagian 4) -----------------------
# Delapan kelas induk. Satu POI hanya boleh masuk SATU kelas, kalau tidak
# kepadatan kompetitor terhitung dobel dan indeks IKP jadi salah.

KELAS_INDUK = {
    "F1": "Kuliner Duduk",
    "F2": "Kuliner Cepat/Informal",
    "R1": "Ritel Kebutuhan Harian",
    "R2": "Ritel Non-Pangan",
    "S1": "Jasa Personal",
    "S2": "Kesehatan",
    "K1": "Keuangan",
    "T1": "Transportasi",
}


# --- Pemetaan nama kolom CSV misi MAPID ------------------------------------
# WAJIB diverifikasi terhadap berkas CSV asli SEBELUM skrip apa pun dijalankan.
# Nama kolom di CSV asli sering berbeda dari yang tertulis di PDF ketentuan:
# ada spasi tambahan, kapitalisasi berbeda, atau disingkat. Satu jam mencocokkan
# di awal menghemat berjam-jam debugging.
#
# Status: BELUM DIVERIFIKASI - dataset sampel belum diunduh.

KOLOM_MENU_GO: dict[str, str] = {
    # "nama_kolom_di_csv": "nama_internal"
}
KOLOM_STRUK_GO: dict[str, str] = {}
KOLOM_PROPERTI_GO: dict[str, str] = {}


# --- Ambang pembersihan data (docs/data.md bagian 9) -----------------------

HARGA_PORSI_MIN = 1_000  # di bawah ini hampir pasti diketik dalam satuan ribuan
HARGA_PORSI_MAKS = 500_000  # di atas ini hampir pasti harga paket, bukan per porsi
WINSOR_PERSENTIL = (1, 99)

DEDUP_KEMIRIPAN_NAMA = 0.85  # rasio fuzzy minimum
DEDUP_JARAK_M = 30  # lebih kecil dari lebar heksagon
SNAP_GPS_M = 50  # tempel ke bangunan/jalan terdekat dalam radius ini

OCR_CONFIDENCE_MIN = 0.7  # di bawah ini -> antrean verifikasi manusia, tidak dipakai langsung


# --- Kamus Data Final: kode variabel -> nama kolom -------------------------
# 41 variabel analisis. Kode (D01, B07, ...) adalah identitas kanonik yang dipakai
# di dokumen, di tabel score_factors, dan di definisi bobot. Nama kolom adalah
# implementasinya di hex_features. Pemetaan ini yang menghubungkan keduanya -
# jangan pernah menulis salah satunya secara hardcode di skrip lain.

KODE_KE_KOLOM = {
    # Dimensi Permintaan - 12
    "D01": "pop_100m",
    "D02": "pop_usia_produktif",
    "D03": "jarak_simpul_m",
    "D04": "waktu_jalan_menit",
    "D05": "skor_simpul",
    "D06": "ridership_proksi",
    "D07": "kepadatan_kos",
    "D08": "kepadatan_kantor",
    "D09": "generator_keramaian",
    "D10": "skor_ramai_terkoreksi",
    "D11": "intensitas_transaksi",
    "D12": "aktivitas_komunitas",
    # Dimensi Perilaku Konsumen - 9
    "B01": "puncak_pagi",
    "B02": "puncak_siang",
    "B03": "puncak_sore",
    "B04": "puncak_malam",
    "B05": "rasio_weekend",
    "B06": "pangsa_digital",
    "B07": "harga_median_porsi",
    "B08": "spread_harga",
    "B09": "nominal_median_struk",
    # Dimensi Kompetisi - 8
    "C01": "n_kompetitor_langsung",
    "C02": "kepadatan_poi_total",
    "C03": "keragaman_usaha",
    "C04": "keragaman_kuliner",
    "C05": "pangsa_waralaba",
    "C06": "rasio_kompetitor_per_kapita",
    "C07": "rasio_keliling",
    "C08": "n_menetap_kuliner",
    # Dimensi Biaya & Pasokan Ruang - 6
    "P01": "njop_m2",
    "P02": "njop_persentil",
    "P03": "pasokan_sewa_komersial",
    "P04": "rasio_sewa_jual",
    "P05": "harga_sewa_median",
    "P06": "indeks_churn",
    # Dimensi Risiko & Legalitas - 3
    "L01": "zona_izin_komersial",
    "L02": "kelas_zona",
    "L03": "risiko_banjir",
    # Dimensi Morfologi & Prestise Visual - 3
    "M01": "rasio_tutupan_bangunan",
    "M02": "luas_bangunan_median",
    "M03": "skor_prestise_visual",
}

KOLOM_KE_KODE = {v: k for k, v in KODE_KE_KOLOM.items()}

assert len(KODE_KE_KOLOM) == 41, f"Kamus Data harus 41 variabel, sekarang {len(KODE_KE_KOLOM)}"

# Penanda kualitas - BUKAN variabel model, tidak masuk perhitungan skor
KODE_KUALITAS = {"Q01": "n_titik_misi", "Q02": "tingkat_keyakinan", "Q03": "data_source"}


# --- Ambang badge keyakinan (Q02) ------------------------------------------

KEYAKINAN_TINGGI_MIN = 30
KEYAKINAN_SEDANG_MIN = 10


def tingkat_keyakinan(n_titik_misi: int) -> str:
    """Satu-satunya tempat aturan badge didefinisikan."""
    if n_titik_misi >= KEYAKINAN_TINGGI_MIN:
        return "TINGGI"
    if n_titik_misi >= KEYAKINAN_SEDANG_MIN:
        return "SEDANG"
    return "RENDAH"


# --- Bobot skoring (docs/skoring.md) ---------------------------------------
# Bobot ini yang divariasikan +-0,10 saat uji sensitivitas. Target: korelasi
# peringkat Spearman terhadap baseline tetap di atas 0,85.

BOBOT_IPT = {"D05": 0.40, "D06": 0.35, "D04_inv": 0.25}
BOBOT_IAE = {"D11": 0.30, "D10": 0.25, "B07": 0.25, "B09": 0.20}
BOBOT_IKP = {"C06": 0.45, "C05": 0.30, "C03_inv": 0.25}
BOBOT_IBR = {"P01": 0.35, "P05": 0.30, "P06": 0.25, "L03": 0.10}

BOBOT_PELUANG = {"IPT": 0.35, "IAE": 0.35, "IKP": -0.20, "IBR": -0.10}
BOBOT_HIDDEN_GEM = {"residual": 0.40, "iptt": 0.30, "peluang_x_prestise": 0.30}

SENSITIVITAS_GESER = 0.10
SENSITIVITAS_RHO_MIN = 0.85


# --- Lokasi berkas ---------------------------------------------------------

ROOT = Path(__file__).parent
DATA = ROOT / "data"
DATA_MENTAH = DATA / "01_mentah"  # hasil unduh apa adanya, jangan diedit
DATA_BERSIH = DATA / "02_bersih"  # setelah s2_clean
DATA_OLAHAN = DATA / "03_olahan"  # siap masuk database
CACHE_AI = DATA / "cache_ai"  # hasil OCR - JANGAN panggil ulang API saat demo
PROMPTS = ROOT / "prompts"
