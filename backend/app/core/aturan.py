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
        "Opportunity Score dinolkan dan lokasi ini tidak pernah direkomendasikan, "
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
    "kelas_zona": ("L02", "Jenis zona menurut aturan tata ruang", ""),
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
    # Dipendekkan lagi 3 September 2026 jadi "Aman". "Aman tapi Mahal" memuat
    # dua pernyataan sekaligus, dan yang kedua sudah dikatakan ARTI_KUADRAN di
    # bawah - jadi yang tersisa cuma nama panjang yang sulit dibaca di lencana
    # peta dan di judul kartu. Kuncinya tetap PEMENANG_JELAS.
    "PEMENANG_JELAS": "Aman",
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



# ---------------------------------------------------------------------------
# Dua bahasa
# ---------------------------------------------------------------------------
#
# KENAPA DI SINI, dan bukan di frontend.
#
# Kalimat di bawah dirakit dari angka heksagon - "Sewa Rp2.250.000/bln, masih
# Rp750.000 di bawah anggaran Anda". Yang dirakit dari data tidak boleh disalin
# ke frontend sebagai kamus kedua: salinan itu akan berselisih dengan yang
# dicetak Laporan PDF dan diucapkan Konsultan AI, dan selisihnya tidak akan
# pernah memunculkan galat - cuma dua kalimat berbeda untuk lokasi yang sama di
# dua layar yang berbeda. Sama persis dengan alasan `ARTI_VARIABEL` hidup di
# satu tempat.
#
# BENTUKNYA: satu katalog berkunci, tiap kunci membawa PASANGAN (id, en).
# Percabangan yang memilih kalimat tetap tinggal di tempatnya - ia logika, bukan
# teks - dan yang pindah ke sini cuma kalimatnya. Akibatnya dua hal yang
# keduanya disengaja: seluruh prosa produk ini bisa dibaca dalam satu layar, dan
# `test_aturan.py` bisa menuntut tiap kunci punya kedua cabangnya DENGAN
# placeholder yang sama persis.
#
# Yang TIDAK ikut: Laporan Kelayakan PDF dan jawaban Konsultan AI. Keduanya
# masih Indonesia, dan itu keadaan yang dicatat di docs/status.md - bukan yang
# terlupa.

Bahasa = Literal["id", "en"]

#: Bahasa bawaan. Ditulis sebagai konstanta supaya tiap tanda tangan fungsi
#: menyebut hal yang sama, dan supaya menggantinya tidak menuntut menyunting
#: dua puluh tempat.
BAHASA_BAWAAN: Bahasa = "id"


def pilih(kamus_id: dict[str, str], kamus_en: dict[str, str], bahasa: Bahasa) -> dict[str, str]:
    """Cabang kamus yang berlaku, dengan Indonesia sebagai jaring pengaman.

    `or kamus_id[k]` di dalam pemahaman-dict bukan kerapian: kunci yang lupa
    diterjemahkan lebih baik tampil dalam bahasa Indonesia daripada hilang
    sebagai KeyError di tengah respons yang sudah separuh jadi. Kelengkapannya
    dijaga uji, bukan oleh runtime.
    """
    if bahasa != "en":
        return kamus_id
    return {k: kamus_en.get(k) or v for k, v in kamus_id.items()}


LABEL_RISIKO_EN: dict[str, str] = {
    "AMAN": "Business turnover here is normal for the area",
    "WASPADA": "Businesses change hands more often than in 75% of this area",
    "BAHAYA": "Business turnover is among the top 10% in this area",
    "TIDAK_DIKETAHUI": "No business turnover data for this location yet",
}

PENJELASAN_ZONA_EN: dict[str, str] = {
    "DIIZINKAN": "The RDTR zoning at this location allows business activity.",
    "DILARANG": (
        "The RDTR zoning at this location does not allow business activity. "
        "The Opportunity Score is zeroed and this location is never recommended, "
        "whatever its other variables say."
    ),
    "TIDAK_DIKETAHUI": (
        "This area has no digital RDTR yet, so its permission status cannot be "
        "confirmed. The score is still computed, but you should verify with the "
        "local planning office before signing a lease."
    ),
}

PENJELASAN_KUADRAN_EN: dict[str, str] = {
    "HIDDEN_GEM": "The data is good but it looks ordinary - the rent is usually far cheaper.",
    "PEMENANG_JELAS": "The data is good and it looks expensive - safe, but you pay for the prestige.",
    "JEBAKAN_GENGSI": "It looks expensive but the economics do not back it up - the quadrant that traps people most often.",
    "HINDARI": "Both the economic potential and the visual pull are low.",
}

LABEL_KUADRAN_EN: dict[str, str] = {
    "HIDDEN_GEM": "Hidden Gem",
    "PEMENANG_JELAS": "Safe",
    "JEBAKAN_GENGSI": "Prestige Trap",
    "HINDARI": "Avoid",
}

ARTI_INDEKS_EN: dict[str, str] = {
    "IPT": "access to the station",
    "IAE": "money in circulation",
    "IKP": "how tight the competition is",
    "IBR": "cost and risk",
}


