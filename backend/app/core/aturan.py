"""Aturan produk yang berlaku saat menyusun respons.

Semua yang ada di berkas ini adalah aturan TAMPILAN: kapan peringatan muncul,
bagaimana sebuah angka dinarasikan, label apa yang dipakai. Tidak satu pun
mengubah skor. Skor sudah selesai dihitung di pipeline/s6_score.py sebelum
backend menyentuhnya - lihat CLAUDE.md aturan 1.

Menggeser angka di sini mengubah kapan peringatan muncul, tidak pernah mengubah
peringkat lokasi mana pun.
"""

from typing import Literal

# ---------------------------------------------------------------------------
# Ruang lingkup
# ---------------------------------------------------------------------------
# Enam kawasan pilot. Harus sama dengan KAWASAN_PILOT di pipeline/config.py dan
# frontend/src/config.ts. Ketiganya proses terpisah yang tidak bisa saling impor,
# jadi kesamaannya dijaga oleh uji, bukan oleh bahasa - lihat tests/test_aturan.py.
#
# Dipakai untuk MEMVALIDASI parameter kawasan. Sebelum ada daftar ini, salah
# ketik nama kawasan menghasilkan daftar kosong dengan status 200, dan pemanggil
# menyimpulkan "tidak ada lokasi bagus di sana" padahal yang terjadi salah eja.

KAWASAN_PILOT = (
    "Manggarai",
    "Tanah Abang",
    "Depok Baru",
    "Bekasi",
    "Dukuh Atas BNI",
    "Harjamukti",
)


# ---------------------------------------------------------------------------
# RiskRadar - ambang indeks churn (P06)
# ---------------------------------------------------------------------------
# "Ambang batas wajar" ditetapkan relatif terhadap kawasan yang sama, bukan
# absolut nasional: churn 0,4 di Tanah Abang dan 0,4 di Harjamukti punya arti
# yang sangat berbeda karena dasar aktivitasnya berbeda.
#
# Lantai absolut ada supaya kawasan yang seluruhnya stabil tidak memunculkan
# peringatan hanya karena satu heksagon kebetulan paling tinggi di antara yang
# semuanya rendah. Tanpa lantai, setiap kawasan otomatis punya 25% area
# "berisiko" - peringatan yang selalu muncul akan berhenti dibaca.

CHURN_PERSENTIL_WASPADA = 0.75
CHURN_PERSENTIL_BAHAYA = 0.90
CHURN_LANTAI_ABSOLUT = 0.30

TingkatRisiko = Literal["AMAN", "WASPADA", "BAHAYA", "TIDAK_DIKETAHUI"]


def tingkat_risiko_churn(
    churn: float | None, p75: float | None, p90: float | None
) -> TingkatRisiko:
    """Satu-satunya tempat aturan peringatan churn didefinisikan.

    p75 dan p90 adalah persentil dalam kawasan yang sama, dihitung SQL.

    Churn KOSONG menghasilkan `TIDAK_DIKETAHUI`, bukan `AMAN`. Sebelumnya ia
    dipetakan ke AMAN dengan alasan "badge keyakinan yang menyertainya akan
    menunjukkan datanya tipis" - alasan yang masih masuk akal selama churn
    kadang-kadang ada. Sejak P06 dikosongkan (27 Agu 2026, tidak ada sumber
    yang bisa menghasilkannya), churn kosong di SELURUH 708 heksagon, dan
    pemetaan lama membuat platform menyatakan "Pergantian usaha di kawasan ini
    wajar" untuk setiap lokasi tanpa satu pun data di belakangnya.

    Ini kembaran persis dari jebakan ZoneGuard yang sudah diperbaiki: untuk
    fitur yang menjanjikan sebuah STATUS, "tidak tahu" harus jadi salah satu
    nilai statusnya - bukan dilebur ke nilai yang kedengaran menenangkan.
    """
    if churn is None:
        return "TIDAK_DIKETAHUI"
    if churn < CHURN_LANTAI_ABSOLUT:
        return "AMAN"
    if p90 is not None and churn >= p90:
        return "BAHAYA"
    if p75 is not None and churn >= p75:
        return "WASPADA"
    return "AMAN"


LABEL_RISIKO: dict[str, str] = {
    "AMAN": "Pergantian usaha di kawasan ini wajar",
    "WASPADA": "Pergantian usaha lebih sering daripada 75% area lain di kawasan ini",
    "BAHAYA": "Pergantian usaha termasuk 10% tertinggi di kawasan ini",
    "TIDAK_DIKETAHUI": "Data pergantian usaha belum ada untuk lokasi ini",
}

