"""Bentuk respons API.

Dua aturan yang ditegakkan di lapisan ini:

1. Tidak ada skema yang membawa data misi MAPID mentah. Yang keluar dari API
   hanya hasil agregat per heksagon. (Ketentuan lomba B.7 - melanggar ini
   berisiko diskualifikasi.)
2. Setiap skema yang membawa skor WAJIB membawa `keyakinan`. Skema dibuat
   sedemikian rupa sehingga tidak mungkin mengirim skor tanpa badge-nya.
"""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

TingkatKeyakinan = Literal["TINGGI", "SEDANG", "RENDAH"]
SumberData = Literal["observed", "predicted"]
Kuadran = Literal["HIDDEN_GEM", "JEBAKAN_GENGSI", "PEMENANG_JELAS", "HINDARI"]


class BadgeKeyakinan(BaseModel):
    """Wajib menyertai setiap skor. Lihat docs/data.md bagian Q01-Q03."""

    n_titik_misi: int = Field(description="Jumlah titik data misi MAPID yang mendasari heksagon")
    tingkat: TingkatKeyakinan = Field(description=">=30 TINGGI, 10-29 SEDANG, <10 RENDAH")
    sumber: SumberData = Field(description="observed = hasil survei, predicted = imputasi model")


class IndeksKomposit(BaseModel):
    ipt: float | None = Field(default=None, description="Indeks Potensi Transit, tinggi = baik")
    iae: float | None = Field(default=None, description="Indeks Aktivitas Ekonomi, tinggi = baik")
    ikp: float | None = Field(default=None, description="Indeks Kompetisi, tinggi = BURUK")
    ibr: float | None = Field(default=None, description="Indeks Biaya & Risiko, tinggi = BURUK")


class SkorHeksagon(BaseModel):
    """Ringkasan skor satu heksagon. Bentuk yang dipakai di daftar dan di layer peta."""

    h3_index: str
    kawasan: str
    opportunity_score: float | None = None
    hidden_gem_score: float | None = None
    kuadran: Kuadran | None = None
    peringkat: int | None = None
    zona_izin_komersial: bool | None = Field(
        default=None, description="FALSE = ZoneGuard menolkan skor, apa pun nilai variabel lain"
    )
    keyakinan: BadgeKeyakinan


class FaktorSkor(BaseModel):
    """Satu baris rincian kontribusi. Bahan mentah untuk jelaskan_skor()."""

    kode_variabel: str
    indeks: Literal["IPT", "IAE", "IKP", "IBR"]
    nilai_mentah: float | None = None
    nilai_normalisasi: float | None = None
    persentil: float | None = None
    kontribusi: float | None = None


# --- ZoneGuard (fitur 4) ---------------------------------------------------

StatusZona = Literal["DIIZINKAN", "DILARANG", "TIDAK_DIKETAHUI"]


class StatusZoneGuard(BaseModel):
    """Hasil pemeriksaan zonasi. Selalu ikut di setiap respons yang membawa skor.

    `filter_mutlak` adalah janji API: kalau TRUE, heksagon ini tidak pernah muncul
    di endpoint rekomendasi mana pun dan skornya nol.
    """

    status: StatusZona
    kelas_zona: str | None = None
    filter_mutlak: bool = Field(description="TRUE = skor dinolkan dan tidak pernah direkomendasikan")
    penjelasan: str


# --- Commuter Clock (fitur 3) ----------------------------------------------


class TitikJam(BaseModel):
    """Satu jam dalam Commuter Clock."""

    jam: int = Field(ge=0, le=23)
    n_transaksi: int
    nominal_total: float | None = None
    nominal_median: float | None = None
    pangsa_captive: float | None = Field(
        default=None, description="0-1. Penumpang tanpa alternatif selain transit"
    )
    pangsa_choice: float | None = Field(
        default=None, description="1 - pangsa_captive. Punya kendaraan pribadi tapi memilih transit"
    )
    metode: Literal["observed", "proxy"] = "proxy"