#: Tiap kalimat yang KELUAR ke layar dan tidak muat di keempat kamus di atas.
#:
#: Nilainya `(indonesia, inggris)` dan keduanya template `str.format`. Angka
#: sudah diformat oleh pemanggilnya - pemisah ribuan Indonesia dan Inggris
#: berbeda, dan itu urusan `_rp()`, bukan urusan katalog ini.
KALIMAT: dict[str, tuple[str, str]] = {
    # --- GemFinder ---------------------------------------------------------
    "gem_sewa": (
        "Sewa median di sini {sewa} per bulan",
        "The median rent here is {sewa} a month",
    ),
    "gem_biaya": ("Biaya di sini", "Costs here"),
    "gem_residual": (
        "{sewa} - lebih murah daripada yang seharusnya, mengingat potensi transit "
        "dan aktivitas ekonominya. Termasuk 25% termurah relatif terhadap "
        "potensinya di kawasan {kawasan}.",
        "{sewa} - cheaper than it ought to be, given its transit potential and "
        "economic activity. Among the cheapest 25% relative to its potential in "
        "{kawasan}.",
    ),
    "gem_kuadran": (
        "Opportunity Score di atas median kawasan, tetapi prestise visualnya di "
        "bawah median - persis pola lokasi yang datanya bagus tetapi "
        "penampilannya membuat orang melewatkannya.",
        "The Opportunity Score is above the area median but the visual prestige is "
        "below it - exactly the pattern of a location whose data is good and whose "
        "looks make people walk past it.",
    ),
    "gem_iptt": (
        "Banyak pedagang keliling dan pembeli ramai, tetapi sedikit usaha menetap. "
        "Permintaannya sudah terbukti ada, belum ada yang melayaninya secara permanen.",
        "Plenty of street vendors and plenty of buyers, but few permanent shops. The "
        "demand is proven; nobody serves it permanently yet.",
    ),
    "gem_metode_residual_biaya": ("harga di bawah potensinya", "priced below its potential"),
    "gem_metode_kuadran": ("bagus di data, biasa di tampilan", "good in the data, ordinary to look at"),
    "gem_metode_iptt": ("permintaan belum terlayani", "demand nobody serves yet"),
    "gem_tanpa_skor": (
        "Heksagon di {kawasan}. Skor hidden gem belum dihitung.",
        "A hexagon in {kawasan}. Its hidden gem score has not been computed.",
    ),
    "gem_lolos": (
        ", lolos {n} dari 3 metode. ",
        ", passing {n} of 3 methods. ",
    ),
    "gem_skor": ("Skor hidden gem {skor}", "Hidden gem score {skor}"),
    "gem_tanpa_rincian": (
        "Rincian metodenya belum bisa direkonstruksi - jalankan ulang pipeline "
        "s6_score untuk kawasan {kawasan}. {ekor}",
        "The method breakdown cannot be reconstructed - re-run the s6_score pipeline "
        "for {kawasan}. {ekor}",
    ),
    "gem_selisih": (
        " (rincian yang bisa ditampilkan di sini {n}, karena ambangnya dihitung "
        "ulang terhadap kawasan)",
        " ({n} can be shown here, because the thresholds are recomputed against the area)",
    ),
    "gem_ringkas": (
        "Terpilih lewat {jumlah} dari 3 metode ({dipenuhi}){catatan}. {bukti} {ekor}",
        "Selected by {jumlah} of 3 methods ({dipenuhi}){catatan}. {bukti} {ekor}",
    ),
    "badge_TINGGI": ("Didukung survei yang rapat", "Backed by a dense survey"),
    "badge_SEDANG": ("Didukung survei secukupnya", "Backed by a fair amount of survey"),
    "badge_RENDAH": (
        "Datanya masih tipis, perlu verifikasi lapangan",
        "The data is still thin; it needs checking on the ground",
    ),
    "badge_ekor": ("{badge} - {n} titik misi.", "{badge} - {n} mission points."),

    # --- Riwayat skor ------------------------------------------------------
    "riwayat_arah_naik": ("naik", "up"),
    "riwayat_arah_turun": ("turun", "down"),
    "riwayat_arah_tetap": ("tetap", "unchanged"),
    "riwayat_tren": (
        "{n} versi tercatat. Opportunity Score {arah} {selisih} poin dari versi "
        "pertama ke terakhir.",
        "{n} versions on record. The Opportunity Score went {arah} by {selisih} "
        "points from the first version to the last.",
    ),
    "riwayat_sebagian": (
        "{n} versi tercatat, sebagian tanpa skor.",
        "{n} versions on record, some without a score.",
    ),
    "riwayat_satu": (
        "Baru satu versi skor yang diterbitkan, jadi belum ada perubahan untuk "
        "ditampilkan. Riwayat ini terisi sendiri begitu pipeline menerbitkan versi "
        "berikutnya - tidak ada angka yang diperkirakan di sini.",
        "Only one version of the score has been published, so there is no change to "
        "show yet. This history fills itself in as soon as the pipeline publishes "
        "the next version - nothing here is estimated.",
    ),

    # --- Dinamika kawasan --------------------------------------------------
    "dinamika_catatan": (
        "Sebaran ini potret versi skor yang sedang berlaku, bukan deret waktu. "
        "Basis data baru memuat satu versi penerbitan; sumbu waktunya terisi begitu "
        "pipeline menerbitkan versi berikutnya.",
        "This spread is a snapshot of the score version in force, not a time series. "
        "The database holds only one published version so far; the time axis fills "
        "in as soon as the pipeline publishes the next one.",
    ),

    # --- Alasan rekomendasi (berkunci sama dengan `AlasanRekomendasi.kode`) --
    "rek_MUAT_ANGGARAN": (
        "Sewa {sewa}/bln — masih {sisa} di bawah anggaran Anda",
        "Rent {sewa}/mo — still {sisa} under your budget",
    ),
    "rek_HIDDEN_GEM": (
        "Hidden Gem: datanya bagus padahal tampilannya biasa — sewanya belum ikut naik",
        "Hidden Gem: the data is good even though it looks ordinary — the rent has not caught up",
    ),
    "rek_DEKAT_SIMPUL": (
        "{menit} menit jalan kaki ke simpul transit",
        "{menit} minutes on foot to the transit node",
    ),
    "rek_SEPI_PESAING": (
        "Baru {n} pesaing sejenis di heksagon ini",
        "Only {n} direct rivals in this hexagon",
    ),
    "rek_UANG_BERPINDAH": (
        "{rp} berpindah tangan tiap jam di sini",
        "{rp} changes hands here every hour",
    ),
    "rek_CHURN_TINGGI": (
        "Pergantian usaha di sini termasuk tinggi untuk kawasannya — periksa kenapa",
        "Business turnover here is high for its area — find out why",
    ),
    "rek_RDTR_KOSONG": (
        "RDTR digitalnya belum ada — izinnya wajib dicek ke dinas sebelum menyewa",
        "There is no digital RDTR — check the permission with the planning office before leasing",
    ),
    "rek_BELUM_DISURVEI": (
        "Belum disurvei langsung — harga sewa dan pola jam di sini belum terukur",
        "Not surveyed on the ground — the rent and the hourly pattern here are unmeasured",
    ),
    "rek_DATA_TIPIS": (
        "Baru {n} titik survei — angkanya masih bisa bergeser",
        "Only {n} survey points — the numbers can still move",
    ),
    "rek_ringkas_umum": (
        "Opportunity Score-nya termasuk tertinggi di antara yang memenuhi kriteria Anda.",
        "Its Opportunity Score is among the highest of those meeting your criteria.",
    ),
    "rek_tanpa_preferensi": (
        "Belum ada preferensi yang tersimpan, jadi daftar ini masih peringkat umum. "
        "Isi rencana usaha dan kawasan incaran di menu akun untuk membuatnya "
        "menjawab keadaan Anda.",
        "No preferences saved yet, so this list is still the general ranking. Fill in "
        "your business plan and the areas you are after in the account menu to make "
        "it answer your own situation.",
    ),
    "rek_dipotong": (
        "{total} lokasi memenuhi kriteria Anda. Tiga teratas ditampilkan; sisanya "
        "terbuka untuk pelanggan Loconomics Premium.",
        "{total} locations meet your criteria. The top three are shown; the rest are "
        "open to Loconomics Premium subscribers.",
    ),
    "rek_penuh": (
        "{total} lokasi memenuhi kriteria Anda, diurutkan menurut Opportunity Score.",
        "{total} locations meet your criteria, ordered by Opportunity Score.",
    ),
    "rek_anggaran": ("sewa di bawah {rp}", "rent under {rp}"),

    # --- Peringatan simulasi (berkunci sama dengan `Peringatan.kode`) -------
    "sim_ZONA_MELARANG": (
        "Zona RDTR di sini melarang kegiatan usaha. Simulasi tetap dihitung sebagai "
        "latihan, tetapi lokasi ini tidak boleh dipakai.",
        "The RDTR zoning here prohibits business activity. The simulation is still "
        "computed as an exercise, but this location cannot be used.",
    ),
    "sim_ZONA_TIDAK_DIKETAHUI": (
        "Belum ada RDTR digital untuk lokasi ini - status izinnya belum bisa "
        "dipastikan. Verifikasi ke dinas terkait sebelum menyewa.",
        "There is no digital RDTR for this location - its permission status cannot be "
        "confirmed. Verify with the planning office before leasing.",
    ),
    "sim_IMPAS_TIDAK_REALISTIS": (
        "Untuk sekadar menutup sewa, usaha ini harus menangkap {pangsa}% dari seluruh "
        "belanja yang berputar di heksagon ini. Itu pangsa yang sangat besar untuk "
        "pendatang baru - pertimbangkan lokasi dengan sewa lebih rendah.",
        "Just to cover the rent, this business would have to capture {pangsa}% of all "
        "the spending circulating in this hexagon. That is a very large share for a "
        "newcomer - consider a location with lower rent.",
    ),
    "sim_BELUM_MENUTUP_SEWA": (
        "Dengan asumsi ini, laba kotor belum menutup sewa. Naikkan pangsa, perkecil "
        "luas, atau bandingkan dengan heksagon lain.",
        "On these assumptions the gross profit does not cover the rent. Raise the "
        "share, shrink the floor area, or compare with another hexagon.",
    ),
    "sim_PERGANTIAN_TINGGI": (
        "Indeks pergantian usaha di sini {churn} - relatif tinggi. Banyak usaha yang "
        "datang lalu pergi.",
        "The business turnover index here is {churn} - relatively high. Many "
        "businesses come and go.",
    ),
    "sim_DATA_TIPIS": (
        "Data survei di heksagon ini tipis, jadi angka terukurnya pun tipis. "
        "Perlakukan hasilnya sebagai arah, bukan angka.",
        "The survey data in this hexagon is thin, so the measured figures are thin "
        "too. Treat the result as a direction, not a number.",
    ),
    "sim_TANPA_DATA_BELANJA": (
        "Belum ada data belanja per jam di heksagon ini, jadi omzetnya tidak bisa "
        "dihitung - bukan berarti nol. Yang tetap bisa dijawab: berapa pembeli per "
        "hari yang dibutuhkan sekadar untuk menutup sewa.",
        "There is no hourly spending data for this hexagon, so revenue cannot be "
        "computed - which does not mean it is zero. What can still be answered: how "
        "many buyers a day it takes just to cover the rent.",
    ),
    "sim_SEWA_BELUM_DIISI": (
        "Isi sewa yang ditawarkan ke Anda supaya kebutuhan pembeli per hari bisa "
        "dihitung. Angka itu ada di penawaran pemilik, bukan di peta.",
        "Fill in the rent you have been offered so the buyers-per-day figure can be "
        "worked out. That number is in the owner's offer, not on the map.",
    ),
    "sim_HARGA_BELUM_DIISI": (
        "Isi harga rata-rata per pembeli - itu rencana harga jual Anda sendiri, dan "
        "tidak ada data survei yang bisa menggantikannya.",
        "Fill in the average spend per buyer - that is your own planned selling price, "
        "and no survey data can stand in for it.",
    ),
    "sim_SEWA_DIBANDING_LOKASI": (
        "Sewa yang Anda isi dibandingkan dengan sewa terukur di heksagon ini - lihat "
        "sewa per m2 di bagian angka.",
        "The rent you entered is compared with the measured rent in this hexagon - see "
        "rent per m2 in the figures.",
    ),

    # --- Commuter Clock ----------------------------------------------------
    "jam_tanpa_baris": (
        "Pola jam dibaca dari waktu yang tercetak di struk. Struk survei MAPID tidak "
        "membawa kolom waktu - jamnya ada di dalam foto struknya, dan pembacaan "
        "otomatis foto itu belum dijalankan.",
        "Hourly patterns are read from the time printed on receipts. MAPID survey "
        "receipts carry no time column - the hour sits inside the photo of the "
        "receipt, and automatic reading of those photos has not been run.",
    ),
    "jam_semua_proxy": (
        "Seluruh angka di sini hasil estimasi dari konteks heksagon, bukan dari jam "
        "yang tercetak di struk. Perlakukan sebagai pola kasar, bukan pengukuran.",
        "Every figure here is estimated from the hexagon's context, not from the time "
        "printed on receipts. Treat it as a rough pattern, not a measurement.",
    ),

    # --- Konteks simpul ----------------------------------------------------
    "simpul_kosong": (
        "Belum ada simpul transportasi di basis data, jadi jaraknya belum bisa dihitung.",
        "There are no transport nodes in the database yet, so the distance cannot be computed.",
    ),
    "simpul_cara_kaki": ("jalan kaki", "on foot"),
    "simpul_cara_mobil": ("berkendara", "by car"),
    "simpul_cara_sepeda": ("bersepeda", "by bike"),
    "simpul_lurus": (
        "Garis lurus ke {nama}. Rute {cara} yang sebenarnya lebih panjang karena "
        "mengikuti jalan - heksagon ini belum dirutekan untuk profil itu.",
        "Straight line to {nama}. The real {cara} route is longer because it follows "
        "the streets - this hexagon has not been routed for that profile yet.",
    ),
    "simpul_rute": (
        "{menit} menit {cara} ke {nama}, lewat jalan yang ada.",
        "{menit} minutes {cara} to {nama}, along the streets that exist.",
    ),
    "simpul_memutar": (
        " Jalurnya memutar {faktor}x dari jarak lurusnya ({lurus} m) - ada yang "
        "menghalangi jalan langsungnya.",
        " The path detours {faktor}x its straight-line distance ({lurus} m) - "
        "something is blocking the direct way.",
    ),
    "simpul_alternatif": (
        " {n} jalur alternatif tersedia.",
        " {n} alternative routes are available.",
    ),

    # --- Blok di dalam heksagon --------------------------------------------
    "blok_menit": (
        "{menit} menit jalan kaki ke {nama}",
        "{menit} min walk to {nama}",
    ),
    "blok_menit_tercepat": (
        "Tercepat ke {nama} di heksagon ini ({menit} menit)",
        "Quickest to {nama} in this hexagon ({menit} min)",
    ),
    "blok_tepi_jalan": (
        "Di tepi {jalan}",
        "Right on {jalan}",
    ),
    "blok_dekat_jalan": (
        "{jarak} m dari {jalan}",
        "{jarak} m from {jalan}",
    ),
    "blok_jalan_tanpa_nama": ("jalan utama", "a main road"),
    "blok_jauh_jalan": (
        "Jauh dari jalan utama ({jarak} m) - arus lewat sedikit",
        "Far from a main road ({jarak} m) - little passing traffic",
    ),
    "blok_usaha": (
        "{n} usaha dalam 150 m",
        "{n} businesses within 150 m",
    ),
    "blok_usaha_nol": (
        "Belum ada usaha terpetakan dalam 150 m",
        "No mapped businesses within 150 m yet",
    ),
    "blok_pesaing": (
        "{n} pesaing sekelas dalam 150 m",
        "{n} same-type competitors within 150 m",
    ),
    "blok_pesaing_nol": (
        "Tanpa pesaing sekelas dalam 150 m",
        "No same-type competitors within 150 m",
    ),
    "blok_penarik": (
        "{n} penarik keramaian dalam 250 m",
        "{n} crowd generators within 250 m",
    ),
    "blok_halte": (
        "Halte/henti angkutan {jarak} m",
        "Transit stop {jarak} m away",
    ),
    "blok_zona_usaha": (
        "{pangsa}% bidangnya berzona Perdagangan & Jasa",
        "{pangsa}% of its land is zoned Trade & Services",
    ),
    "blok_zona_dilarang": (
        "Zonasi RDTR blok ini bukan untuk tempat usaha - skornya dinolkan",
        "This block's RDTR zoning is not for business - its score is zeroed",
    ),
    "blok_zona_tidak_diketahui": (
        "Belum ada RDTR digital untuk blok ini - cek izin ke dinas setempat",
        "No digital RDTR for this block yet - check permits with the local office",
    ),
    "blok_banjir": (
        "Masuk kawasan rawan banjir menurut RDTR",
        "Inside a flood-prone area according to the RDTR",
    ),
    "blok_catatan": (
        "Tujuh blok (±130 m) di dalam heksagon ini, dinilai dari data terbuka: waktu "
        "jalan kaki sungguhan ke stasiun (OpenRouteService), jalan dan usaha "
        "OpenStreetMap, dan zonasi RDTR ATR/BPN. Skor blok membandingkan sisi-sisi "
        "heksagon yang sama; ia tidak menggantikan Opportunity Score heksagonnya.",
        "Seven blocks (±130 m) inside this hexagon, rated from open data: real walking "
        "time to the station (OpenRouteService), OpenStreetMap streets and businesses, "
        "and ATR/BPN RDTR zoning. The block score compares sides of the same hexagon; "
        "it does not replace the hexagon's Opportunity Score.",
    ),
}


