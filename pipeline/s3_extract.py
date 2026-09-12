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

import argparse
import base64
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from config import CACHE_AI, DATA_MENTAH, OCR_CONFIDENCE_MIN, PROMPTS, ROOT


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


# --- Pemanggil vision -------------------------------------------------------
#
# Penyedianya Gemini, lewat REST langsung - kunci dan modelnya SAMA dengan yang
# dipakai Konsultan AI di backend (`LLM_API_KEY`, `LLM_MODEL`), dibaca dari
# backend/.env. Satu kunci, satu tempat, dan tidak pernah dicetak.
#
# Kenapa REST mentah dan bukan adapter backend: adapter itu meniru kontrak
# `messages.create()` untuk loop alat, dan gambar tidak lewat kontrak itu.
# Pipeline tidak butuh loop - satu foto, satu jawaban JSON.

URL_GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

#: Dicoba berurutan kalau model sebelumnya 503/429/404 - pola yang sama dengan
#: `llm_gemini.MODEL_CADANGAN`, karena kelebihan beban Gemini terukur per MODEL,
#: bukan per layanan.
MODEL_VISION = ("gemini-3-flash-preview", "gemini-flash-latest", "gemini-flash-lite-latest")

#: Tarif Flash per juta token, USD - sama dengan `llm_gemini.TARIF_*`. Hanya
#: untuk kolom `biaya_usd` di ai_call_logs; tidak menentukan apa pun.
TARIF_MASUK, TARIF_KELUAR = 0.30, 2.50

#: Foto yang lebih besar dari ini tidak dikirim. Batas inline Gemini 20 MB per
#: permintaan; foto struk ponsel lazimnya 1-4 MB.
BATAS_FOTO_BYTE = 15 * 1024 * 1024

#: Kewajaran yang diperiksa SESUDAH skema lolos. Nilai di luarnya tetap
#: disimpan (untuk audit) tetapi ditandai perlu review - tidak dipakai.
WAJAR_STRUK = (1_000, 5_000_000)
WAJAR_SEWA_BULANAN = (500_000, 500_000_000)


def _baca_env_backend() -> dict[str, str]:
    env = ROOT.parent / "backend" / ".env"
    hasil: dict[str, str] = {}
    if env.exists():
        for baris in env.read_text(encoding="utf-8").splitlines():
            baris = baris.strip()
            if baris and not baris.startswith("#") and "=" in baris:
                k, v = baris.split("=", 1)
                hasil[k.strip()] = v.strip().strip('"').strip("'")
    return hasil


def _baca_prompt(nama: str) -> tuple[str, str]:
    """Berkas prompt -> (instruksi sistem, templat pesan pengguna).

    Sistem = bagian "System" + "Aturan"; pengguna = bagian "User". Bagian
    "Validasi" dan "Catatan" dibaca MANUSIA, bukan model - mengirimnya cuma
    menambah token tanpa mengubah jawaban. Karena kodenya membaca berkas ini
    apa adanya, mengubah prompt tidak pernah menuntut mengubah kode (aturan 7).
    """
    teks = (PROMPTS / nama).read_text(encoding="utf-8")
    bagian: dict[str, str] = {}
    judul = None
    isi: list[str] = []
    for baris in teks.splitlines():
        if baris.startswith("## "):
            if judul:
                bagian[judul] = "\n".join(isi).strip()
            judul, isi = baris[3:].strip(), []
        elif baris.strip() == "---" and judul == "User":
            bagian[judul] = "\n".join(isi).strip()
            judul, isi = None, []
        elif judul:
            isi.append(baris)
    if judul:
        bagian[judul] = "\n".join(isi).strip()
    sistem = f"{bagian.get('System', '')}\n\n## Aturan\n\n{bagian.get('Aturan', '')}".strip()
    return sistem, bagian.get("User", "")


class _Bawaan(dict):
    def __missing__(self, kunci: str) -> str:
        return "-"