#: Tingkat yang benar-benar berarti "ada yang perlu diwaspadai". Ditulis
#: sebagai daftar POSITIF, bukan sebagai `!= "AMAN"`, dan itu bukan gaya:
#: bentuk negatif diam-diam ikut memasukkan `TIDAK_DIKETAHUI` begitu tingkat
#: keempat itu ada, sehingga saringan "tampilkan yang berperingatan saja"
#: berubah jadi "tampilkan yang datanya tidak ada" - persis kebalikan dari
#: yang diminta, dan tanpa satu pun galat.
TINGKAT_BERPERINGATAN = ("WASPADA", "BAHAYA")


# ---------------------------------------------------------------------------
# Commuter Clock
# ---------------------------------------------------------------------------
# Harus sama dengan JAM_MULAI / JAM_SELESAI di pipeline/config.py. Pipeline yang
# mengisi tabelnya, backend yang menyajikan - keduanya harus sepakat rentangnya.

JAM_MULAI, JAM_SELESAI = 5, 22
JAM_OPERASIONAL = list(range(JAM_MULAI, JAM_SELESAI + 1))


# ---------------------------------------------------------------------------
# ZoneGuard
# ---------------------------------------------------------------------------
# Tiga status, tiga arti yang berbeda. NULL bukan FALSE: "belum ada RDTR digital"
# bukan "dilarang". Menyamakan keduanya akan mematikan seluruh kawasan yang RDTR-nya
# belum digital - kesalahan yang langsung terlihat di peta.

StatusZona = Literal["DIIZINKAN", "DILARANG", "TIDAK_DIKETAHUI"]


def status_zona(zona_izin_komersial: bool | None) -> StatusZona:
    if zona_izin_komersial is True:
        return "DIIZINKAN"
    if zona_izin_komersial is False:
        return "DILARANG"
    return "TIDAK_DIKETAHUI"


PENJELASAN_ZONA: dict[str, str] = {
    "DIIZINKAN": "Zona RDTR di lokasi ini mengizinkan kegiatan usaha.",
    "DILARANG": (
        "Zona RDTR di lokasi ini tidak mengizinkan kegiatan usaha. "
        "Skor peluang dinolkan dan lokasi ini tidak pernah direkomendasikan, "
        "berapa pun nilai variabel lainnya."
    ),
    "TIDAK_DIKETAHUI": (
        "Kawasan ini belum punya RDTR digital, sehingga status izinnya belum bisa "
        "dipastikan. Skor tetap dihitung, tetapi verifikasi ke dinas terkait "
        "tetap diperlukan sebelum menyewa."
    ),
}


# ---------------------------------------------------------------------------
# Bahasa untuk orang awam
# ---------------------------------------------------------------------------
# Yang membaca layar ini calon pemilik warung, bukan analis data. Ia tidak tahu
# apa itu "rasio kompetitor per kapita", dan tidak seharusnya perlu tahu.
#
# Tiga aturan yang dipegang seluruh tabel di bawah:
#   1. Nama benda, bukan nama kolom. "Pesaing sejenis", bukan
#      "n_kompetitor_langsung".
#   2. PENDEK. Satu frasa, bukan satu kalimat. Penjelasan panjang di sebelah
#      angka membuat angkanya berhenti dibaca.
#   3. Satuannya ikut. "8,5" tidak berarti apa-apa; "8,5 tempat" berarti.
#
# Kode variabel (D01, B07, ...) TETAP disimpan di kolom pertama - ia identitas
# kanonik yang dipakai dokumen, score_factors, dan definisi bobot. Yang berubah
# hanya apa yang sampai ke mata.
#
# Kembarannya di frontend: `config.ts::ARTI_VARIABEL`. Dijaga sama oleh
# tests/test_aturan.py - kalau salah satunya bergeser, ujinya merah.