def kalimat(kunci: str, bahasa: Bahasa = BAHASA_BAWAAN, **isi: object) -> str:
    """Satu kalimat dari katalog, sudah diisi.

    KeyError-nya sengaja tidak ditangkap: kunci yang salah ketik adalah bug yang
    harus berteriak saat uji, bukan kalimat kosong yang lolos ke layar.
    """
    id_, en = KALIMAT[kunci]
    return (en if bahasa == "en" else id_).format(**isi)


def rp(n: float, bahasa: Bahasa = BAHASA_BAWAAN) -> str:
    """Rupiah, dengan pemisah ribuan yang benar untuk bahasanya.

    "Rp1.827" dibaca pembaca Inggris sebagai satu koma delapan - selisih seribu
    kali pada angka yang dipakai orang menimbang sewa. Kembarannya di frontend
    `lib/format.ts`, dan keduanya harus sepakat.
    """
    utuh = f"{n:,.0f}"
    return "Rp" + (utuh if bahasa == "en" else utuh.replace(",", "."))


# ---------------------------------------------------------------------------
# Blok di dalam heksagon - aturan TAMPILAN
# ---------------------------------------------------------------------------
# Skornya dihitung `pipeline/s6_score.skor_blok`. Yang di sini hanya memilih
# kalimat yang menyertainya - tidak satu pun mengubah urutan blok.

