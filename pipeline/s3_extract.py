"""Tahap 3 - AI Lapisan 1: mengubah foto menjadi angka.

Inilah lapisan yang paling bisa dipertahankan saat ditanya juri "kenapa pakai AI?",
karena keberadaannya bukan pilihan melainkan keharusan:

  Properti Go  punya 8 kolom, TIDAK SATU PUN berisi harga
  Struk Go     punya 8 kolom, TIDAK SATU PUN berisi nominal transaksi
  Menu Go      satu-satunya yang punya angka rupiah native

Tanpa lapisan ini, proyek ini secara harfiah tidak punya satu pun angka rupiah
untuk dianalisis.

Empat fitur (docs/ai.md):
  A1  Ekstraktor harga sewa dari foto spanduk   WAJIB, prioritas tertinggi -> P05
  A2  Ekstraktor nominal dari foto struk        WAJIB                      -> B09
  A3  Penilai prestise visual                   KUAT                       -> M03
  A4  Klasifikator menu dan taksonomi kuliner   SEDANG               -> C04, B08

Aturan yang berlaku untuk keempatnya:
  - Prompt disimpan sebagai berkas di prompts/, bukan ditempel di kode. Berkas itu
    sekaligus bukti untuk ketentuan C.1 tentang penjelasan proses AI.
  - Keluaran WAJIB JSON terstruktur yang divalidasi Pydantic, bukan prosa bebas.
    JSON tidak valid -> ulang maksimal 2x dengan pesan kesalahan dikembalikan ke model.
  - confidence < 0.7 -> masuk antrean verifikasi manusia, TIDAK dipakai langsung.
  - Seluruh hasil di-cache ke CACHE_AI. JANGAN PERNAH memanggil ulang API saat demo.
  - Setiap panggilan dicatat ke tabel ai_call_logs (input, output, confidence, biaya).
"""

from typing import Literal

from pydantic import BaseModel, Field

from config import CACHE_AI, OCR_CONFIDENCE_MIN, PROMPTS


# --- Skema keluaran. Model WAJIB mengembalikan bentuk ini. ------------------


class HasilSpanduk(BaseModel):
    """A1 - keluaran dari satu foto spanduk sewa."""

    harga_nominal: int | None = None
    mata_uang: str = "IDR"
    periode: Literal["bulan", "tahun", "tidak_disebut"] = "tidak_disebut"
    luas_m2: float | None = None
    ada_kontak: bool = False
    teks_terbaca: str = ""
    confidence: float = Field(ge=0, le=1)


class HasilStruk(BaseModel):
    """A2 - keluaran dari satu foto struk."""

    total_nominal: int | None = None
    jumlah_item: int | None = None
    daftar_item: list[dict] = Field(default_factory=list)
    nama_merchant_terbaca: str | None = None
    tanggal_terbaca: str | None = None  # YYYY-MM-DD
    waktu_terbaca: str | None = None  # HH:MM, 24 jam. Satu-satunya sumber B01-B04.
    metode_bayar: Literal[
        "tunai", "qris", "debit", "kartu_kredit", "ewallet", "tidak_disebut"
    ] = "tidak_disebut"
    confidence: float = Field(ge=0, le=1)

    @property
    def digital(self) -> bool:
        """Basis B06 pangsa_digital. 'tidak_disebut' TIDAK dihitung sebagai tunai."""
        return self.metode_bayar in {"qris", "debit", "kartu_kredit", "ewallet"}


class HasilPrestise(BaseModel):
    """A3 - rubrik tetap 5 aspek, masing-masing skala 1-5."""

    kualitas_fasad: int = Field(ge=1, le=5)
    kondisi_jalan: int = Field(ge=1, le=5)
    kerapian_lingkungan: int = Field(ge=1, le=5)
    kelas_kawasan: int = Field(ge=1, le=5)
    brand_terlihat: int = Field(ge=1, le=5)
    alasan: str = ""  # ditampilkan ke pengguna dan diperiksa juri - wajib menyebut ciri fisik
    confidence: float = Field(ge=0, le=1)

    @property
    def skor(self) -> float:
        return (
            self.kualitas_fasad
            + self.kondisi_jalan
            + self.kerapian_lingkungan
            + self.kelas_kawasan
            + self.brand_terlihat
        ) / 5