class CommuterClock(BaseModel):
    """Pola jam operasional 05:00-22:00, memisahkan captive dan choice rider.

    `ember` mempertahankan B01-B04 supaya angka yang masuk perhitungan skor tetap
    bisa dilihat berdampingan dengan pola per jam yang lebih rinci.
    """

    h3_index: str
    jam: list[TitikJam]
    ember: dict[str, float | None] = Field(
        default_factory=dict, description="B01-B04, empat ember yang dipakai dalam skoring"
    )
    jam_puncak: int | None = Field(default=None, description="Jam dengan transaksi terbanyak")
    pangsa_captive_harian: float | None = None
    dominasi: Literal["captive", "choice", "seimbang"] | None = None
    keyakinan: BadgeKeyakinan
    catatan: str | None = Field(
        default=None, description="Diisi kalau seluruh jam berasal dari proxy, bukan struk"
    )


# --- PriceLens (fitur 1) ---------------------------------------------------


class RentangWajar(BaseModel):
    """Rentang harga wajar dalam satu kawasan, dari persentil 25-75.

    Dipakai untuk menjawab "mahal atau murah?" - pertanyaan yang tidak bisa
    dijawab angka tunggal tanpa pembanding.
    """

    p25: float | None = None
    p50: float | None = None
    p75: float | None = None
    n_sampel: int = 0


class PriceLensHeksagon(BaseModel):
    """Kartu harga satu heksagon.

    Dua angka utamanya - harga sewa per m² dan belanja per jam - keduanya lahir
    dari OCR: rupiah tidak ada di satu pun kolom teks dataset misi.
    """

    h3_index: str
    kawasan: str
    harga_sewa_per_m2: float | None = Field(default=None, description="P07, rupiah per m² per bulan")
    harga_sewa_median: float | None = Field(default=None, description="P05, rupiah per bulan")
    belanja_per_jam: float | None = Field(default=None, description="B10, rupiah per jam operasional")
    harga_median_porsi: float | None = Field(default=None, description="B07")
    njop_m2: float | None = Field(default=None, description="P01, pembanding independen dari OCR")

    wajar_sewa_per_m2: RentangWajar
    wajar_belanja_per_jam: RentangWajar
    posisi_sewa: Literal["MURAH", "WAJAR", "MAHAL", "TIDAK_DIKETAHUI"] = "TIDAK_DIKETAHUI"
    selisih_persen_dari_median: float | None = Field(
        default=None, description="Positif = lebih mahal daripada median kawasan"
    )

    keyakinan: BadgeKeyakinan


# --- RiskRadar (fitur 5) ---------------------------------------------------

TingkatRisiko = Literal["AMAN", "WASPADA", "BAHAYA", "TIDAK_DIKETAHUI"]


class PeringatanRisiko(BaseModel):
    """Label peringatan yang muncul di peta saat churn melewati ambang wajar."""

    tingkat: TingkatRisiko
    label: str
    indeks_churn: float | None = None
    ambang_waspada: float | None = Field(default=None, description="Persentil 75 dalam kawasan")
    ambang_bahaya: float | None = Field(default=None, description="Persentil 90 dalam kawasan")


class TitikKuadran(BaseModel):
    """Satu titik di diagram kuadran interaktif.

    x = prestise visual (bagaimana lokasi terlihat), y = skor peluang (apa kata
    datanya). Keduanya sengaja diukur dari sumber yang berbeda; kalau keduanya
    berkorelasi kuat, diagramnya kehilangan arti.
    """

    h3_index: str
    kawasan: str
    x_prestise: float | None = None
    y_peluang: float | None = None
    kuadran: Kuadran | None = None
    indeks_churn: float | None = None
    risiko: TingkatRisiko = "AMAN"
    keyakinan: BadgeKeyakinan


class DiagramKuadran(BaseModel):
    titik: list[TitikKuadran]
    batas_x: float | None = Field(default=None, description="Median prestise - garis pemisah")
    batas_y: float | None = Field(default=None, description="Median skor peluang - garis pemisah")
    keterangan: dict[str, str] = Field(default_factory=dict)


# --- GemFinder (fitur 6) ---------------------------------------------------