#: Delapan kelas induk usaha, nama (id, en). Kembaran `pipeline/config.py::
#: KELAS_INDUK` - kesamaannya dijaga `tests/test_aturan.py`.
KELAS_USAHA: dict[str, tuple[str, str]] = {
    "F1": ("Kuliner Duduk", "Sit-down food"),
    "F2": ("Kuliner Cepat/Informal", "Quick & informal food"),
    "R1": ("Ritel Kebutuhan Harian", "Everyday retail"),
    "R2": ("Ritel Non-Pangan", "Non-food retail"),
    "S1": ("Jasa Personal", "Personal services"),
    "S2": ("Kesehatan", "Health"),
    "K1": ("Keuangan", "Finance"),
    "T1": ("Transportasi", "Transport"),
}

#: Jenis usaha simulasi -> kelas induk pesaingnya. Dipakai antarmuka untuk
#: memilih kelas bawaan dari rencana usaha yang sudah diisi orangnya, supaya
#: pemilik kedai kopi tidak perlu tahu bahwa kopi masuk "Kuliner Cepat".
JENIS_KE_KELAS: dict[str, str] = {
    "kuliner_ringan": "F2", "warung_makan": "F1", "restoran": "F1", "bakery": "F2",
    "retail_kecil": "R1", "minimarket": "R1", "fesyen": "R2", "elektronik": "R2",
    "bangunan": "R2", "jasa": "S1", "kecantikan": "S1", "kesehatan": "S2",
    "pendidikan": "S1", "otomotif": "T1", "hiburan": "S1", "logistik": "S1",
}