#: kolom -> (kode, nama untuk orang awam, satuan)
ARTI_VARIABEL: dict[str, tuple[str, str, str]] = {
    # Permintaan
    "pop_100m": ("D01", "Penduduk di sekitar", "jiwa"),
    "pop_usia_produktif": ("D02", "Penduduk usia kerja", "jiwa"),
    "jarak_simpul_m": ("D03", "Jarak ke stasiun", "m"),
    "waktu_jalan_menit": ("D04", "Jalan kaki ke stasiun", "menit"),
    "skor_simpul": ("D05", "Seberapa penting stasiunnya", ""),
    "ridership_proksi": ("D06", "Penumpang stasiun per hari", "orang"),
    "kepadatan_kos": ("D07", "Banyaknya kos", ""),
    "kepadatan_kantor": ("D08", "Banyaknya kantor", ""),
    "generator_keramaian": ("D09", "Sekolah, pasar, rumah sakit", "tempat"),
    "skor_ramai_terkoreksi": ("D10", "Seberapa ramai", ""),
    "intensitas_transaksi": ("D11", "Kepadatan transaksi", ""),
    "aktivitas_komunitas": ("D12", "Kegiatan warga", ""),
    # Perilaku belanja
    "puncak_pagi": ("B01", "Belanja pagi (05-09)", "%"),
    "puncak_siang": ("B02", "Belanja siang (11-14)", "%"),
    "puncak_sore": ("B03", "Belanja sore (16-19)", "%"),
    "puncak_malam": ("B04", "Belanja malam (19-23)", "%"),
    "rasio_weekend": ("B05", "Akhir pekan vs hari kerja", "x"),
    "pangsa_digital": ("B06", "Bayar non-tunai", "%"),
    "harga_median_porsi": ("B07", "Harga makanan per porsi", "Rp"),
    "spread_harga": ("B08", "Selisih harga antartempat", ""),
    "nominal_median_struk": ("B09", "Belanja per struk", "Rp"),
    "belanja_per_jam": ("B10", "Uang berpindah per jam", "Rp"),
    # Kompetisi
    "n_kompetitor_langsung": ("C01", "Pesaing sejenis", "tempat"),
    "kepadatan_poi_total": ("C02", "Total tempat usaha", "tempat"),
    "keragaman_usaha": ("C03", "Keragaman jenis usaha", ""),
    "keragaman_kuliner": ("C04", "Keragaman jenis makanan", ""),
    "pangsa_waralaba": ("C05", "Porsi merek waralaba", "%"),
    "rasio_kompetitor_per_kapita": ("C06", "Pesaing per penduduk", ""),
    "rasio_keliling": ("C07", "Porsi pedagang keliling", "%"),
    "n_menetap_kuliner": ("C08", "Warung makan menetap", "tempat"),
    # Biaya dan ruang
    "njop_m2": ("P01", "NJOP tanah", "Rp/m2"),
    "njop_persentil": ("P02", "Posisi NJOP di kawasan", "%"),
    "pasokan_sewa_komersial": ("P03", "Ruang usaha tersedia", "unit"),
    "rasio_sewa_jual": ("P04", "Sewa setahun dibagi harga jual", ""),
    "harga_sewa_median": ("P05", "Sewa per bulan", "Rp"),
    "indeks_churn": ("P06", "Seberapa sering usaha berganti", ""),
    "harga_sewa_per_m2": ("P07", "Sewa per m2", "Rp/m2"),
    # Risiko dan izin
    "zona_izin_komersial": ("L01", "Boleh dipakai usaha", ""),
    "kelas_zona": ("L02", "Kode zona RDTR", ""),
    "risiko_banjir": ("L03", "Risiko banjir", ""),
    # Bentuk kawasan
    "rasio_tutupan_bangunan": ("M01", "Padatnya bangunan", "%"),
    "luas_bangunan_median": ("M02", "Luas bangunan rata-rata", "m2"),
    "skor_prestise_visual": ("M03", "Kesan mewah dari foto", "dari 5"),
}

assert len(ARTI_VARIABEL) == 43, f"Kamus Data harus 43 variabel, ada {len(ARTI_VARIABEL)}"

#: kode -> nama awam. Dipakai daftar faktor pembentuk skor, yang berkunci KODE.
ARTI_KODE: dict[str, str] = {kode: nama for kode, nama, _ in ARTI_VARIABEL.values()}

#: Nama keempat indeks dalam bahasa biasa.
ARTI_INDEKS: dict[str, str] = {
    "IPT": "akses ke stasiun",
    "IAE": "perputaran uang",
    "IKP": "ketatnya persaingan",
    "IBR": "biaya dan risiko",
}


# ---------------------------------------------------------------------------
# Label kuadran
# ---------------------------------------------------------------------------

LABEL_KUADRAN: dict[str, str] = {
    "HIDDEN_GEM": "Hidden Gem",
    # Diganti 22 Agustus 2026: "Pemenang Jelas" tidak memberi tahu apa pun
    # tentang APA yang menang, dan yang membacanya di layar adalah orang yang
    # baru pertama kali melihat kuadran ini. Kuncinya tetap PEMENANG_JELAS -
    # itu yang tersimpan di basis data dan dipakai pipeline.
    "PEMENANG_JELAS": "Aman tapi Mahal",
    "JEBAKAN_GENGSI": "Jebakan Gengsi",
    "HINDARI": "Hindari",
}