class AlasanGem(BaseModel):
    """Satu alasan sebuah heksagon terpilih sebagai Hidden Gem.

    Dirakit dari angka yang sudah ada di basis data, bukan dikarang LLM.
    `bukti` adalah kalimatnya; `kode_variabel` menunjuk asal angkanya.
    """

    metode: Literal["residual_biaya", "kuadran", "iptt"]
    bukti: str
    kode_variabel: list[str] = Field(default_factory=list)


class HiddenGem(BaseModel):
    """Satu baris GemFinder: skor + rangkuman alasan terpilihnya."""

    skor: SkorHeksagon
    n_metode_lolos: int = Field(description="Minimal 2 dari 3 - lihat docs/skoring.md")
    alasan: list[AlasanGem]
    ringkasan: str = Field(description="Satu paragraf siap tampil di kartu")
    zoneguard: StatusZoneGuard


# --- Simulasi kelayakan usaha ---------------------------------------------


class MasukanSimulasi(BaseModel):
    """Apa yang dipilih pengguna. Dikirim balik utuh supaya hasilnya bisa dibaca
    ulang tanpa perlu mengingat apa yang tadi diisi."""

    jenis_usaha: str
    label_usaha: str
    jam_buka: int
    luas_m2: int
    pangsa_persen: float
    margin_persen: float
    hari_per_bulan: int
    # Dua isian yang penggunanya tahu lebih baik daripada basis data: sewa yang
    # ditawarkan padanya, dan harga jual rencananya sendiri. Keduanya opsional -
    # kalau kosong, simulasi jatuh ke angka heksagon seperti sebelumnya.
    sewa_bulanan_diminta: float | None = None
    harga_rata_rata: float | None = None


class SumberSimulasi(BaseModel):
    """Asal tiap angka yang bisa datang dari dua arah: `pengguna` atau `data`.

    Ada supaya antarmuka bisa menuliskannya di sebelah angkanya. Tanpa ini,
    angka yang diketik orang dan angka yang diukur pipeline terlihat sama persis
    di layar - dan itu kekaburan yang persis dilarang docstring `core/simulasi.py`.
    `None` berarti belum ada dari mana pun.
    """

    sewa: Literal["pengguna", "data"] | None = None
    harga_rata_rata: Literal["pengguna", "data"] | None = None


class TerukurSimulasi(BaseModel):
    """Angka dari basis data. Pengguna TIDAK bisa mengubah satu pun di sini."""

    belanja_per_jam: float | None = None
    nominal_median_struk: float | None = None
    harga_median_porsi: float | None = None
    harga_sewa_per_m2: float | None = None
    indeks_kompetisi: float | None = None
    indeks_churn: float | None = None


class HasilSimulasi(BaseModel):
    """Turunan. Seluruhnya boleh None - kosong tetap kosong, tidak pernah nol."""

    omzet_harian: float | None = None
    omzet_bulanan: float | None = None
    sewa_bulanan: float | None = None
    laba_kotor_bulanan: float | None = None
    rasio_sewa_terhadap_omzet: float | None = None
    pembeli_impas_per_hari: float | None = None
    # Pangsa yang membuat laba tepat nol. Angka paling berguna di seluruh
    # simulasi: alih-alih menebak pangsa lalu membaca hasilnya, orang bisa
    # membandingkan "butuh berapa" dengan perasaannya soal "dapat berapa".
    pangsa_impas_persen: float | None = None
    # Kebiasaan pasar ruko: sewa dibayar di muka setahun. Bukan aturan - cuma
    # aritmetika sewa x 12 yang menyelamatkan orang dari kaget di notaris.
    sewa_tahun_pertama: float | None = None
    # Hanya terisi kalau sewanya diisi sendiri. Gunanya menyandingkan penawaran
    # yang diterima orang dengan sewa terukur di heksagon itu - satu-satunya
    # cara tahu penawarannya wajar atau tidak.
    sewa_per_m2_tersirat: float | None = None


class TitikSensitivitas(BaseModel):
    """Satu baris tabel kepekaan: kalau pangsa X, labanya Y."""

    pangsa_persen: float
    laba_kotor_bulanan: float | None = None


