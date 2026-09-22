"""Bentuk respons API."""

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


class CakupanIndeks(BaseModel):
    """Berapa bahan sebuah indeks yang benar-benar terukur."""

    terukur: int = Field(description="Jumlah bahan yang punya nilai sungguhan")
    total: int = Field(description="Jumlah bahan seluruhnya")
    kosong: list[str] = Field(default_factory=list, description="Kode variabel yang kosong")
    layak_tampil: bool = Field(
        description="FALSE = angkanya nyaris seluruhnya asumsi, jangan ditampilkan sebagai angka"
    )


class CakupanPrestise(BaseModel):
    """Bahan sumbu DATAR kuadran mana yang benar-benar terukur."""

    terisi: list[str] = Field(
        default_factory=list, description="Kode variabel yang punya nilai, urut seperti pipeline"
    )
    kosong: list[str] = Field(default_factory=list, description="Kode variabel yang kosong")
    diukur_langsung: bool = Field(
        description="FALSE = tidak ada satu pun bahan yang menilai tampilan secara langsung"
    )


class IndeksKomposit(BaseModel):
    ipt: float | None = Field(default=None, description="Indeks Potensi Transit, tinggi = baik")
    iae: float | None = Field(default=None, description="Indeks Aktivitas Ekonomi, tinggi = baik")
    ikp: float | None = Field(default=None, description="Indeks Kompetisi, tinggi = BURUK")
    ibr: float | None = Field(default=None, description="Indeks Biaya & Risiko, tinggi = BURUK")
    #: Berkunci kode indeks: IPT | IAE | IKP | IBR. Gratis untuk semua tingkat -
    #: ia keterangan mutu, sekeluarga dengan badge keyakinan, bukan isi berbayar.
    cakupan: dict[str, CakupanIndeks] = Field(default_factory=dict)


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
    # Dipakai daftar layer PriceLens; None = belum ada sampel harga di heksagon ini.
    harga_sewa_per_m2: float | None = None
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
    """Hasil pemeriksaan zonasi. Selalu ikut di setiap respons yang membawa skor."""

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
    """Pola jam operasional 05:00-22:00, memisahkan captive dan choice rider."""

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
    """Rentang harga wajar dalam satu kawasan, dari persentil 25-75."""

    p25: float | None = None
    p50: float | None = None
    p75: float | None = None
    n_sampel: int = 0


class PriceLensHeksagon(BaseModel):
    """Kartu harga satu heksagon."""

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
    """Satu titik di diagram kuadran interaktif."""

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
    batas_y: float | None = Field(default=None, description="Median Opportunity Score - garis pemisah")
    keterangan: dict[str, str] = Field(default_factory=dict)
    #: Dihitung dari TITIK YANG DIKEMBALIKAN, bukan dari seluruh basis data -
    #: keterangan sumbu harus menerangkan diagram yang sedang dilihat orangnya,
    #: dan diagram itu bisa tersaring per kawasan.
    cakupan_prestise: CakupanPrestise | None = Field(
        default=None, description="Bahan sumbu datar yang terukur pada titik yang ditampilkan"
    )


# --- GemFinder (fitur 6) ---------------------------------------------------


class AlasanGem(BaseModel):
    """Satu alasan sebuah heksagon terpilih sebagai Hidden Gem."""

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
    # Omzet usaha pengguna yang SUDAH berjalan, untuk mengukur pertumbuhan.
    omzet_sekarang_bulanan: float | None = None


class SumberSimulasi(BaseModel):
    """Asal tiap angka yang bisa datang dari dua arah: `pengguna` atau `data`."""

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


class PertumbuhanSimulasi(BaseModel):
    """Omzet usaha yang sudah jalan dibanding proyeksi di lokasi ini.

    Seluruhnya None kalau penggunanya tidak mengisi omzet sekarang - dan None
    memang jawabannya, bukan nol.
    """

    omzet_sekarang_bulanan: float | None = None
    selisih_omzet_bulanan: float | None = None
    pertumbuhan_persen: float | None = None