def _unduh_foto(url: str, percobaan: int = 4) -> tuple[bytes, str]:
    """Unduh satu foto, dengan percobaan ulang.

    Diulang karena terukur 12 Sep 2026: dari satu mesin yang sama, sebagian
    besar unduhan dijawab `WinError 10054` (sambungan diputus paksa) pada
    menit-menit tertentu lalu pulih sendiri. Tanpa ulangan, satu jendela jaringan
    yang buruk menandai ratusan foto "gagal" padahal fotonya baik-baik saja.
    """
    galat: Exception | None = None
    for i in range(percobaan):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Loconomics/1.0 (OCR pipeline)"})
            with urllib.request.urlopen(req, timeout=90) as r:
                data = r.read(BATAS_FOTO_BYTE + 1)
                jenis = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            break
        except urllib.error.HTTPError as e:
            if e.code in (404, 403, 410):
                raise  # foto memang tidak ada; menunggu tidak mengubah apa pun
            galat = e
        except OSError as e:
            galat = e
        time.sleep((3, 10, 30, 60)[i])
    else:
        raise galat or OSError("unduhan gagal")
    if len(data) > BATAS_FOTO_BYTE:
        raise ValueError("foto terlalu besar")
    if not jenis.startswith("image/"):
        jenis = "image/png" if url.lower().endswith(".png") else "image/jpeg"
    return data, jenis


def _json_dari_teks(teks: str) -> dict:
    """Model kadang tetap membungkus JSON dengan pagar kode walau diminta tidak."""
    t = teks.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t, flags=re.S)
    return json.loads(t)