# ---------------------------------------------------------------------------
# Nama heksagon yang bisa dibaca orang
# ---------------------------------------------------------------------------
# `898c107834bffff` adalah indeks H3 - alamat sel di grid global Uber H3
# resolusi 9. Ia kunci utama basis data dan tidak akan pernah diganti, tetapi
# ia juga tidak pernah pantas ditunjukkan ke pengguna: lima belas karakter
# heksadesimal tidak bisa dibaca, tidak bisa diingat, dan tidak bisa disebutkan
# lewat telepon.
#
# Yang di bawah menghasilkan nama seperti "Manggarai-40407". Tiga sifat yang
# membuatnya bisa dipercaya:
#
#   TANPA KEADAAN  Diturunkan dari indeksnya sendiri, bukan dari nomor urut.
#                  Nomor urut menuntut seluruh himpunan diketahui, dan setiap
#                  heksagon baru akan menggeser nomor tetangganya - termasuk
#                  yang sudah tercetak di Laporan Kelayakan orang.
#   TIDAK BENTROK  Potongan h3[7:11] adalah bagian yang benar-benar membedakan
#                  sel bertetangga; diuji terhadap seluruh 708 heksagon, nol
#                  bentrok, bahkan tanpa nama kawasannya.
#   BISA DIBALIK   Bukan sidik acak. Dua heksagon bersebelahan mendapat angka
#                  berdekatan, jadi urutannya masih berarti sesuatu.
#
# Kembarannya di frontend: `config.ts::kodeLokasi`. Keduanya dijaga sama oleh
# tests/test_aturan.py.

PANJANG_KODE_LOKASI = 5


def kode_lokasi(h3_index: str, kawasan: str) -> str:
    """`898c1079dd7ffff` + `Manggarai` -> `Manggarai-40407`."""
    return f"{kawasan}-{int(h3_index[7:11], 16):0{PANJANG_KODE_LOKASI}d}"


# ---------------------------------------------------------------------------
# Jarak ke simpul transit
# ---------------------------------------------------------------------------
# Kecepatan jalan kaki untuk mengubah jarak jadi menit di peta.
#
# 80 m/menit ≈ 4,8 km/jam, kecepatan pejalan kaki dewasa di trotoar kota. Ini
# ATURAN TAMPILAN, bukan variabel: ia tidak pernah masuk skor, dan menggesernya
# hanya mengubah angka menit yang tertulis di garis penghubung.
#
# Angkanya sengaja dipakai untuk GARIS LURUS saja, dan labelnya di layar
# mengatakannya. Isochrone sungguhan mengikuti jaringan jalan dan tinggal di
# tabel `catchment_areas` - yang masih kosong sampai routing OSMnx dikerjakan.
# Menggambar lingkaran lalu menyebutnya isochrone adalah kesalahan yang
# docs/data.md peringatkan secara khusus.
#: Di atas angka ini, "dekat stasiun" menurut peta dan "dekat stasiun" menurut
#: kaki sudah dua hal yang berbeda, dan antarmuka menyebutkannya. 1,4 dipilih
#: karena rasio memutar jaringan jalan kota yang normal berkisar 1,2-1,3;
#: yang di atas itu berarti ada sesuatu yang MENGHALANGI - rel, sungai, tembok
#: kompleks - dan itu justru yang perlu diketahui orang sebelum menyewa.
MEMUTAR_MENCOLOK = 1.4

KECEPATAN_JALAN_M_PER_MENIT = 80.0


def faktor_memutar(rute_m: float | None, lurus_m: float | None) -> float | None:
    """Berapa kali lipat rute jalan kaki dibanding garis lurusnya.

    Bukan skor, dan tidak pernah memeringkat apa pun - ia cuma menyatakan ulang
    dua angka yang sudah ada supaya selisihnya terbaca. Tempatnya di sini
    justru karena itu: aturan tampilan, bukan aritmetika skor.
    """
    if not rute_m or not lurus_m or lurus_m <= 0:
        return None
    return round(rute_m / lurus_m, 2)


def menit_jalan(jarak_m: float | None) -> float | None:
    """Perkiraan menit jalan kaki dari jarak GARIS LURUS. Kosong tetap kosong."""
    if jarak_m is None:
        return None
    return round(jarak_m / KECEPATAN_JALAN_M_PER_MENIT, 1)


PENJELASAN_KUADRAN: dict[str, str] = {
    "HIDDEN_GEM": "Datanya bagus tetapi tampilannya biasa saja - sewanya biasanya jauh lebih murah.",
    "PEMENANG_JELAS": "Datanya bagus dan tampilannya mahal - aman, tetapi Anda ikut membayar gengsinya.",
    "JEBAKAN_GENGSI": "Tampilannya mahal tetapi ekonominya tidak mendukung - kuadran yang paling sering menjebak.",
    "HINDARI": "Potensi ekonomi dan daya tarik visualnya sama-sama rendah.",
}
