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

#: Dua dari delapan kelas induk yang dihitung sebagai kuliner untuk C04.
#: Didefinisikan di sini, bukan ditulis {"F1","F2"} di tempat pemakaiannya,
#: supaya menambah kelas kuliner ketiga tidak menuntut ingatan siapa pun.
KELAS_KULINER = ("F1", "F2")

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


# --- Tag OpenStreetMap -> kelas induk --------------------------------------
# Satu POI hanya boleh menghasilkan SATU kelas. OSM tidak menjamin itu: sebuah
# titik bisa membawa `amenity=restaurant` dan `shop=deli` sekaligus. Karena itu
# ada urutan kunci - yang lebih menentukan fungsi utamanya menang, dan sisanya
# diabaikan. Tanpa urutan yang tetap, hasil klasifikasi bergantung pada urutan
# iterasi dict dan berubah-ubah antar-jalan tanpa sebab yang terlihat.
URUTAN_TAG_OSM = ("amenity", "shop", "healthcare", "office", "craft", "leisure")

OSM_KE_KELAS: dict[tuple[str, str], str] = {
    # F1 - Kuliner Duduk
    ("amenity", "restaurant"): "F1",
    ("amenity", "cafe"): "F1",
    ("amenity", "bar"): "F1",
    ("amenity", "pub"): "F1",
    ("amenity", "food_court"): "F1",
    # F2 - Kuliner Cepat/Informal
    ("amenity", "fast_food"): "F2",
    ("amenity", "ice_cream"): "F2",
    ("shop", "bakery"): "F2",
    ("shop", "pastry"): "F2",
    ("shop", "confectionery"): "F2",
    ("shop", "coffee"): "F2",
    # R1 - Ritel Kebutuhan Harian
    ("shop", "convenience"): "R1",
    ("shop", "supermarket"): "R1",
    ("shop", "greengrocer"): "R1",
    ("shop", "butcher"): "R1",
    ("shop", "seafood"): "R1",
    ("shop", "beverages"): "R1",
    ("shop", "alcohol"): "R1",
    ("shop", "kiosk"): "R1",
    ("shop", "general"): "R1",
    ("shop", "grocery"): "R1",
    ("shop", "deli"): "R1",
    ("shop", "frozen_food"): "R1",
    ("amenity", "marketplace"): "R1",
    # R2 - Ritel Non-Pangan
    ("shop", "clothes"): "R2",
    ("shop", "shoes"): "R2",
    ("shop", "bag"): "R2",
    ("shop", "jewelry"): "R2",
    ("shop", "electronics"): "R2",
    ("shop", "mobile_phone"): "R2",
    ("shop", "computer"): "R2",
    ("shop", "furniture"): "R2",
    ("shop", "hardware"): "R2",
    ("shop", "doityourself"): "R2",
    ("shop", "books"): "R2",
    ("shop", "stationery"): "R2",
    ("shop", "sports"): "R2",
    ("shop", "toys"): "R2",
    ("shop", "florist"): "R2",
    ("shop", "gift"): "R2",
    ("shop", "variety_store"): "R2",
    ("shop", "department_store"): "R2",
    ("shop", "cosmetics"): "R2",
    ("shop", "pet"): "R2",
    ("shop", "photo"): "R2",
    ("shop", "watches"): "R2",
    ("shop", "fabric"): "R2",
    ("shop", "houseware"): "R2",
    # S1 - Jasa Personal
    ("shop", "hairdresser"): "S1",
    ("shop", "beauty"): "S1",
    ("shop", "massage"): "S1",
    ("shop", "laundry"): "S1",
    ("shop", "dry_cleaning"): "S1",
    ("shop", "tailor"): "S1",
    ("shop", "copyshop"): "S1",
    ("shop", "travel_agency"): "S1",
    ("leisure", "fitness_centre"): "S1",
    # S2 - Kesehatan
    ("amenity", "pharmacy"): "S2",
    ("amenity", "clinic"): "S2",
    ("amenity", "doctors"): "S2",
    ("amenity", "dentist"): "S2",
    ("amenity", "hospital"): "S2",
    ("amenity", "veterinary"): "S2",
    ("shop", "chemist"): "S2",
    ("shop", "optician"): "S2",
    ("shop", "medical_supply"): "S2",
    ("shop", "herbalist"): "S2",
    # K1 - Keuangan
    ("amenity", "bank"): "K1",
    ("amenity", "atm"): "K1",
    ("amenity", "bureau_de_change"): "K1",
    ("office", "financial"): "K1",
    ("office", "insurance"): "K1",
    # T1 - Transportasi
    ("amenity", "fuel"): "T1",
    ("amenity", "car_rental"): "T1",
    ("amenity", "car_wash"): "T1",
    ("amenity", "driving_school"): "T1",
    ("shop", "car"): "T1",
    ("shop", "car_repair"): "T1",
    ("shop", "car_parts"): "T1",
    ("shop", "motorcycle"): "T1",
    ("shop", "motorcycle_repair"): "T1",
    ("shop", "bicycle"): "T1",
    ("shop", "tyres"): "T1",
}