def _panggil_vision(kunci: str, model_utama: str, sistem: str, pesan: str,
                    foto: bytes, jenis: str) -> tuple[str, str, int, int]:
    """Satu permintaan vision. -> (teks, model yang menjawab, token masuk, token keluar)."""
    badan = {
        "system_instruction": {"parts": [{"text": sistem}]},
        "contents": [{
            "role": "user",
            "parts": [
                {"text": pesan},
                {"inline_data": {"mime_type": jenis, "data": base64.b64encode(foto).decode()}},
            ],
        }],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
    }
    galat = ""
    for model in dict.fromkeys([model_utama, *MODEL_VISION]):
        for percobaan in range(3):
            req = urllib.request.Request(
                URL_GEMINI.format(model=model),
                data=json.dumps(badan).encode(),
                headers={"Content-Type": "application/json", "x-goog-api-key": kunci},
            )
            try:
                with urllib.request.urlopen(req, timeout=180) as r:
                    d = json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                galat = f"HTTP {e.code}"
                if e.code in (429, 500, 503):
                    time.sleep((5, 20, 45)[percobaan])
                    continue
                if e.code == 404:
                    break  # model ini tidak ada; coba model berikutnya
                raise RuntimeError(galat) from None
            except (OSError, json.JSONDecodeError) as e:
                galat = type(e).__name__
                time.sleep((5, 20, 45)[percobaan])
                continue
            bagian = ((d.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
            teks = "".join(p.get("text", "") for p in bagian if not p.get("thought"))
            u = d.get("usageMetadata") or {}
            return teks, model, int(u.get("promptTokenCount") or 0), int(u.get("candidatesTokenCount") or 0)
    raise RuntimeError(f"seluruh model vision gagal ({galat})")


def _ekstrak(fitur_kode: str, prompt: str, skema: type[BaseModel], foto_url: str,
             konteks: dict, kunci: str, model: str) -> dict:
    """Satu foto -> hasil tervalidasi, SELALU lewat cache lebih dulu.

    Cache berkunci SHA-1 URL foto. Foto yang sudah pernah dibaca tidak pernah
    dikirim lagi - membayar dua kali untuk jawaban yang sama, dan
    mempertaruhkan demo pada koneksi, sama-sama dilarang docs/ai.md.
    """
    sidik = hashlib.sha1(foto_url.encode()).hexdigest()
    berkas = CACHE_AI / fitur_kode.lower() / f"{sidik}.json"
    if berkas.exists():
        return json.loads(berkas.read_text(encoding="utf-8"))

    sistem, templat = _baca_prompt(prompt)
    pesan = templat.format_map(_Bawaan({**konteks, "foto_url": "(terlampir)"}))
    foto, jenis = _unduh_foto(foto_url)

    masuk = keluar = 0
    dipakai = model
    catatan = pesan
    hasil = None
    alasan = None
    # JSON tidak sah -> ulang maksimal 2 kali dengan pesan kesalahannya
    # dikembalikan ke model (docs/ai.md aturan lapisan A nomor 2).
    for _ in range(3):
        teks, dipakai, m_in, m_out = _panggil_vision(kunci, model, sistem, catatan, foto, jenis)
        masuk += m_in
        keluar += m_out
        try:
            hasil = skema.model_validate(_json_dari_teks(teks)).model_dump()
            break
        except (json.JSONDecodeError, ValidationError) as e:
            alasan = str(e)[:300]
            catatan = (
                f"{pesan}\n\nJawaban sebelumnya tidak sesuai skema: {alasan}\n"
                "Kembalikan JSON yang sah sesuai skema, tanpa teks lain."
            )

    rekam = {
        "fitur": fitur_kode,
        "foto_url": foto_url,
        "sidik": sidik,
        "model": dipakai,
        "hasil": hasil,
        "gagal_skema": None if hasil else alasan,
        "token_masuk": masuk,
        "token_keluar": keluar,
        "biaya_usd": round(masuk / 1e6 * TARIF_MASUK + keluar / 1e6 * TARIF_KELUAR, 6),
        "waktu": datetime.now(timezone.utc).isoformat(),
    }
    berkas.parent.mkdir(parents=True, exist_ok=True)
    berkas.write_text(json.dumps(rekam, ensure_ascii=False), encoding="utf-8")
    return rekam


def ekstrak_spanduk(foto_url: str, konteks: dict, kunci: str = "", model: str = "") -> dict:
    """A1. Prompt: prompts/a1_spanduk.md

    Validasi: (1) skema Pydantic, (2) confidence >= 0.7, (3) uji akurasi pada
    50 foto berlabel tangan dengan target MAPE < 15%, (4) pemeriksaan kewajaran
    rentang - sewa ruko < Rp1 juta atau > Rp500 juta per bulan ditandai anomali.
    """
    return _ekstrak("A1", "a1_spanduk.md", HasilSpanduk, foto_url, konteks, kunci, model)


def ekstrak_struk(foto_url: str, konteks: dict, kunci: str = "", model: str = "") -> dict:
    """A2. Prompt: prompts/a2_struk.md

    Validasi yang layak disebut khusus saat presentasi: struk memuat tanggal,
    waktu, dan nama merchant yang JUGA diisi manual oleh surveyor di kolom
    terpisah. Artinya ada mekanisme pengecekan otomatis tanpa pelabelan manual
    sama sekali - kemewahan yang jarang dimiliki dataset lain.
    """
    return _ekstrak("A2", "a2_struk.md", HasilStruk, foto_url, konteks, kunci, model)


def perlu_review(rekam: dict) -> bool:
    """Satu tempat yang memutuskan apakah sebuah hasil BOLEH dipakai.

    Tidak dipakai (tetap disimpan untuk audit) kalau: skemanya tidak pernah
    lolos, keyakinannya di bawah ambang, atau angkanya di luar rentang wajar.
    """
    h = rekam.get("hasil")
    if not h:
        return True
    if perlu_review_manusia(float(h.get("confidence") or 0)):
        return True
    if rekam.get("fitur") == "A2":
        n = h.get("total_nominal")
        return n is None or not (WAJAR_STRUK[0] <= n <= WAJAR_STRUK[1])
    if rekam.get("fitur") == "A1":
        n = h.get("harga_nominal")
        if n is None or h.get("periode") == "tidak_disebut":
            return True
        bulanan = n / 12 if h.get("periode") == "tahun" else n
        return not (WAJAR_SEWA_BULANAN[0] <= bulanan <= WAJAR_SEWA_BULANAN[1])
    return True


def jalankan(fitur_kode: str, batas: int | None = None, pekerja: int = 3) -> Path:
    """Baca seluruh foto satu jenis misi se-Jabodetabek, lalu simpan ringkasannya.

    SE-JABODETABEK, bukan hanya yang jatuh di 708 heksagon: yang di dalam grid
    cuma 18 struk dan 2 properti, terlalu tipis untuk apa pun. Yang di luar
    grid tetap berguna sebagai bahan PERKIRAAN tingkat kawasan - pola jam
    transaksi dan kisaran sewa di sekitar simpul transit - dan tidak pernah
    masuk skor (lihat s7_publish.muat_perkiraan).
    """
    env = _baca_env_backend()
    kunci = env.get("LLM_API_KEY", "")
    if not kunci or env.get("LLM_PROVIDER", "").lower() != "gemini":
        raise SystemExit("LLM_API_KEY/LLM_PROVIDER=gemini belum diisi di backend/.env.")
    model = env.get("LLM_MODEL") or MODEL_VISION[0]

    misi = json.loads((DATA_MENTAH / "mapid_misi.json").read_text(encoding="utf-8"))
    tugas: list[tuple[str, dict, dict]] = []
    if fitur_kode == "A2":
        for f in misi.get("struckgo", []):
            p = f.get("properties") or {}
            url = (p.get("foto_struk") or "").strip()
            if url:
                tugas.append((url, {"nama_usaha": p.get("nama_tempat"),
                                    "kategori": p.get("kategori_tempat"),
                                    "waktu_survei": "-"}, f))
        pekerjaan = ekstrak_struk
    elif fitur_kode == "A1":
        for f in misi.get("propertigo", []):
            p = f.get("properties") or {}
            url = (p.get("foto_spanduk") or "").strip()
            # Hanya yang DISEWAKAN. Harga jual tidak menjawab "berapa sewa", dan
            # membacanya cuma membayar token untuk angka yang tidak dipakai.
            if url and "sewa" in str(p.get("jenis_properti") or "").lower():
                tugas.append((url, {"kategori": p.get("kategori_properti"),
                                    "jenis": p.get("jenis_properti"),
                                    "alamat": p.get("alamat")}, f))
        pekerjaan = ekstrak_spanduk
    else:
        raise SystemExit(f"Fitur {fitur_kode} belum didukung.")

    if batas:
        tugas = tugas[:batas]
    print(f"  {fitur_kode}: {len(tugas)} foto, model {model}, {pekerja} pekerja")

    ringkas: list[dict] = []
    gagal = 0
    with ThreadPoolExecutor(max_workers=pekerja) as eksekutor:
        berjalan = {
            eksekutor.submit(pekerjaan, url, konteks, kunci, model): (url, f)
            for url, konteks, f in tugas
        }
        for i, selesai in enumerate(as_completed(berjalan), 1):
            url, f = berjalan[selesai]
            try:
                rekam = selesai.result()
            except Exception as e:  # noqa: BLE001 - satu foto tidak boleh menghentikan sisanya
                gagal += 1
                print(f"    gagal: {type(e).__name__}: {str(e)[:120]}")
                continue
            k = (f.get("geometry") or {}).get("coordinates") or [None, None]
            ringkas.append({
                "sidik": rekam["sidik"], "foto_url": url, "lon": k[0], "lat": k[1],
                "kategori": (f.get("properties") or {}).get("kategori_tempat")
                or (f.get("properties") or {}).get("kategori_properti"),
                "hasil": rekam["hasil"], "perlu_review": perlu_review(rekam),
                "model": rekam["model"], "biaya_usd": rekam["biaya_usd"],
            })
            if i % 25 == 0 or i == len(tugas):
                dipakai = sum(1 for r in ringkas if not r["perlu_review"])
                print(f"    {i}/{len(tugas)}  dipakai {dipakai}  review {len(ringkas) - dipakai}  gagal {gagal}")

    tujuan = ROOT / "data" / "03_olahan" / f"ocr_{fitur_kode.lower()}.json"
    tujuan.parent.mkdir(parents=True, exist_ok=True)
    tujuan.write_text(json.dumps(ringkas, ensure_ascii=False), encoding="utf-8")
    biaya = sum(r["biaya_usd"] or 0 for r in ringkas)
    print(f"\n  {len(ringkas)} hasil -> {tujuan.name}  (perkiraan biaya ${biaya:.3f})")
    return tujuan


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
    ap = argparse.ArgumentParser(description="AI Lapisan 1 - foto misi MAPID menjadi angka")
    ap.add_argument("--struk", action="store_true", help="A2: nominal + jam dari foto struk")
    ap.add_argument("--spanduk", action="store_true", help="A1: harga sewa dari foto spanduk")
    ap.add_argument("--batas", type=int, help="coba sedikit dulu")
    ap.add_argument("--pekerja", type=int, default=3)
    a = ap.parse_args()
    CACHE_AI.mkdir(parents=True, exist_ok=True)
    if not (a.struk or a.spanduk):
        print(f"Prompt   : {PROMPTS}")
        print(f"Cache    : {CACHE_AI}")
        print(f"Ambang   : confidence >= {OCR_CONFIDENCE_MIN}")
        sys.exit(0)
    if a.spanduk:
        jalankan("A1", a.batas, a.pekerja)
    if a.struk:
        jalankan("A2", a.batas, a.pekerja)