class BlokSimulasi(BaseModel):
    """Simulasi yang dipersempit ke SATU blok res-10 di dalam heksagonnya."""

    h3_blok: str
    peringkat: int | None = None
    nama_jalan_utama: str | None = None
    skor_blok: float | None = None
    rata_skor_heksagon: float | None = None
    faktor_permintaan: float
    faktor_berlaku: bool
    menit_jalan: float | None = None
    jarak_jalan_utama_m: float | None = None
    n_pesaing_150m: int | None = None
    izin_komersial: bool | None = None
    kelas_zona: str | None = None


class LingkunganSimulasi(BaseModel):
    """Keadaan sekitar heksagon, dalam satuan yang bisa dibaca orang awam."""

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
    """Satu skenario usaha atas satu heksagon."""

    h3_index: str
    kawasan: str
    masukan: MasukanSimulasi
    sumber: SumberSimulasi
    terukur: TerukurSimulasi
    hasil: HasilSimulasi
    pertumbuhan: PertumbuhanSimulasi = Field(default_factory=PertumbuhanSimulasi)
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
    blok: BlokSimulasi | None = Field(
        default=None, description="Terisi kalau simulasi dipersempit ke satu blok"
    )


# --- Detail heksagon -------------------------------------------------------


class PerkiraanHeksagon(BaseModel):
    """Satu angka PERKIRAAN untuk sebuah heksagon, berikut mutunya."""

    kode: str = Field(description="Kode variabel yang diperkirakan, mis. B07")
    kolom: str = Field(description="Nama kolomnya, supaya antarmuka bisa menamainya")
    nilai: float | None = None
    metode: str = Field(description="model_gbr | sekitar | kawasan | jabodetabek")
    keterangan: str = Field(description="Kalimat yang menerangkan asal dan batasnya")
    n_sumber: int | None = Field(
        default=None, description="Berapa pengamatan SUNGGUHAN yang menyusunnya"
    )
    mutu: dict[str, Any] = Field(default_factory=dict)


class DetailHeksagon(BaseModel):
    """Respons lengkap saat pengguna mengklik satu heksagon."""

    skor: SkorHeksagon
    indeks: IndeksKomposit
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
    #: Sumbu datar kuadran berdiri di atas bahan apa UNTUK HEKSAGON INI. Gratis,
    #: sama dengan `indeks.cakupan`: kuadrannya gratis, jadi keterangan yang
    #: menjaganya supaya tidak dibaca berlebihan harus ikut gratis.
    cakupan_prestise: CakupanPrestise | None = None
    #: PERKIRAAN pendukung. Berbayar, sama dengan `variabel`: isinya menjawab
    #: pertanyaan yang sama ("berapa angkanya di sini"), dan batas berbayar yang
    #: berbeda untuk pertanyaan yang sama tidak bisa diterangkan ke siapa pun.
    perkiraan: list[PerkiraanHeksagon] = Field(
        default_factory=list,
        description="Angka perkiraan, tidak pernah dari pengukuran di heksagon ini. Premium.",
    )


class SimpulTransit(BaseModel):
    id: int
    nama: str
    moda: str
    kawasan: str
    lat: float
    lon: float


class RuteJalan(BaseModel):
    """Satu jalur jalan kaki dari pusat heksagon ke simpul terdekat."""

    urutan: int
    jarak_m: float
    menit: float
    utama: bool
    profil: str = "foot-walking"
    #: [lon, lat] berurutan, siap dipakai sebagai GeoJSON LineString.
    koordinat: list[list[float]]