#: `healthcare=*` apa pun nilainya masuk S2, dan `craft=*` masuk S1. Keduanya
#: tag terbuka - nilainya tidak terbatas, jadi memetakannya satu per satu akan
#: selalu ketinggalan. Kelas induknya sudah pasti sekalipun nilainya belum.
KUNCI_OSM_TERBUKA = {"healthcare": "S2", "craft": "S1"}

#: Perkantoran TIDAK punya kelas induk, dan itu disengaja. Delapan kelas induk
#: adalah kelas KOMPETITOR - usaha yang memperebutkan pembeli yang sama. Sebuah
#: kantor notaris bukan pesaing warung; ia justru pemasok pembelinya. Karena itu
#: `office=*` hanya mengisi D08 kepadatan_kantor, kecuali dua nilai yang memang
#: melayani pelanggan langsung dan sudah terdaftar di K1 di atas.


def kelas_dari_tag(tag: dict[str, str]) -> tuple[str, str] | None:
    """Tentukan kelas induk satu POI OSM. None kalau ia bukan usaha.

    Mengembalikan (kelas_induk, kategori_asli). `kategori_asli` WAJIB disimpan
    ke `business_pois.kategori_asli` - tanpa itu tidak ada cara memeriksa ulang
    apakah sebuah POI dikelompokkan dengan benar, dan seluruh indeks kompetisi
    jadi angka yang harus dipercaya begitu saja.
    """
    for kunci in URUTAN_TAG_OSM:
        nilai = tag.get(kunci)
        if not nilai:
            continue
        kelas = OSM_KE_KELAS.get((kunci, nilai))
        if kelas:
            return kelas, f"{kunci}={nilai}"
        terbuka = KUNCI_OSM_TERBUKA.get(kunci)
        if terbuka:
            return terbuka, f"{kunci}={nilai}"
    return None


#: Penanda waralaba (C05). OSM memakai `brand` atau `brand:wikidata` untuk merek
#: yang punya identitas nasional. Ini proksi yang jujur arahnya tetapi tidak
#: lengkap: warung yang sebenarnya bagian dari jaringan lokal jarang diberi tag
#: `brand`, jadi pangsa waralaba dari OSM adalah BATAS BAWAH.
def is_waralaba(tag: dict[str, str]) -> bool:
    return bool(tag.get("brand") or tag.get("brand:wikidata") or tag.get("operator:wikidata"))


# --- Pemetaan nama kolom CSV misi MAPID ------------------------------------
# Status: DIVERIFIKASI 25 Agustus 2026 terhadap dataset sampel resmi MAPID
# (mapid.co.id/SampleMenuGo, /SampleStrukGo, /SamplePropertiGo,
# /SampleActivityMAPIDAPPS). Berkasnya ada di data/01_mentah/, tidak di-commit.
#
# Peringatan yang ternyata benar. Nama kolom asli MEMANG berbeda dari PDF
# ketentuan, dan bedanya bukan sepele:
#
#   Properti Go  nama kolomnya TERPOTONG 10 karakter - batas nama field DBF,
#                karena CSV-nya diekspor berdampingan dengan shapefile.
#                "Kategori Properti" jadi "Kategori P", "Foto Spanduk/Papan
#                Promosi" jadi "Foto Spand". Dan " Tanggal" BERSPASI DI DEPAN.
#   Struk Go     20 kolom, bukan 8. Tujuh di antaranya bertanda "(Lama)" -
#                sisa skema lama, dan pada sampel SELURUHNYA kosong.
#   Menu Go      "Nama Tempat Makan", tanpa garis miring seperti di PDF.
#
# Kedua bentuk didaftarkan sekaligus - yang terpotong DAN yang utuh. Ekspor
# shapefile memberi yang terpotong; API MAPID kemungkinan besar memberi yang
# utuh, dan kita belum bisa memastikannya sampai kuncinya ada. Memetakan
# keduanya ke satu nama internal membuat kedua jalur bekerja tanpa cabang.