#: Jarak yang dihitung "di tepi" jalan - kira-kira satu muka ruko plus trotoar.
TEPI_JALAN_M = 25
#: Di atas ini blok dinyatakan jauh dari arus jalan utama.
JAUH_JALAN_M = 250


#: Nama awam tiap kunci bobot blok (id, en). Kembaran `pipeline/config.py::
#: BOBOT_BLOK` ditambah risiko banjir; kesamaannya dijaga `test_aturan.py`.
NAMA_KONTRIBUSI_BLOK: dict[str, tuple[str, str]] = {
    "menit_jalan_inv": ("Dekat ke simpul transit", "Close to the transit node"),
    "jarak_jalan_utama_m_inv": ("Menempel jalan utama", "On a main road"),
    "n_penarik_250m": ("Penarik keramaian di sekitarnya", "Nearby crowd generators"),
    "n_usaha_150m": ("Usaha lain di sekitarnya", "Other businesses nearby"),
    "jarak_halte_m_inv": ("Dekat halte", "Close to a transit stop"),
    "rasio_tutupan_bangunan": ("Kepadatan bangunan", "Built-up density"),
    "risiko_banjir_inv": ("Risiko banjir", "Flood risk"),
}


#: Bobot tiap sumbangan blok - KEMBARAN `pipeline/config.py::BOBOT_BLOK` plus
#: `BOBOT_BLOK_BANJIR`, dijaga sama oleh `test_aturan.py`. Dipakai HANYA untuk
#: menerjemahkan sumbangan jadi kekuatan 0-1 yang bisa dibaca awam; tidak ada
#: satu pun skor yang dihitung ulang dari sini (aturan 1).
BOBOT_KONTRIBUSI_BLOK: dict[str, float] = {
    "menit_jalan_inv": 0.30,
    "jarak_jalan_utama_m_inv": 0.20,
    "n_penarik_250m": 0.15,
    "n_usaha_150m": 0.15,
    "jarak_halte_m_inv": 0.10,
    "rasio_tutupan_bangunan": 0.10,
    "risiko_banjir_inv": 0.10,
}


def kontribusi_blok(mentah: dict | None, bahasa: Bahasa) -> list[dict]:
    """`blok_heksagon.kontribusi` -> daftar berlabel, urut dari yang terbesar.

    TIDAK menghitung apa pun: pangsanya pembagian dua angka yang sudah jadi,
    dan pembagian itu tidak memeringkat blok mana pun (aturan 1). Yang
    menghitung sumbangannya `pipeline/s6_score.skor_blok`.

    `kekuatan` ditambahkan 13 Sep 2026 atas laporan pemilik repo: "masa dekat
    halte pake persentase". Pangsa menjawab "berapa bagian skor datang dari
    sini" - pertanyaan yang tidak diajukan siapa pun. Yang diajukan orang:
    "seberapa bagus blok ini soal halte?". Sumbangan dibagi bobotnya menjawab
    persis itu, pada skala 0-1 atas seluruh blok wilayah studi, karena
    pipeline menormalkannya begitu.

    Yang NEGATIF ikut dikirim dan tidak diubah tandanya. Risiko banjir menekan
    skor, dan menyembunyikannya berarti daftar sumbangan yang jumlahnya tidak
    pernah cocok dengan skornya.
    """
    if not mentah:
        return []
    en = bahasa == "en"
    positif = sum(v for v in mentah.values() if v > 0) or 1.0
    baris = [
        {
            "kode": k,
            "nama": NAMA_KONTRIBUSI_BLOK.get(k, (k, k))[1 if en else 0],
            "nilai": round(float(v), 4),
            "pangsa": round(float(v) / positif, 4),
            "kekuatan": (
                None
                if not BOBOT_KONTRIBUSI_BLOK.get(k)
                else round(min(1.0, max(0.0, abs(float(v)) / BOBOT_KONTRIBUSI_BLOK[k])), 3)
            ),
        }
        for k, v in mentah.items()
    ]
    return sorted(baris, key=lambda b: -abs(b["nilai"]))


def alasan_blok(
    b: dict,
    saudara: list[dict],
    nama_simpul: str | None,
    kelas: str | None,
    bahasa: Bahasa = BAHASA_BAWAAN,
) -> tuple[list[str], list[str]]:
    """Kalimat keunggulan dan peringatan untuk SATU blok, dibanding saudaranya.

    Keunggulan disebut hanya kalau memang pembeda - "tercepat ke stasiun"
    hanya untuk blok yang benar-benar tercepat, bukan untuk ketujuhnya. Kalimat
    yang muncul di setiap baris berhenti dibaca sebagai alasan.
    """
    alasan: list[str] = []
    peringatan: list[str] = []
    nama = nama_simpul or ("stasiun" if bahasa != "en" else "the station")

    menit = b.get("menit_jalan")
    semua_menit = [s["menit_jalan"] for s in saudara if s.get("menit_jalan") is not None]
    if menit is not None:
        if semua_menit and menit <= min(semua_menit) and len(semua_menit) > 1:
            alasan.append(kalimat("blok_menit_tercepat", bahasa, nama=nama, menit=f"{menit:.0f}"))
        else:
            alasan.append(kalimat("blok_menit", bahasa, nama=nama, menit=f"{menit:.0f}"))

    jarak = b.get("jarak_jalan_utama_m")
    jalan = b.get("nama_jalan_utama") or kalimat("blok_jalan_tanpa_nama", bahasa)
    if jarak is not None:
        if jarak <= TEPI_JALAN_M:
            alasan.append(kalimat("blok_tepi_jalan", bahasa, jalan=jalan))
        elif jarak >= JAUH_JALAN_M:
            peringatan.append(kalimat("blok_jauh_jalan", bahasa, jarak=f"{jarak:.0f}"))
        else:
            alasan.append(kalimat("blok_dekat_jalan", bahasa, jarak=f"{jarak:.0f}", jalan=jalan))

    if kelas:
        n = int((b.get("usaha_per_kelas_150m") or {}).get(kelas, 0))
        alasan.append(
            kalimat("blok_pesaing_nol", bahasa) if n == 0 else kalimat("blok_pesaing", bahasa, n=n)
        )
    n_usaha = int(b.get("n_usaha_150m") or 0)
    alasan.append(
        kalimat("blok_usaha_nol", bahasa) if n_usaha == 0 else kalimat("blok_usaha", bahasa, n=n_usaha)
    )
    n_penarik = int(b.get("n_penarik_250m") or 0)
    if n_penarik:
        alasan.append(kalimat("blok_penarik", bahasa, n=n_penarik))
    halte = b.get("jarak_halte_m")
    if halte is not None and halte <= 150:
        alasan.append(kalimat("blok_halte", bahasa, jarak=f"{halte:.0f}"))

    izin = b.get("izin_komersial")
    if izin is False:
        peringatan.append(kalimat("blok_zona_dilarang", bahasa))
    elif izin is None:
        peringatan.append(kalimat("blok_zona_tidak_diketahui", bahasa))
    elif b.get("pangsa_zona_usaha") is not None:
        alasan.append(
            kalimat("blok_zona_usaha", bahasa, pangsa=f"{100 * b['pangsa_zona_usaha']:.0f}")
        )
    if (b.get("risiko_banjir") or 0) >= 0.5:
        peringatan.append(kalimat("blok_banjir", bahasa))
    return alasan, peringatan

