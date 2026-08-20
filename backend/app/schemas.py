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


class DetailHeksagon(BaseModel):
    """Respons lengkap saat pengguna mengklik satu heksagon.

    Memuat 41 variabel dalam bentuk agregat + rincian kontribusi skor.
    Tidak memuat satu pun record misi mentah.
    """

    skor: SkorHeksagon
    indeks: IndeksKomposit
    variabel: dict[str, Any] = Field(description="41 variabel analisis, sudah teragregasi")
    faktor: list[FaktorSkor] = Field(default_factory=list)
    commuter_clock: dict[str, float | None] = Field(
        default_factory=dict, description="B01-B04: distribusi transaksi per rentang jam"
    )


class SimpulTransit(BaseModel):
    id: int
    nama: str
    moda: str
    kawasan: str
    lat: float
    lon: float


# --- AI Consultant ---------------------------------------------------------

NamaFungsi = Literal[
    # dijalankan backend (menyentuh basis data)
    "cari_lokasi",
    "bandingkan",
    "jelaskan_skor",
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


class PermintaanAI(BaseModel):
    pertanyaan: str
    hex_terpilih: str | None = Field(default=None, description="Konteks: heksagon yang sedang dibuka")
    layer_aktif: str | None = None
    viewport: dict[str, float] | None = None


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