KOLOM_MENU_GO: dict[str, str] = {
    "Nama Tempat Makan": "nama",
    "Nama Tempat/Makan": "nama",  # bentuk di PDF ketentuan
    "Jenis Tempat Makan": "jenis_tempat",
    "Tanggal": "tanggal",
    "Waktu": "waktu",
    "Foto Tempat": "foto_tempat",
    "Foto Menu 1 (Foto Menu Utama)": "foto_menu_1",
    "Foto Menu 2 (Foto Menu Lainnya)": "foto_menu_2",
    "Menu Dalam Bentuk Link Digital": "menu_digital",
    "Apa Menu Utama/Andalan Yang Dijual?": "menu_utama",
    "Berapa Harga Rata-rata Menu Tersebut (Per porsi)?": "harga_porsi",
    "Bagaimana Kondisi Pembeli Saat Kunjungan Dilakukan?": "kondisi_pembeli",
    "Apakah Berjualan Dengan Berkeliling (Mobilitas)?": "keliling",
    "Latitude": "lat",
    "Longitude": "lon",
}

KOLOM_STRUK_GO: dict[str, str] = {
    "Nama Tempat/Merchant": "nama",
    "Kategori Tempat": "kategori",
    "Tanggal Transaksi": "tanggal",
    "Waktu Transaksi": "waktu",
    "Metode Pembayaran": "metode_bayar",
    "Foto Struk/Bukti bayar": "foto_struk",
    "Foto Struk/Bukti Bayar": "foto_struk",  # kapitalisasi di PDF ketentuan
    "Kontributor": "kontributor",
    "ID data": "id_mapid",
    "Latitude": "lat",
    "Longitude": "lon",
}

KOLOM_PROPERTI_GO: dict[str, str] = {
    "Kategori P": "kategori",
    "Kategori Properti": "kategori",
    "Jenis Prop": "jenis",
    "Jenis Properti": "jenis",
    " Tanggal": "tanggal",  # spasi di depan memang ada di berkasnya
    "Tanggal": "tanggal",
    "Alamat": "alamat",
    "Foto Tampa": "foto_depan",
    "Foto Tampak Depan": "foto_depan",
    "Foto Spand": "foto_spanduk",
    "Foto Spanduk/Papan Promosi": "foto_spanduk",
    "Latitude": "lat",
    "Longitude": "lon",
}

KOLOM_ACTIVITY: dict[str, str] = {
    "title": "judul",
    "description": "deskripsi",
    "latitude": "lat",
    "longitude": "lon",
    "images": "gambar",
    "videos": "video",
    "medias": "media",
    "medias_all": "media_semua",
}


# --- Normalisasi nilai kategorikal misi ------------------------------------
# Nilai di lapangan juga tidak sama dengan yang tertulis di PDF, dan yang ini
# lebih berbahaya daripada nama kolom: nama kolom yang salah menghasilkan
# KeyError yang langsung terlihat, sedangkan nilai yang tidak dikenali diam-diam
# jatuh ke "tidak cocok" dan barisnya hilang dari agregasi tanpa satu pun galat.
#
# Ketiganya diverifikasi dari sampel yang sama:
#   - Properti Go menulis "Disewa"/"Dijual", bukan "Sewa"/"Jual"
#   - Menu Go menjawab dengan kalimat panjang berkurung, bukan satu kata
#   - satu nilai mobilitas berspasi di depan

NILAI_JENIS_PROPERTI = {"disewa": "sewa", "sewa": "sewa", "dijual": "jual", "jual": "jual"}

#: Dipakai menghitung D10 skor_ramai_terkoreksi. Skalanya ordinal, dan angkanya
#: sengaja 0/0,5/1 supaya sudah berada di skala ternormalisasi yang dipakai s6.
NILAI_KONDISI_PEMBELI = {"sepi": 0.0, "sedang": 0.5, "ramai": 1.0}

#: C07 rasio_keliling. True berarti pedagang berkeliling.
NILAI_MOBILITAS = {"ya": True, "tidak": False}