class LingkunganSimulasi(BaseModel):
    """Keadaan sekitar heksagon, dalam satuan yang bisa dibaca orang awam.

    Seluruhnya TERUKUR - tidak satu pun boleh ditebak. Yang tidak ada di basis
    data tidak muncul di sini, dan antarmuka menuliskannya sebagai "belum ada"
    alih-alih mengarang. Dua hal yang sering diminta tetapi memang TIDAK ADA:
    UMR (data SK gubernur, di luar 43 variabel) dan jumlah jalan akses (butuh
    agregasi jaringan jalan yang belum dikerjakan s4).
    """

    populasi_100m: float | None = None
    populasi_usia_produktif: float | None = None
    n_kompetitor_langsung: float | None = None
    keragaman_kuliner: float | None = None
    n_menetap_kuliner: float | None = None
    jarak_simpul_m: float | None = None
    waktu_jalan_menit: float | None = None
    skor_simpul: float | None = None
    ridership_proksi: float | None = None
    kepadatan_poi_total: float | None = None
    kepadatan_kantor: float | None = None
    kepadatan_kos: float | None = None
    rasio_weekend: float | None = None


class JamSimulasi(BaseModel):
    """Satu jam pada Commuter Clock, dinormalkan 0..1 terhadap jam tersibuk."""

    jam: int
    relatif: float
    pangsa_captive: float | None = None


class PeringatanSimulasi(BaseModel):
    kode: str
    tingkat: Literal["INFO", "WASPADA", "BAHAYA"]
    pesan: str


class Simulasi(BaseModel):
    """Satu skenario usaha atas satu heksagon.

    Membawa `keyakinan` seperti setiap skema lain yang menyentuh skor - lihat
    aturan 3 repo ini. Simulasi yang berdiri di atas tiga titik survei dan yang
    berdiri di atas empat puluh titik tidak boleh terbaca sama.
    """

    h3_index: str
    kawasan: str
    masukan: MasukanSimulasi
    sumber: SumberSimulasi
    terukur: TerukurSimulasi
    hasil: HasilSimulasi
    rumus: dict[str, str]
    peringatan: list[PeringatanSimulasi] = Field(default_factory=list)
    keyakinan: BadgeKeyakinan
    jam_teramai: list[int] = Field(
        default_factory=list, description="Tiga jam dengan transaksi tertinggi"
    )
    lingkungan: LingkunganSimulasi = Field(default_factory=LingkunganSimulasi)
    sensitivitas: list[TitikSensitivitas] = Field(
        default_factory=list,
        description="Laba pada beberapa nilai pangsa - rumus yang sama, masukan berbeda",
    )
    profil_jam: list[JamSimulasi] = Field(
        default_factory=list, description="05.00-22.00, dinormalkan ke jam tersibuk"
    )


# --- Detail heksagon -------------------------------------------------------


class DetailHeksagon(BaseModel):
    """Respons lengkap saat pengguna mengklik satu heksagon.

    Memuat 43 variabel dalam bentuk agregat + rincian kontribusi skor.
    Tidak memuat satu pun record misi mentah.
    """

    skor: SkorHeksagon
    indeks: IndeksKomposit
    # KOSONG untuk tamu dan akun gratis. Bukan diblur di frontend - benar-benar
    # tidak dikirim. Blur adalah lapisan CSS, dan lapisan CSS bisa dilepas siapa
    # pun yang membuka panel pengembang; yang tidak pernah meninggalkan server
    # tidak bisa dilepas.
    variabel: dict[str, Any] = Field(
        default_factory=dict, description="43 variabel analisis, sudah teragregasi. Premium."
    )
    faktor: list[FaktorSkor] = Field(
        default_factory=list, description="Kontribusi tiap variabel ke skor. Premium."
    )
    # Apa yang ditahan, dan kenapa. Frontend menggambar tirai dari daftar ini,
    # jadi ia tidak pernah bisa menawarkan sesuatu yang backend tidak tahan -
    # atau membiarkan terbuka sesuatu yang backend sebenarnya sudah kosongkan.
    terkunci: list[str] = Field(
        default_factory=list, description="Nama bagian yang ditahan karena tingkat akun"
    )
    tingkat_akun: str = Field(default="tamu", description="tamu | gratis | premium")
    commuter_clock: dict[str, float | None] = Field(
        default_factory=dict, description="B01-B04: distribusi transaksi per rentang jam"
    )
    zoneguard: StatusZoneGuard
    risiko: PeringatanRisiko
    kuadran_penjelasan: str | None = None


