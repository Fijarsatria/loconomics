"""Bentuk respons API.

Dua aturan yang ditegakkan di lapisan ini:

1. Tidak ada skema yang membawa data misi MAPID mentah. Yang keluar dari API
   hanya hasil agregat per heksagon. (Ketentuan lomba B.7 - melanggar ini
   berisiko diskualifikasi.)
2. Setiap skema yang membawa skor WAJIB membawa `keyakinan`. Skema dibuat
   sedemikian rupa sehingga tidak mungkin mengirim skor tanpa badge-nya.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field

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

TingkatRisiko = Literal["AMAN", "WASPADA", "BAHAYA"]


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


# --- Detail heksagon -------------------------------------------------------


class DetailHeksagon(BaseModel):
    """Respons lengkap saat pengguna mengklik satu heksagon.

    Memuat 43 variabel dalam bentuk agregat + rincian kontribusi skor.
    Tidak memuat satu pun record misi mentah.
    """

    skor: SkorHeksagon
    indeks: IndeksKomposit
    variabel: dict[str, Any] = Field(description="43 variabel analisis, sudah teragregasi")
    faktor: list[FaktorSkor] = Field(default_factory=list)
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