class KontribusiBlok(BaseModel):
    """Satu indikator dan berapa besar ia mengangkat (atau menekan) skor blok."""

    kode: str = Field(description="Kunci bobot, mis. menit_jalan_inv")
    nama: str = Field(description="Nama indikatornya dalam bahasa orang")
    #: Sumbangan ke skor MENTAH (0-1 sebelum dinormalkan lagi). Negatif berarti
    #: menekan - sejauh ini hanya risiko banjir.
    nilai: float
    #: Sumbangan sebagai PANGSA dari jumlah seluruh sumbangan positif, 0-1.
    #: Ada supaya batang di layar bisa dibandingkan antar-indikator tanpa
    #: pembacanya perlu tahu bobot mana yang 0,30 dan mana yang 0,10.
    pangsa: float
    #: Seberapa bagus blok ini pada indikator ini, 0-1 atas seluruh blok wilayah
    #: studi (sumbangan dibagi bobotnya). Untuk risiko banjir: seberapa TINGGI
    #: risikonya. Yang dibaca antarmuka - pangsa terlalu abstrak untuk awam.
    kekuatan: float | None = None


class BlokDalamHeksagon(BaseModel):
    """Satu blok (anak H3 res-10) di dalam heksagon yang sedang dilihat."""

    h3_blok: str
    #: 1 = blok terbaik di heksagon ini, menurut kelas usaha yang diminta
    #: (atau skor umum kalau tidak ada kelas).
    peringkat: int
    skor: float | None = None
    skor_umum: float | None = None
    lat: float
    lon: float
    #: Cincin batas blok, [lon, lat], tertutup.
    koordinat: list[list[float]]
    menit_jalan: float | None = Field(default=None, description="Jalan kaki sungguhan ke stasiun (ORS)")
    jarak_jalan_m: float | None = None
    jarak_jalan_utama_m: float | None = None
    nama_jalan_utama: str | None = None
    kelas_jalan_utama: str | None = None
    n_usaha_150m: int = 0
    n_pesaing_150m: int | None = Field(default=None, description="Usaha sekelas dalam 150 m, kalau kelas diminta")
    usaha_per_kelas_150m: dict[str, int] = Field(default_factory=dict)
    n_penarik_250m: int = 0
    penarik_250m: dict[str, int] = Field(default_factory=dict)
    jarak_halte_m: float | None = None
    n_bangunan: int = 0
    rasio_tutupan_bangunan: float | None = None
    izin_komersial: bool | None = Field(default=None, description="None = tidak diketahui, BUKAN dilarang")
    kelas_zona: str | None = None
    pangsa_zona_usaha: float | None = None
    risiko_banjir: float | None = None
    alasan: list[str] = Field(default_factory=list)
    peringatan: list[str] = Field(default_factory=list)
    kontribusi: list[KontribusiBlok] = Field(default_factory=list)


class BedahBlok(BaseModel):
    """Tujuh blok di dalam satu heksagon, siap dibandingkan berdampingan."""

    h3_index: str
    kawasan: str
    kelas: str | None = None
    kelas_tersedia: dict[str, str] = Field(default_factory=dict)
    nama_simpul: str | None = None
    blok: list[BlokDalamHeksagon]
    # Aturan 3: skor apa pun membawa lencana. Skor blok berdiri di atas data
    # terbuka, jadi lencana yang dibawanya lencana HEKSAGON induknya - pengakuan
    # berapa survei lapangan yang menyentuh kawasan kecil ini, apa adanya.
    keyakinan: BadgeKeyakinan
    catatan: str


class KonteksSimpul(BaseModel):
    """Hubungan satu heksagon dengan stasiun terdekatnya, untuk digambar di peta."""

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
    #: Profil yang benar-benar dipakai menyusun `rute` di respons ini.
    profil: str = "foot-walking"
    profil_tersedia: list[str] = Field(default_factory=list)
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
    "bedah_blok",  # tujuh blok di dalam satu heksagon
    # dijalankan frontend (aksi peta, tidak menyentuh basis data)
    "flyTo",
    "highlight",
    "setLayer",
    "filter",
]


class AksiPeta(BaseModel):
    """Instruksi untuk frontend. LLM memintanya, peta yang mengeksekusi."""

    fungsi: NamaFungsi
    argumen: dict[str, Any] = Field(default_factory=dict)