class SimpulTransit(BaseModel):
    id: int
    nama: str
    moda: str
    kawasan: str
    lat: float
    lon: float


class RuteJalan(BaseModel):
    """Satu jalur jalan kaki dari pusat heksagon ke simpul terdekat.

    Geometrinya rute SUNGGUHAN dari OpenRouteService, mengikuti jalan yang
    benar-benar ada - bukan garis lurus, bukan lingkaran. Dihitung offline oleh
    `pipeline/rute_ors.py` dan disimpan di `hex_routes`; backend hanya membaca.

    `urutan` 0 adalah yang tercepat menurut ORS. Sisanya alternatif, dan
    alternatif di sini bukan basa-basi: ORS diminta hanya mengembalikan jalur
    yang berbagi paling banyak 60% ruas dengan yang utama, jadi yang muncul
    memang jalan yang berbeda - bukan rute sama dengan satu belokan bergeser.
    """

    urutan: int
    jarak_m: float
    menit: float
    utama: bool
    #: [lon, lat] berurutan, siap dipakai sebagai GeoJSON LineString.
    koordinat: list[list[float]]


class KonteksSimpul(BaseModel):
    """Hubungan satu heksagon dengan stasiun terdekatnya, untuk digambar di peta.

    TETAP BUKAN ISOCHRONE, dan bedanya tetap harus terlihat. Isochrone adalah
    BIDANG - "sejauh mana orang sampai dalam 10 menit" - dan tinggal di
    `catchment_areas`, yang masih kosong. Yang di sini GARIS: satu jalur menuju
    satu titik. Bentuk yang tidak bisa disalahartikan sebagai kawasan jangkauan.

    Sejak rute ORS masuk, garisnya mengikuti jalan yang sebenarnya. `rute` yang
    kosong berarti heksagon ini memang belum pernah dirutekan - dan waktu itu
    `jarak_m` jatuh kembali ke garis lurus, dengan `garis_lurus` menyatakannya
    supaya antarmuka tidak bisa diam-diam menampilkannya seolah rute.

    `jarak_lurus_m` selalu ikut walaupun rutenya ada, karena selisih keduanya
    justru informasi: 830 m garis lurus yang ternyata 1.418 m berjalan kaki
    adalah lokasi yang TERLIHAT dekat stasiun tanpa benar-benar dekat - persis
    jenis jebakan yang produk ini ada untuk menunjukkannya.
    """

    h3_index: str
    lat: float
    lon: float
    simpul: SimpulTransit | None = None
    jarak_m: float | None = Field(default=None, description="Rute jalan kaki kalau ada, kalau tidak garis lurus")
    menit_jalan: float | None = Field(default=None, description="Menurut ORS kalau ada rute")
    jarak_lurus_m: float | None = Field(default=None, description="Selalu garis lurus, dari PostGIS")
    faktor_memutar: float | None = Field(
        default=None, description="jarak rute / jarak lurus. 1,7 = memutar 70% lebih jauh"
    )
    rute: list[RuteJalan] = Field(default_factory=list)
    garis_lurus: bool = True
    catatan: str


# --- AI Consultant ---------------------------------------------------------

NamaFungsi = Literal[
    # dijalankan backend (menyentuh basis data, mengembalikan angka)
    "cari_lokasi",
    "bandingkan",
    "jelaskan_skor",
    "cek_harga",  # PriceLens
    "pola_jam",  # Commuter Clock
    "cek_zona",  # ZoneGuard
    "cari_hidden_gem",  # GemFinder
    "cek_risiko",  # RiskRadar
    # dijalankan frontend (aksi peta, tidak menyentuh basis data)
    "flyTo",
    "highlight",
    "setLayer",
    "filter",
]


class AksiPeta(BaseModel):
    """Instruksi untuk frontend. LLM memintanya, peta yang mengeksekusi.

    Inilah bentuk konkret 'spatial output' yang diminta ketentuan C.2:
    jawaban AI tidak berhenti sebagai teks, tapi menggerakkan peta.
    """

    fungsi: NamaFungsi
    argumen: dict[str, Any] = Field(default_factory=dict)