def kunci_nilai(teks: str | None) -> str:
    """Ambil kata pertama sebuah jawaban dropdown, dalam huruf kecil.

    "Ramai (Terdapat antrean lebih dari 3 orang / kursi atau meja mayoritas
    penuh terisi)" -> "ramai". " Tidak (Menetap/Mangkal di satu titik)" ->
    "tidak". Bentuk panjangnya bisa saja diubah panitia kapan saja; kata
    pertamanya jauh lebih stabil, dan itulah yang membawa artinya.
    """
    if not teks:
        return ""
    return teks.strip().split("(")[0].strip().split()[0].lower() if teks.strip() else ""


# --- Ambang pembersihan data (docs/data.md bagian 9) -----------------------

HARGA_PORSI_MIN = 1_000  # di bawah ini hampir pasti diketik dalam satuan ribuan
HARGA_PORSI_MAKS = 500_000  # di atas ini hampir pasti harga paket, bukan per porsi
WINSOR_PERSENTIL = (1, 99)

DEDUP_KEMIRIPAN_NAMA = 0.85  # rasio fuzzy minimum
DEDUP_JARAK_M = 30  # lebih kecil dari lebar heksagon
SNAP_GPS_M = 50  # tempel ke bangunan/jalan terdekat dalam radius ini

OCR_CONFIDENCE_MIN = 0.7  # di bawah ini -> antrean verifikasi manusia, tidak dipakai langsung


# --- Kamus Data Final: kode variabel -> nama kolom -------------------------
# 43 variabel analisis. Kode (D01, B07, ...) adalah identitas kanonik yang dipakai
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
    # Dimensi Perilaku Konsumen - 10
    "B01": "puncak_pagi",
    "B02": "puncak_siang",
    "B03": "puncak_sore",
    "B04": "puncak_malam",
    "B05": "rasio_weekend",
    "B06": "pangsa_digital",
    "B07": "harga_median_porsi",
    "B08": "spread_harga",
    "B09": "nominal_median_struk",
    "B10": "belanja_per_jam",
    # Dimensi Kompetisi - 8
    "C01": "n_kompetitor_langsung",
    "C02": "kepadatan_poi_total",
    "C03": "keragaman_usaha",
    "C04": "keragaman_kuliner",
    "C05": "pangsa_waralaba",
    "C06": "rasio_kompetitor_per_kapita",
    "C07": "rasio_keliling",
    "C08": "n_menetap_kuliner",
    # Dimensi Biaya & Pasokan Ruang - 7
    "P01": "njop_m2",
    "P02": "njop_persentil",
    "P03": "pasokan_sewa_komersial",
    "P04": "rasio_sewa_jual",
    "P05": "harga_sewa_median",
    "P06": "indeks_churn",
    "P07": "harga_sewa_per_m2",
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

assert len(KODE_KE_KOLOM) == 43, f"Kamus Data harus 43 variabel, sekarang {len(KODE_KE_KOLOM)}"

# B10 dan P07 sengaja TIDAK masuk bobot indeks mana pun. Keduanya variabel
# tampilan untuk PriceLens. Memasukkan P07 ke IBR menggantikan P05 memang lebih
# benar secara metodologi (sewa absolut mencampur harga dengan luas), tetapi
# mengubah bobot tanpa data lapangan akan membatalkan angka uji sensitivitas yang
# sudah dilaporkan. Ditinjau ulang setelah data survei masuk - lihat docs/skoring.md.
VARIABEL_TAMPILAN = {"B10", "P07"}

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

# --- Bobot moda rute untuk D05 `skor_simpul` -------------------------------
# D05 ditandai TURUNAN di docs/data.md - ia memang dihitung, bukan diukur. Yang
# dihitung: berapa banyak RUTE berbeda yang berhenti di heksagon itu, masing
# masing ditimbang menurut berapa banyak orang yang bisa dibawanya.
#
# Angkanya kasar dan memang tidak bisa presisi, tetapi urutannya bisa
# dipertanggungjawabkan dan itu yang menentukan peringkat: satu rangkaian KRL
# 12 gerbang membawa ~2.000 orang sekali jalan, satu bus gandeng Transjakarta
# ~150, satu angkot ~12. Rasio 10 : 3 : 1 mengikuti akar dari perbandingan itu,
# bukan perbandingannya mentah-mentah - memakai 160 : 12 : 1 akan membuat satu
# stasiun menenggelamkan seluruh jaringan bus di sekitarnya, dan yang kita ukur
# "seberapa penting simpul ini", bukan "berapa kursi yang lewat".
#
# `norm()` di s6 min-max, jadi yang berpengaruh pada skor hanya PERBANDINGAN
# antar-bobot, bukan besarnya.
BOBOT_RUTE = {
    "train": 10.0,
    "subway": 10.0,
    "light_rail": 8.0,
    "monorail": 8.0,
    "tram": 5.0,
    "brt": 3.0,          # Transjakarta koridor - lajur khusus, bukan bus biasa
    # Kereta ANTARKOTA. Terukur 27 Agu 2026: OSM memuat 46 lin `network=KAI`
    # (Argo Bromo Anggrek, Bima, Brantas...) melawan 4 lin `KAI Commuter`
    # (A, B, C, R). Ditimbang sama, 46 kereta yang lewat satu-dua kali sehari
    # menenggelamkan 4 lin yang mengangkut ratusan ribu orang setiap hari -
    # dan Stasiun Bekasi jadi berskor tiga kali Dukuh Atas. Yang diukur D05
    # keramaian harian, bukan panjang papan jadwal.
    "antarkota": 1.5,
    "bus": 1.0,
    "trolleybus": 1.0,
    "minibus": 0.7,      # angkot / mikrolet
    "share_taxi": 0.7,
    "ferry": 1.0,
}