# ---------------------------------------------------------------------------
# Kejujuran keempat indeks
# ---------------------------------------------------------------------------
# Tiap indeks dirakit dari beberapa variabel. Variabel yang KOSONG tidak
# dinolkan - ia dinetralkan ke 0,5, tengah skala (CLAUDE.md aturan 4). Itu
# keputusan yang benar untuk PERHITUNGAN, dan berbahaya untuk TAMPILAN: indeks
# yang seluruh bahannya kosong tetap keluar sebagai angka di sekitar 0,5, dan
# di layar ia tidak bisa dibedakan dari hasil pengukuran sungguhan.
#
# Terukur 30 Agustus 2026 atas 708 heksagon:
#
#     IPT akses ke stasiun     65% bobotnya terukur
#     IKP ketatnya persaingan  75% terukur
#     IAE perputaran uang       1% terukur   <- praktis seluruhnya netral
#     IBR biaya dan risiko      5% terukur   <- praktis seluruhnya netral
#
# Jadi dua dari empat angka yang selama ini tampil sebagai "0,49" dan "0,487"
# sebenarnya berarti "belum diketahui". Ini keluarga kesalahan yang sama dengan
# badge keyakinan yang dulu mengaku disurvei, RiskRadar yang menyebut AMAN untuk
# lokasi tanpa data, dan ZoneGuard yang diam untuk zona yang diizinkan: nilai
# netral yang menyamar jadi temuan.
#
# Yang dikembalikan di sini BUKAN skor dan tidak memeringkat apa pun - ia
# menghitung berapa bahan sebuah indeks yang benar-benar punya nilai. Datanya
# sudah tersimpan di `score_factors`: baris yang variabelnya kosong punya
# `nilai_normalisasi = NULL` sementara `kontribusi`-nya tetap terisi (bobot x
# 0,5). Jadi ini pembacaan, bukan perhitungan ulang.

#: Di bawah pangsa ini, indeksnya TIDAK BOLEH ditampilkan sebagai angka.
#: Sepertiga dipilih karena di bawah itu yang tersisa lebih banyak asumsi
#: daripada pengukuran, dan angka yang isinya asumsi lebih buruk daripada
#: kejujuran "belum terukur" - ia terlihat seperti jawaban.
AMBANG_INDEKS_LAYAK_TAMPIL = 1 / 3


def cakupan_indeks(
    faktor: "list",  # list[ScoreFactor]; tidak diimpor supaya modul ini bebas ORM
) -> dict[str, dict[str, object]]:
    """Berapa bahan tiap indeks yang benar-benar terukur, bukan dinetralkan.

    Mengembalikan, per kode indeks: jumlah bahan terukur, jumlah bahan
    seluruhnya, daftar kode variabel yang kosong, dan apakah angkanya layak
    ditampilkan sama sekali.
    """
    keluar: dict[str, dict[str, object]] = {}
    for f in faktor:
        d = keluar.setdefault(
            f.indeks, {"terukur": 0, "total": 0, "kosong": [], "layak_tampil": False}
        )
        d["total"] = int(d["total"]) + 1  # type: ignore[arg-type]
        if f.nilai_normalisasi is None:
            d["kosong"].append(f.kode_variabel)  # type: ignore[union-attr]
        else:
            d["terukur"] = int(d["terukur"]) + 1  # type: ignore[arg-type]

    for d in keluar.values():
        total = int(d["total"])  # type: ignore[arg-type]
        terukur = int(d["terukur"])  # type: ignore[arg-type]
        d["layak_tampil"] = bool(total and terukur / total >= AMBANG_INDEKS_LAYAK_TAMPIL)
    return keluar


# ---------------------------------------------------------------------------
# Cakupan sumbu prestise
# ---------------------------------------------------------------------------
#
# Sumbu datar Kompas Kuadran adalah SETENGAH tesis produk ini: "apa kata mata"
# yang diadu dengan "apa kata data". Ia dihitung
# `pipeline/s6_score.py::hitung_prestise_visual()` sebagai rata-rata lima bahan
# dengan `skipna=True` - jadi bahan yang kosong dilewati begitu saja dan
# sumbunya tetap menghasilkan angka untuk setiap heksagon.
#
# Terukur 2 September 2026 atas 708 heksagon: DUA bahan kosong seluruhnya, dan
# keduanya justru satu-satunya yang menilai TAMPILAN secara langsung - M03
# (kesan mewah, dinilai dari foto) dan P02 (posisi NJOP). Yang menggerakkan
# sumbunya tinggal porsi waralaba dan bentuk bangunan: proksi yang masuk akal,
# tetapi proksi. 390 heksagon berdiri di atas tiga bahan, 309 di atas dua, dan
# sembilan di atas SATU.
#
# Keluarga kesalahan yang sama dengan badge yang dulu mengaku disurvei dan
# RiskRadar yang menyebut AMAN tanpa data: angkanya benar, kalimat di sebelahnya
# yang menjanjikan lebih banyak daripada yang diukur.
#
# Yang dikembalikan di sini BUKAN skor. Ia tidak memindahkan satu pun titik,
# tidak menggeser batas kuadran, dan tidak menyembunyikan sumbunya - ia cuma
# menyebutkan sumbu itu berdiri di atas apa.
#
# AMBANG_INDEKS_LAYAK_TAMPIL sengaja TIDAK dipakai di sini, dan alasannya layak
# dicatat: tiga dari lima bahan terisi = 60%, jadi ambang berbasis JUMLAH akan
# lolos dengan mulus justru pada keadaan yang jadi masalahnya - dua bahan yang
# mendefinisikan arti sumbunya yang hilang. Yang menentukan di sini bukan
# BERAPA bahannya, melainkan bahan yang MANA, jadi yang dilaporkan daftarnya.