KELAS_KULINER = [
    "Nasi dan Lauk", "Mie dan Bakso", "Ayam Goreng atau Geprek",
    "Kopi dan Minuman", "Jajanan atau Gorengan", "Masakan Padang",
    "Chinese dan Seafood", "Roti dan Kue", "Lainnya",
]


class ItemMenu(BaseModel):
    nama: str
    harga: int
    satuan: Literal["porsi", "gelas", "botol", "paket", "kg", "lainnya"] = "porsi"


class HasilMenu(BaseModel):
    """A4 - keluaran dari satu foto daftar menu.

    Dua pekerjaan sekaligus: harga (B07, B08) dan kelas kuliner (C04).
    """

    item: list[ItemMenu] = Field(default_factory=list)
    kelas_kuliner: str = "Lainnya"  # harus salah satu dari KELAS_KULINER
    sudah_termasuk_pajak: bool | None = None
    confidence: float = Field(ge=0, le=1)

    @property
    def harga_porsi(self) -> list[int]:
        """Hanya satuan 'porsi' yang masuk B07 - supaya antarlokasi bisa dibandingkan."""
        return [i.harga for i in self.item if i.satuan == "porsi"]


# --- Aturan yang berlaku lintas fitur --------------------------------------


def perlu_review_manusia(confidence: float) -> bool:
    return confidence < OCR_CONFIDENCE_MIN


def periode_sewa_aman(hasil: HasilSpanduk) -> bool:
    """Jebakan periode sewa - kesalahan dua belas kali lipat.

    "45jt" bisa berarti per bulan atau per tahun. Salah asumsi menggeser seluruh
    peta biaya di satu kawasan, dan itu tipe kesalahan yang langsung terlihat
    kalau juri membandingkannya dengan NJOP.

    Aturan tim: JANGAN PERNAH MENEBAK. Record dengan periode tidak jelas
    dikeluarkan dari perhitungan harga sewa median (P05).
    """
    return hasil.periode != "tidak_disebut"


def ekstrak_spanduk(foto_url: str, konteks: dict) -> HasilSpanduk:
    """A1. Prompt: prompts/a1_spanduk.md

    Validasi: (1) skema Pydantic, (2) confidence >= 0.7, (3) uji akurasi pada
    50 foto berlabel tangan dengan target MAPE < 15%, (4) pemeriksaan kewajaran
    rentang - sewa ruko < Rp1 juta atau > Rp500 juta per bulan ditandai anomali.
    """
    raise NotImplementedError("Menunggu keputusan engine OCR / provider vision")


def ekstrak_struk(foto_url: str, konteks: dict) -> HasilStruk:
    """A2. Prompt: prompts/a2_struk.md

    Validasi yang layak disebut khusus saat presentasi: struk memuat tanggal,
    waktu, dan nama merchant yang JUGA diisi manual oleh surveyor di kolom
    terpisah. Artinya ada mekanisme pengecekan otomatis tanpa pelabelan manual
    sama sekali - kemewahan yang jarang dimiliki dataset lain.
    """
    raise NotImplementedError


def nilai_prestise(foto_url: str) -> HasilPrestise:
    """A3. Prompt: prompts/a3_prestise.md

    Validasi: Cohen kappa AI vs 3 penilai manusia pada 30 foto, target > 0.6.
    Lalu korelasi silang terhadap persentil NJOP - seharusnya positif r 0.5-0.7.
    Titik yang MENYIMPANG dari garis korelasi itu justru kandidat hidden gem.
    """
    raise NotImplementedError


def ekstrak_menu(foto_url: str, konteks: dict) -> HasilMenu:
    """A4. Prompt: prompts/a4_menu.md

    Kalau kategori "Lainnya" melebihi 20%, itu tanda taksonomi perlu diperbaiki,
    bukan tanda modelnya buruk.
    """
    raise NotImplementedError


if __name__ == "__main__":
    CACHE_AI.mkdir(parents=True, exist_ok=True)
    print(f"Prompt   : {PROMPTS}")
    print(f"Cache    : {CACHE_AI}")
    print(f"Ambang   : confidence >= {OCR_CONFIDENCE_MIN}")