class PesanRiwayat(BaseModel):
    """Satu giliran percakapan sebelumnya."""

    peran: Literal["pengguna", "asisten"]
    teks: str = Field(max_length=4000)


class PermintaanAI(BaseModel):
    pertanyaan: str = Field(min_length=1, max_length=2000)

    # Riwayat dikirim ulang oleh frontend tiap giliran, bukan disimpan di server.
    # Backend jadi tanpa-status: tidak ada sesi yang perlu dibersihkan, tidak ada
    # kebocoran percakapan antarpengguna, dan proses Render yang tidur lalu bangun
    # tidak kehilangan apa pun.
    #
    # Dibatasi 20 pesan karena seluruh riwayat ikut dikirim ke model setiap
    # giliran - biayanya tumbuh kuadratik terhadap panjang percakapan.
    riwayat: list[PesanRiwayat] = Field(
        default_factory=list, max_length=20, description="Giliran sebelumnya, terlama dulu"
    )

    hex_terpilih: str | None = Field(default=None, description="Konteks: heksagon yang sedang dibuka")
    layer_aktif: str | None = None
    viewport: dict[str, float] | None = None


class JejakFungsi(BaseModel):
    """Satu langkah yang benar-benar dijalankan backend saat menjawab.

    Ada untuk ketentuan C.1: proses AI harus bisa dijelaskan. Pengguna dan juri
    bisa melihat fungsi apa yang dipanggil dan dengan argumen apa - bukan hanya
    hasil akhirnya.
    """

    fungsi: NamaFungsi
    argumen: dict[str, Any] = Field(default_factory=dict)
    ringkas_hasil: str = Field(description="Ringkasan satu baris, bukan seluruh payload")


class JawabanAI(BaseModel):
    """Jawaban asisten.

    `sumber_angka` memaksa setiap angka dalam `teks` bisa ditelusuri ke variabel
    di basis data. Kalau kosong, artinya jawaban tidak mengutip angka sama sekali -
    bukan artinya angka boleh dikarang.
    """

    teks: str
    aksi_peta: list[AksiPeta] = Field(default_factory=list)
    sumber_angka: list[FaktorSkor] = Field(default_factory=list)
    keyakinan: BadgeKeyakinan | None = None
    jejak: list[JejakFungsi] = Field(default_factory=list)
    model: str | None = Field(default=None, description="Model yang menyusun narasi")
    hex_disebut: list[str] = Field(
        default_factory=list, description="Heksagon yang dirujuk jawaban ini"
    )


# --- Akun, langganan, token ------------------------------------------------
#
# Tiga aturan yang ditegakkan di bagian ini:
#
#   1. Tidak ada skema yang membawa `sidik_sandi`. Bukan "jangan lupa hapus" -
#      tidak ada field-nya sama sekali, jadi tidak ada yang bisa lupa.
#   2. Kata sandi masuk lewat skema TERPISAH dari yang keluar. Satu model yang
#      dipakai dua arah cepat atau lambat mengembalikan apa yang diterimanya.
#   3. Yang keluar selalu membawa `tingkat`. Frontend tidak pernah menyimpulkan
#      tingkat dari ada-tidaknya langganan; ia membaca satu field.


class PermintaanDaftar(BaseModel):
    nama_pengguna: str = Field(min_length=3, max_length=40)
    email: EmailStr
    sandi: str = Field(min_length=8, max_length=128)
    nama_tampilan: str | None = Field(default=None, max_length=80)

    @field_validator("nama_pengguna")
    @classmethod
    def _bersih(cls, v: str) -> str:
        """Huruf, angka, titik, garis bawah, garis pisah. Tidak lebih.

        Nama pengguna ikut tampil di antarmuka dan ikut jadi bagian sapaan.
        Membatasinya di sini lebih murah daripada meloloskan spasi ganda dan
        karakter tak terlihat lalu memburunya di setiap tempat yang menampilkannya.
        """
        v = v.strip()
        if not v.replace(".", "").replace("_", "").replace("-", "").isalnum():
            raise ValueError("Nama pengguna hanya boleh huruf, angka, titik, _ dan -")
        return v