#: Kelima bahan sumbu prestise, URUT PERSIS seperti
#: `pipeline/s6_score.py::hitung_prestise_visual`. Urutan itu yang muncul di
#: layar sebagai daftar, jadi ia bukan selera - dijaga
#: `test_bahan_prestise_sama_dengan_pipeline`.
BAHAN_PRESTISE: tuple[tuple[str, str], ...] = (
    ("P02", "njop_persentil"),
    ("C05", "pangsa_waralaba"),
    ("M03", "skor_prestise_visual"),
    ("M02", "luas_bangunan_median"),
    ("M01", "rasio_tutupan_bangunan"),
)

#: Dua bahan yang menilai tampilan SECARA LANGSUNG. Ketiga sisanya
#: menyimpulkannya dari hal lain: berapa gerai waralaba di sekitarnya, seberapa
#: besar dan rapat bangunannya. Selama kedua ini kosong, kata "visual" pada nama
#: sumbunya adalah kesimpulan, bukan pengukuran - dan itulah yang wajib
#: dinyatakan di layar.
BAHAN_PRESTISE_LANGSUNG: frozenset[str] = frozenset({"M03", "P02"})


def cakupan_prestise(fitur: "list") -> dict[str, object]:
    """Bahan sumbu prestise mana yang benar-benar terukur.

    Menerima SATU ATAU BANYAK baris `HexFeature`, dan artinya menyesuaikan: satu
    baris menjawab "lokasi ini berdiri di atas apa", banyak baris menjawab
    "sumbu ini, untuk titik yang sedang ditampilkan, berdiri di atas apa".

    Sebuah bahan disebut terisi kalau SETIDAKNYA SATU baris punya nilainya. Untuk
    satu baris itu makna biasa; untuk banyak baris ia pernyataan paling lemah
    yang masih benar, dan itu memang yang dibutuhkan keterangan diagram. Yang
    lebih halus - C05 terisi di 390 dari 708 - tempatnya di panel per-heksagon,
    tempat ia muncul sendiri sebagai selisih antara "tiga bahan" dan "dua bahan".

    Terisi berarti kolomnya tidak NULL, bukan tidak nol: `norm()` di s6
    mengembalikan NaN HANYA untuk nilai yang memang hilang. Nol itu pengukuran -
    jebakan yang sama dengan `nilai_normalisasi = 0,0` di `cakupan_indeks`.
    """
    terisi: list[str] = []
    kosong: list[str] = []
    for kode, kolom in BAHAN_PRESTISE:
        ada = any(getattr(f, kolom, None) is not None for f in fitur)
        (terisi if ada else kosong).append(kode)
    return {
        "terisi": terisi,
        "kosong": kosong,
        "diukur_langsung": bool(BAHAN_PRESTISE_LANGSUNG.intersection(terisi)),
    }


# ---------------------------------------------------------------------------
# Perkiraan
# ---------------------------------------------------------------------------
#
# Kalimat yang menyertai angka PERKIRAAN. Tempatnya di sini dan bukan di
# frontend karena ia dirakit DARI ANGKANYA - dan pemicu yang dihitung dari data
# dengan kalimat yang ditulis tetap adalah jebakan yang sudah terjadi tiga kali
# di repo ini (pita status, halaman gerbang, catatan_data).
#
# Yang paling menentukan di sini kalimat kedua. Tim AI melaporkan R2 0,62 untuk
# D10 dan 0,57 untuk B07, dan angka itu benar - tetapi ia diukur terhadap label
# yang 96,9%-nya sintetis, jadi yang diukurnya adalah seberapa baik model
# menebak formula yang membuat labelnya. Pembanding yang sungguhan justru ada
# di tangan kita: pengamatan misi MAPID di heksagon kita sendiri, yang tidak
# pernah dilihat model itu. Menyebut R2 tanpa menyebut selisih terhadap ukuran
# sungguhan berarti memamerkan nilai ujian dari soal yang dibuat sendiri.

#: Nama awam variabel yang punya perkiraan. Sengaja hanya yang dipakai - daftar
#: lengkap 43 variabel sudah hidup di `api/bersama.py::SEMUA_VARIABEL`.
NAMA_PERKIRAAN: dict[str, tuple[str, str]] = {
    "B01": ("Pangsa transaksi pagi (05-09)", "Share of morning transactions (05-09)"),
    "B02": ("Pangsa transaksi siang (11-14)", "Share of midday transactions (11-14)"),
    "B03": ("Pangsa transaksi sore (16-19)", "Share of afternoon transactions (16-19)"),
    "B04": ("Pangsa transaksi malam (19-23)", "Share of evening transactions (19-23)"),
    "B07": ("Harga rata-rata per porsi", "Average price per portion"),
    "D10": ("Tingkat keramaian terkoreksi", "Corrected busyness level"),
}

#: Kode variabel -> nama kolomnya di `hex_features`.
#:
#: Jembatan yang sama dengan `pipeline/config.py::KODE_KE_KOLOM`, tapi hanya
#: untuk kode yang punya perkiraan. Antarmuka menamai angka lewat nama KOLOM
#: (kamusnya sudah ada di `lib/bahasa.tsx`), jadi tanpa jembatan ini perkiraan
#: akan tampil sebagai baris "B07" tanpa nama. Kesamaannya dijaga
#: `tests/test_aturan.py`.
KODE_PERKIRAAN: dict[str, str] = {
    "B01": "puncak_pagi",
    "B02": "puncak_siang",
    "B03": "puncak_sore",
    "B04": "puncak_malam",
    "B07": "harga_median_porsi",
    "D10": "skor_ramai_terkoreksi",
}