class PesanRiwayat(BaseModel):
    """Satu giliran percakapan sebelumnya."""

    peran: Literal["pengguna", "asisten"]
    teks: str = Field(max_length=4000)


class PermintaanAI(BaseModel):
    pertanyaan: str = Field(min_length=1, max_length=2000)

    riwayat: list[PesanRiwayat] = Field(
        default_factory=list, max_length=20, description="Giliran sebelumnya, terlama dulu"
    )

    hex_terpilih: str | None = Field(default=None, description="Konteks: heksagon yang sedang dibuka")
    layer_aktif: str | None = None
    viewport: dict[str, float] | None = None


class JejakFungsi(BaseModel):
    """Satu langkah yang benar-benar dijalankan backend saat menjawab."""

    fungsi: NamaFungsi
    argumen: dict[str, Any] = Field(default_factory=dict)
    ringkas_hasil: str = Field(description="Ringkasan satu baris, bukan seluruh payload")


class JawabanAI(BaseModel):
    """Jawaban asisten."""

    teks: str
    aksi_peta: list[AksiPeta] = Field(default_factory=list)
    sumber_angka: list[FaktorSkor] = Field(default_factory=list)
    keyakinan: BadgeKeyakinan | None = None
    jejak: list[JejakFungsi] = Field(default_factory=list)
    model: str | None = Field(default=None, description="Model yang menyusun narasi")
    hex_disebut: list[str] = Field(
        default_factory=list, description="Heksagon yang dirujuk jawaban ini"
    )




class PermintaanDaftar(BaseModel):
    nama_pengguna: str = Field(min_length=3, max_length=40)
    email: EmailStr
    sandi: str = Field(min_length=8, max_length=128)
    nama_tampilan: str | None = Field(default=None, max_length=80)

    @field_validator("nama_pengguna")
    @classmethod
    def _bersih(cls, v: str) -> str:
        """Huruf, angka, titik, garis bawah, garis pisah. Tidak lebih."""
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
    """Preferensi yang diisi saat onboarding premium. Seluruhnya opsional."""

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
    dibuat_pada: datetime | None = None
    langganan: RingkasLangganan | None = None
    preferensi: PreferensiUsaha | None = None


class SesiAkun(BaseModel):
    """Balasan daftar dan masuk: tiket + akunnya sekaligus."""

    tiket: str
    akun: Akun


class PermintaanLangganan(BaseModel):
    paket: str = Field(description="Kode paket dari GET /akun/paket")


class ButirPantauan(BaseModel):
    h3_index: str
    kawasan: str | None = None
    lat: float | None = None
    lon: float | None = None
    #: True kalau `lat`/`lon` titik yang ditaruh orangnya, bukan titik tengah.
    titik_sendiri: bool = False
    nama: str | None = None
    catatan: str | None = None
    skor_saat_dipantau: float | None = None
    skor_sekarang: float | None = None
    selisih: float | None = None
    versi_saat_dipantau: str | None = None
    versi_sekarang: str | None = None
    kuadran: str | None = None
    risiko: str | None = None
    dibuat_pada: datetime
    # Rencana pengembangan yang dicatat pemiliknya untuk lokasi ini.
    rencana_jenis_usaha: str | None = None
    rencana_omzet_bulanan: float | None = None
    # Usahanya sendiri: nama yang muncul di pin peta, dan deskripsinya.
    nama_usaha: str | None = None
    deskripsi: str | None = None


class PermintaanPantau(BaseModel):
    h3_index: str = Field(min_length=15, max_length=20)
    catatan: str | None = Field(default=None, max_length=200)
    # Titik di DALAM heksagon. Keduanya atau tidak sama sekali; backend menolak
    # titik yang jatuh di luar heksagonnya.
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    nama: str | None = Field(default=None, max_length=80)