#: Penanda jaringan KOMUTER di dalam `route=train`. Yang TIDAK memuatnya
#: diperlakukan antarkota. Dicocokkan menurut kata, bukan daftar nama jaringan
#: yang ditulis tangan: "KAI Commuter" hari ini, dan penamaan operator di OSM
#: berubah lebih sering daripada layanannya.
JARINGAN_KOMUTER = ("commuter", "krl")

#: Jaringan yang diperlakukan BRT walau OSM menandainya `route=bus`.
#: Transjakarta punya lajur terpisah dan kapasitas jauh di atas bus kota;
#: menyamakannya dengan angkot membuat koridor busway tidak terlihat sama
#: sekali di D05, padahal di Tanah Abang dan Dukuh Atas justru itu tulang
#: punggungnya.
JARINGAN_BRT = ("transjakarta", "trans jakarta", "brt")


BOBOT_IPT = {"D05": 0.40, "D06": 0.35, "D04_inv": 0.25}
BOBOT_IAE = {"D11": 0.30, "D10": 0.25, "B07": 0.25, "B09": 0.20}
BOBOT_IKP = {"C06": 0.45, "C05": 0.30, "C03_inv": 0.25}
BOBOT_IBR = {"P01": 0.35, "P05": 0.30, "P06": 0.25, "L03": 0.10}

BOBOT_PELUANG = {"IPT": 0.35, "IAE": 0.35, "IKP": -0.20, "IBR": -0.10}
BOBOT_HIDDEN_GEM = {"residual": 0.40, "iptt": 0.30, "peluang_x_prestise": 0.30}

SENSITIVITAS_GESER = 0.10
SENSITIVITAS_RHO_MIN = 0.85


# --- Ambang fitur produk ---------------------------------------------------
# Ini aturan TAMPILAN, bukan bagian dari perhitungan skor. Digeser tidak akan
# mengubah peringkat mana pun - hanya mengubah kapan peringatan muncul.

# Ambang peringatan RiskRadar TIDAK ada di sini - hanya backend yang memakainya,
# saat menyusun respons. Rumahnya backend/app/core/aturan.py.

# Commuter Clock. Rentang jam yang ditampilkan sesuai kriteria penerimaan.
JAM_MULAI, JAM_SELESAI = 5, 22
JAM_OPERASIONAL = list(range(JAM_MULAI, JAM_SELESAI + 1))

# Jam puncak komuter - dipakai untuk memisahkan captive dan choice rider.
# Captive rider terikat jadwal: berangkat dan pulang pada jam yang sempit dan
# hampir sama setiap hari kerja. Choice rider lebih tersebar.
JAM_PUNCAK_BERANGKAT = (5, 8)
JAM_PUNCAK_PULANG = (16, 19)


# --- Lokasi berkas ---------------------------------------------------------

ROOT = Path(__file__).parent
DATA = ROOT / "data"
DATA_MENTAH = DATA / "01_mentah"  # hasil unduh apa adanya, jangan diedit
DATA_BERSIH = DATA / "02_bersih"  # setelah s2_clean
DATA_OLAHAN = DATA / "03_olahan"  # siap masuk database
CACHE_AI = DATA / "cache_ai"  # hasil OCR - JANGAN panggil ulang API saat demo
PROMPTS = ROOT / "prompts"