class PermintaanMasuk(BaseModel):
    """`identitas` menerima nama pengguna ATAU surel - lihat User di models.py."""

    identitas: str = Field(min_length=3, max_length=160)
    sandi: str = Field(min_length=1, max_length=128)


class RingkasLangganan(BaseModel):
    paket: str
    selamanya: bool
    berlaku_sampai: datetime | None = None
    dimulai_pada: datetime | None = None


class PreferensiUsaha(BaseModel):
    """Preferensi yang diisi saat onboarding premium. Seluruhnya opsional.

    Ini preferensi TAMPILAN, bukan masukan skor: kawasan yang dipilih menyetel
    saringan peta, jenis usaha menyetel bawaan simulasi. Tidak ada satu angka
    peringkat pun yang berubah karenanya - peringkat tetap milik pipeline.
    """

    jenis_usaha: str | None = None
    kawasan: str | None = None
    budget_sewa_bulanan: int | None = Field(default=None, ge=0)


class Akun(BaseModel):
    """Bentuk akun yang keluar ke frontend. Tidak pernah memuat sidik sandi."""

    id: int
    nama_pengguna: str
    email: str
    nama_tampilan: str | None = None
    peran: str
    tingkat: Literal["gratis", "premium"]
    saldo_token: int
    dibuat_pada: datetime | None = None
    langganan: RingkasLangganan | None = None
    preferensi: PreferensiUsaha | None = None


class SesiAkun(BaseModel):
    """Balasan daftar dan masuk: tiket + akunnya sekaligus.

    Digabung supaya frontend tidak perlu memanggil /akun/saya persis sesudah
    masuk. Satu perjalanan bolak-balik lebih sedikit, dan tidak ada jendela di
    mana antarmuka sudah punya tiket tetapi belum tahu tingkatnya.
    """

    tiket: str
    akun: Akun


class MutasiTokenKeluar(BaseModel):
    jumlah: int
    keperluan: str
    catatan: str | None = None
    h3_index: str | None = None
    saldo_sesudah: int
    dibuat_pada: datetime


class PermintaanLangganan(BaseModel):
    paket: str = Field(description="Kode paket dari GET /akun/paket")


class PermintaanBeliToken(BaseModel):
    paket: str = Field(description="Kode paket token dari GET /akun/paket")


class ButirPantauan(BaseModel):
    h3_index: str
    kawasan: str | None = None
    # Titik tengah heksagon, untuk menggambar pin lokasi tersimpan di peta.
    # Centroid, BUKAN geometri penuh: pin cuma butuh satu titik, dan geometri
    # enam-simpul untuk daftar yang bisa berisi puluhan baris cuma menggemukkan
    # respons.
    lat: float | None = None
    lon: float | None = None
    catatan: str | None = None
    skor_saat_dipantau: float | None = None
    skor_sekarang: float | None = None
    selisih: float | None = None
    versi_saat_dipantau: str | None = None
    versi_sekarang: str | None = None
    kuadran: str | None = None
    risiko: str | None = None
    dibuat_pada: datetime


class PermintaanPantau(BaseModel):
    h3_index: str = Field(min_length=15, max_length=20)
    catatan: str | None = Field(default=None, max_length=200)


class TitikRiwayat(BaseModel):
    versi: str
    dihitung_pada: datetime | None = None
    opportunity_score: float | None = None
    hidden_gem_score: float | None = None
    kuadran: str | None = None
    peringkat: int | None = None


class RiwayatSkor(BaseModel):
    """Riwayat skor satu heksagon lintas versi penerbitan.

    `cukup_untuk_tren` jujur, bukan sopan: dengan satu versi saja tidak ada tren
    apa pun untuk digambar, dan grafik garis dari satu titik adalah kebohongan
    berbentuk grafik. Frontend membaca field ini dan menuliskan keadaannya apa
    adanya alih-alih menggambar garis datar yang tampak meyakinkan.
    """

    h3_index: str
    titik: list[TitikRiwayat] = Field(default_factory=list)
    cukup_untuk_tren: bool = False
    catatan: str