#: Satuan, untuk kalimatnya saja. Angkanya sendiri dikirim apa adanya.
SATUAN_PERKIRAAN: dict[str, tuple[str, str]] = {
    "B01": ("pangsa 0-1", "0-1 share"),
    "B02": ("pangsa 0-1", "0-1 share"),
    "B03": ("pangsa 0-1", "0-1 share"),
    "B04": ("pangsa 0-1", "0-1 share"),
    "B07": ("rupiah per porsi", "rupiah per portion"),
    "D10": ("skala 1-3", "1-3 scale"),
}


def _ang(n: float, desimal: int = 0, bahasa: Bahasa = BAHASA_BAWAAN) -> str:
    """Angka dengan pemisah yang benar untuk bahasanya.

    Alasan yang sama persis dengan `rp()` di atas: "14,580" dibaca pembaca
    Indonesia sebagai empat belas koma lima, dan "0.57" dibaca sebagai nol
    lima puluh tujuh. Keduanya salah seribu kali lipat pada angka yang justru
    sedang dipakai menimbang.
    """
    utuh = f"{n:,.{desimal}f}"
    if bahasa == "en":
        return utuh
    # `translate`, bukan tiga `replace` berantai: rantai itu menukar koma jadi
    # titik lalu menukar titik-titik itu balik jadi koma, dan hasilnya "1.234,5"
    # yang benar cuma kalau ada sentinel di tengahnya. `translate` menukar
    # keduanya dalam satu lintasan, jadi tidak ada langkah antara yang bisa
    # salah dibaca langkah berikutnya.
    return utuh.translate(str.maketrans(",.", ".,"))


def kalimat_perkiraan(kode: str, metode: str, rincian: dict, bahasa: Bahasa) -> str:
    """Satu kalimat: dari mana angkanya, dan seberapa jauh ia pernah meleset.

    `rincian` isinya apa adanya dari `hex_perkiraan.rincian`; yang tidak ada
    dilewati, bukan ditebak. Perkiraan yang keterangannya kosong lebih jujur
    daripada perkiraan yang keterangannya dikarang.
    """
    en = bahasa == "en"
    bagian: list[str] = []

    if metode == "model_gbr":
        n_label = rincian.get("n_label")
        n_asli = rincian.get("n_label_asli")
        algo = rincian.get("algoritma", "model")
        if n_label and n_asli is not None:
            sintetis = n_label - n_asli
            bagian.append(
                f"Prediksi {algo} yang dilatih tim AI atas {n_label} titik label — "
                f"{n_asli} survei sungguhan dan {sintetis} titik sintetis."
                if not en
                else f"A {algo} prediction trained by the AI team on {n_label} labelled "
                f"points — {n_asli} real surveys and {sintetis} synthetic ones."
            )
        r2 = rincian.get("r2")
        if r2 is not None:
            bagian.append(
                f"R² validasi silangnya {_ang(r2, 2, bahasa)}, tetapi diukur terhadap label sintetis itu."
                if not en
                else f"Its cross-validated R² is {r2:.2f}, but measured against those synthetic labels."
            )
    elif metode in {"sekitar", "kawasan", "jabodetabek"}:
        n = rincian.get("n_struk") or rincian.get("n_sumber") or rincian.get("n_label")
        lingkup = {
            "sekitar": ("heksagon di sekitarnya", "the surrounding hexagons"),
            "kawasan": ("kawasan yang sama", "the same area"),
            "jabodetabek": ("seluruh Jabodetabek", "the whole of Jabodetabek"),
        }[metode]
        nama_kawasan = rincian.get("kawasan")
        tempat = nama_kawasan or lingkup[0]
        tempat_en = nama_kawasan or lingkup[1]
        bagian.append(
            f"Pola dari pengamatan di sekitar {tempat}" + (f", {n} struk." if n else ".")
            if not en
            else f"A pattern from the observations around {tempat_en}" + (f", {n} receipts." if n else ".")
        )
        bagian.append(
            "Ia menggambarkan KAWASANNYA, bukan heksagon ini - tidak ada satu pun "
            "transaksi yang tercatat di sini."
            if not en
            else "It describes the AREA, not this hexagon — not a single transaction was "
            "recorded here."
        )

    # Selisih terhadap ukuran SUNGGUHAN. Ini bagian yang paling perlu ada.
    n_uji = rincian.get("n_uji_terukur")
    mae = rincian.get("mae_vs_terukur")
    if n_uji and mae is not None:
        satuan = SATUAN_PERKIRAAN.get(kode, ("", ""))[1 if en else 0]
        # Desimalnya mengikuti BESARAN, bukan disetel tetap. "Meleset rata-rata
        # 14.580 rupiah" tidak butuh koma; "meleset rata-rata 2" pada skala 1-3
        # justru kehilangan seluruh isinya - selisih 2,34 pada skala bermentok 3
        # adalah salah total, dan "2" terbaca seperti angka yang wajar.
        desimal = 0 if abs(mae) >= 100 else 2
        # "Bacalah sebagai kisaran, bukan sebagai harga" salah untuk D10, yang
        # bukan harga melainkan tingkat keramaian. Kalimat penutup yang tidak
        # cocok dengan angkanya terbaca sebagai kalimat yang disalin - dan
        # kalimat yang terbaca disalin membuat seluruh keterangannya dicurigai.
        ekor_benda = (
            ("harga", "a price") if kode == "B07" else ("angka pasti", "a fixed number")
        )
        mape = rincian.get("mape_vs_terukur")
        ekor = f" (rata-rata {_ang(mape, 0, bahasa)}% dari nilainya)" if mape else ""
        ekor_en = f" ({mape:.0f}% of the value on average)" if mape else ""
        bagian.append(
            f"Pada {n_uji} heksagon yang SUDAH kami ukur di lapangan, ia meleset "
            f"rata-rata {_ang(mae, desimal, bahasa)} {satuan}{ekor} — jadi bacalah sebagai kisaran, "
            f"bukan sebagai {ekor_benda[0]}."
            if not en
            else f"On the {n_uji} hexagons we have actually measured in the field it was "
            f"off by {_ang(mae, desimal, bahasa)} {satuan} on average{ekor_en} — so read it as a range, "
            f"not as {ekor_benda[1]}."
        )

    bagian.append(
        "Angka ini tidak pernah ikut menghitung skor, mewarnai peta, atau menaikkan "
        "lencana keyakinan."
        if not en
        else "This number never enters the score, colours the map, or raises the confidence badge."
    )
    return " ".join(bagian)