class PermintaanNamaPantau(BaseModel):
    """Ubah satu lokasi tersimpan. Seluruh bidang opsional - yang kosong tidak
    disentuh. Nama kosong mengembalikannya ke kode lokasi; rencana kosong
    menghapus rencananya."""

    nama: str | None = Field(default=None, max_length=80)
    catatan: str | None = Field(default=None, max_length=200)
    rencana_jenis_usaha: str | None = Field(default=None, max_length=40)
    rencana_omzet_bulanan: float | None = Field(default=None, ge=0, le=100_000_000_000)
    # Usaha di lokasi ini. Nama kosong mengembalikan pin ke kode lokasi.
    nama_usaha: str | None = Field(default=None, max_length=80)
    deskripsi: str | None = Field(default=None, max_length=2000)


class PenjualanBulanan(BaseModel):
    """Satu bulan catatan penjualan usaha. Seluruhnya diisi pemiliknya."""

    bulan: str = Field(description="YYYY-MM")
    omzet: float | None = None
    pembeli: int | None = None
    catatan: str | None = None


class PermintaanPenjualan(BaseModel):
    """Tambah atau perbarui catatan penjualan satu bulan (upsert)."""

    bulan: str = Field(pattern=r"^\d{4}-\d{2}$", description="YYYY-MM")
    omzet: float | None = Field(default=None, ge=0, le=100_000_000_000)
    pembeli: int | None = Field(default=None, ge=0, le=10_000_000)
    catatan: str | None = Field(default=None, max_length=200)


class TrenUsaha(BaseModel):
    """Tren dari catatan penjualan yang ada. Kosong tetap kosong, bukan nol."""

    penjualan: list[PenjualanBulanan] = Field(default_factory=list)
    omzet_terakhir: float | None = None
    bulan_terakhir: str | None = None
    #: Perubahan terhadap bulan sebelumnya, persen. None kalau belum ada dua bulan.
    perubahan_persen: float | None = None
    rata_rata: float | None = None
    bulan_terbaik: str | None = None
    omzet_terbaik: float | None = None


class UsahaHeksagon(BaseModel):
    """Usaha yang tercatat pada satu lokasi tersimpan, beserta trennya."""

    h3_index: str
    kawasan: str | None = None
    nama_usaha: str | None = None
    deskripsi: str | None = None
    catatan: str | None = None
    rencana_jenis_usaha: str | None = None
    rencana_omzet_bulanan: float | None = None
    tren: TrenUsaha = Field(default_factory=TrenUsaha)


class TitikRiwayat(BaseModel):
    versi: str
    dihitung_pada: datetime | None = None
    opportunity_score: float | None = None
    hidden_gem_score: float | None = None
    kuadran: str | None = None
    peringkat: int | None = None


class RiwayatSkor(BaseModel):
    """Riwayat skor satu heksagon lintas versi penerbitan."""

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
    puncak_sore: float | None = None
    kepadatan_poi_total: float | None = None
    keragaman_usaha: float | None = None
    indeks_churn: float | None = None
    pop_100m: float | None = None
    harga_sewa_median: float | None = None
    keyakinan: BadgeKeyakinan


class Komparasi(BaseModel):
    """Komparasi berdampingan 2-4 heksagon."""

    baris: list[BarisKomparasi]
    menang: dict[str, str | None] = Field(default_factory=dict)


class AlasanRekomendasi(BaseModel):
    """Satu alasan, dan ANGKA yang mendasarinya."""

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
    jarak_simpul_m: float | None = None
    n_kompetitor_langsung: float | None = None
    indeks_churn: float | None = None
    zoneguard: StatusZoneGuard
    risiko: PeringatanRisiko
    alasan: list[AlasanRekomendasi] = Field(default_factory=list)
    ringkasan: str


class HasilRekomendasi(BaseModel):
    """Balasan /skor/rekomendasi."""

    hasil: list[Rekomendasi] = Field(default_factory=list)
    total_cocok: int = 0
    kriteria: dict[str, Any] = Field(default_factory=dict)
    dipotong: bool = False
    catatan: str


class DinamikaKawasan(BaseModel):
    """Sebaran churn dan aktivitas satu kawasan - fitur Pemantauan."""

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