class BarisKomparasi(BaseModel):
    """Satu kolom dalam tabel komparasi berdampingan."""

    h3_index: str
    kawasan: str
    opportunity_score: float | None = None
    hidden_gem_score: float | None = None
    kuadran: str | None = None
    peringkat: int | None = None
    indeks: IndeksKomposit
    zoneguard: StatusZoneGuard
    risiko: PeringatanRisiko
    harga_sewa_per_m2: float | None = None
    belanja_per_jam: float | None = None
    waktu_jalan_menit: float | None = None
    n_kompetitor_langsung: float | None = None
    keyakinan: BadgeKeyakinan


class Komparasi(BaseModel):
    """Komparasi berdampingan 2-4 heksagon.

    `menang` memuat, untuk tiap metrik, h3_index yang terbaik pada metrik itu -
    dihitung di sini supaya frontend tidak perlu tahu metrik mana yang "tinggi
    lebih baik" dan mana yang sebaliknya. IKP dan IBR tinggi itu BURUK, dan
    aturan itu sudah hidup di backend; menyalinnya ke frontend berarti dua
    tempat yang harus sepakat.
    """

    baris: list[BarisKomparasi]
    menang: dict[str, str | None] = Field(default_factory=dict)


class AlasanRekomendasi(BaseModel):
    """Satu alasan, dan ANGKA yang mendasarinya.

    `nilai` selalu ikut. Alasan tanpa angka ("lokasinya strategis") adalah
    kalimat pemasaran; alasan dengan angka bisa diperiksa, dibantah, dan
    dibandingkan dengan lokasi lain.
    """

    kode: str
    teks: str
    nilai: float | None = None
    #: cocok = mendukung rekomendasi, catatan = hal yang tetap harus diketahui
    jenis: Literal["cocok", "catatan"] = "cocok"


class Rekomendasi(BaseModel):
    """Satu lokasi yang direkomendasikan untuk SATU orang."""

    skor: SkorHeksagon
    kawasan: str
    lat: float | None = None
    lon: float | None = None
    harga_sewa_median: float | None = None
    harga_sewa_per_m2: float | None = None
    belanja_per_jam: float | None = None
    waktu_jalan_menit: float | None = None
    n_kompetitor_langsung: float | None = None
    indeks_churn: float | None = None
    zoneguard: StatusZoneGuard
    risiko: PeringatanRisiko
    alasan: list[AlasanRekomendasi] = Field(default_factory=list)
    ringkasan: str


class HasilRekomendasi(BaseModel):
    """Balasan /skor/rekomendasi.

    `kriteria` dikembalikan apa adanya supaya antarmuka bisa menuliskan
    "berdasarkan: warung makan, Manggarai, di bawah Rp15 jt" - orang berhak
    tahu atas dasar apa daftar ini disusun, dan bisa langsung melihat kalau
    salah satu kriterianya ternyata tidak ia maksud.

    `dipotong` benar kalau daftarnya dipendekkan karena tingkat akun. Angka
    `total_cocok` tetap jujur: yang disembunyikan jumlahnya, bukan
    keberadaannya.
    """

    hasil: list[Rekomendasi] = Field(default_factory=list)
    total_cocok: int = 0
    kriteria: dict[str, Any] = Field(default_factory=dict)
    dipotong: bool = False
    catatan: str


class DinamikaKawasan(BaseModel):
    """Sebaran churn dan aktivitas satu kawasan - fitur Pemantauan.

    Ini BUKAN deret waktu. Basis data baru memuat satu versi skor, dan
    memperlihatkan dua belas bulan dari satu titik data berarti mengarang
    sebelas di antaranya. Yang ditampilkan adalah sebaran yang benar-benar ada:
    persentil churn kawasan, jumlah heksagon per kuadran, dan berapa yang
    melewati ambang waspada. Begitu pipeline menerbitkan versi kedua, endpoint
    riwayat yang mengisi sisi waktunya.
    """

    kawasan: str
    n_heksagon: int
    churn_p50: float | None = None
    churn_p75: float | None = None
    churn_p90: float | None = None
    n_waspada: int = 0
    n_bahaya: int = 0
    per_kuadran: dict[str, int] = Field(default_factory=dict)
    rata_opportunity: float | None = None
    cakupan_survei: float | None = None
    versi: str
    catatan: str
