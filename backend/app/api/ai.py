"""AI Consultant - lapisan AI yang hadir di dalam antarmuka WebGIS.

ATURAN KERAS (docs/ai.md): LLM tidak pernah menghitung angka.
Ia hanya boleh memanggil alat di berkas ini, menerima angka dari basis data, lalu
merangkainya menjadi kalimat. Satu halusinasi angka saat demo cukup untuk
menghancurkan kredibilitas seluruh proyek.

Penegakannya tiga lapis, bukan sekadar imbauan di prompt:

  1. Model tidak punya jalan lain untuk mendapat angka. Prompt sistem tidak
     memuat satu pun data; semuanya harus lewat alat.
  2. Setiap hasil alat dicatat ke `jejak`, dan angka skor yang dikutip ikut ke
     `sumber_angka`. Jawaban yang menyebut angka tanpa jejak langsung terlihat.
  3. Nama alat divalidasi terhadap REGISTRI. Nama di luar itu ditolak, tidak
     pernah dipanggil secara dinamis.

Dua belas alat, terbagi dua kelompok yang jalannya berbeda:

  Dieksekusi BACKEND (menyentuh basis data, mengembalikan angka)
    cari_lokasi, bandingkan, jelaskan_skor,
    cek_harga, pola_jam, cek_zona, cari_hidden_gem, cek_risiko

  Dieksekusi FRONTEND (aksi peta, tidak menyentuh basis data)
    flyTo, highlight, setLayer, filter
    -> backend tidak menjalankannya, hanya meneruskan ke field `aksi_peta`

Pembagian ini penting: kalau flyTo dieksekusi di backend, tidak ada yang bergerak
di layar pengguna. Ketentuan C.2 meminta keluaran AI yang benar-benar mendarat di
peta, bukan sekadar teks.
"""

from __future__ import annotations

import inspect
import json
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api import pricelens, skor as modul_skor
from app.api.bersama import ambil_hex, periksa_kawasan, zoneguard
from app.api.hex import commuter_clock, detail_heksagon
from app.core.akun import PenggunaOpsional, wajib_akses_penuh
from app.core.batas import periksa_anggaran, periksa_laju
from app.core.config import settings
from app.core.database import get_db
from app.core.galat import KesalahanAPI, LayananBelumSiap
from app.core.llm import (
    MAKS_PUTARAN,
    MAKS_TOKEN,
    LLMBelumSiap,
    biaya_usd,
    klien,
    model_aktif,
    tersedia,
)
from app.models import AICallLog, HexFeature
from app.schemas import (
    AksiPeta,
    FaktorSkor,
    JawabanAI,
    JejakFungsi,
    PermintaanAI,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["ai"])


# ---------------------------------------------------------------------------
# Implementasi alat backend - satu-satunya sumber angka untuk LLM
# ---------------------------------------------------------------------------


def cari_lokasi(
    db: Session,
    jenis_usaha: str | None = None,
    budget_sewa_bulanan: float | None = None,
    maks_menit_jalan: float | None = None,
    kawasan: str | None = None,
    limit: int = 5,
    versi: str = "baseline",
) -> dict[str, Any]:
    """Kriteria pengguna -> daftar heksagon. Seluruh penyaringan dilakukan SQL."""
    from sqlalchemy import select

    from app.api.bersama import gabung_skor, saring_zoneguard, skor_heksagon
    from app.models import LocationScore

    kawasan = periksa_kawasan(kawasan)
    stmt = (
        saring_zoneguard(gabung_skor(versi))
        .order_by(LocationScore.opportunity_score.desc().nullslast())
        .limit(min(limit, 20))
    )
    if kawasan:
        stmt = stmt.where(HexFeature.kawasan == kawasan)
    if budget_sewa_bulanan is not None:
        stmt = stmt.where(HexFeature.harga_sewa_median <= budget_sewa_bulanan)
    if maks_menit_jalan is not None:
        stmt = stmt.where(HexFeature.waktu_jalan_menit <= maks_menit_jalan)

    baris = db.execute(stmt).all()
    hasil = [skor_heksagon(hx, sc).model_dump() for hx, sc in baris]

    # `jenis_usaha` belum dipakai menyaring: kompetitor per kelas induk baru bisa
    # dibedakan setelah data POI terklasifikasi masuk. Dikembalikan apa adanya
    # supaya model tahu kriteria itu BELUM diterapkan dan tidak mengklaim sudah.
    catatan = None
    if jenis_usaha:
        catatan = (
            f"Filter jenis usaha '{jenis_usaha}' belum diterapkan - klasifikasi "
            f"kompetitor per kelas induk menunggu data POI. Hasil di bawah belum "
            f"disaring menurut jenis usaha."
        )

    return {"hasil": hasil, "jumlah": len(hasil), "catatan": catatan}


def bandingkan(
    db: Session, hex_a: str, hex_b: str, versi: str = "baseline", pengguna=None
) -> dict[str, Any]:
    """Dua heksagon berdampingan, sudah termasuk zonasi dan peringatan risikonya."""
    # `versi` WAJIB kata-kunci. Pernah dikirim posisional dan mendarat di
    # parameter `pengguna` yang baru disisipkan - string "baseline" lalu
    # diperlakukan sebagai objek User dan setiap panggilan alat ini meledak 500.
    a = detail_heksagon(hex_a, db, pengguna=pengguna, versi=versi)
    b = detail_heksagon(hex_b, db, pengguna=pengguna, versi=versi)
    hasil: dict[str, Any] = {
        "a": _ringkas_detail(a),
        "b": _ringkas_detail(b),
        "selisih_skor": (
            round(a.skor.opportunity_score - b.skor.opportunity_score, 1)
            if a.skor.opportunity_score is not None and b.skor.opportunity_score is not None
            else None
        ),
    }
    if a.terkunci or b.terkunci:
        # Tanpa baris ini model membaca blok `harga` yang seluruhnya null dan
        # menyimpulkan datanya memang tidak ada - padahal ada, cuma ditahan.
        # Mengatakan "belum ada data harga" kepada orang yang bisa membukanya
        # dengan satu token adalah pernyataan yang salah, bukan sekadar kurang.
        hasil["catatan"] = (
            "Blok 'harga' pada kedua lokasi ditahan karena pemanggilnya belum "
            "berlangganan. Nilai null di sana berarti BELUM DIBUKA, bukan tidak "
            "ada datanya. Jangan katakan datanya kosong - sarankan berlangganan "
            "atau membuka lokasi itu dengan token."
        )
    return hasil


def jelaskan_skor(
    db: Session, hex_id: str, versi: str = "baseline", pengguna=None
) -> dict[str, Any]:
    """Rincian kontribusi tiap variabel. Bahan mentah narasi "kenapa skornya segitu"."""
    d = detail_heksagon(hex_id, db, pengguna=pengguna, versi=versi)
    ringkas = _ringkas_detail(d)
    ringkas["faktor_teratas"] = [f.model_dump() for f in d.faktor[:8]]
    if d.terkunci:
        # Pemanggilnya belum premium, jadi detail_heksagon menahan faktornya -
        # dan model harus TAHU itu, bukan mengira lokasi ini tidak punya faktor.
        ringkas["catatan"] = (
            "Rincian kontribusi variabel ditahan: pembongkaran skor bagian dari "
            "Loconomics Premium. Sarankan pengguna berlangganan untuk analisis penuh."
        )
    return ringkas


def cek_harga(db: Session, hex_id: str, pengguna=None) -> dict[str, Any]:
    """PriceLens satu heksagon: sewa per m², belanja per jam, dan rentang wajarnya."""
    # Penjaga yang sama dengan endpoint-nya. Alat AI bukan pintu belakang:
    # kalau kartu harganya berbayar lewat HTTP, ia berbayar lewat sini juga.
    wajib_akses_penuh(db, pengguna, hex_id, "Kartu harga PriceLens")
    return pricelens.kartu_harga(db, ambil_hex(db, hex_id)).model_dump()


def pola_jam(db: Session, hex_id: str, pengguna=None) -> dict[str, Any]:
    """Commuter Clock satu heksagon, termasuk pembagian captive dan choice rider."""
    ck = commuter_clock(hex_id, db, pengguna=pengguna)
    # Delapan belas baris penuh terlalu boros untuk konteks model. Yang dikirim
    # hanya jam yang benar-benar berisi, plus ringkasannya.
    return {
        "h3_index": ck.h3_index,
        "jam_puncak": ck.jam_puncak,
        "pangsa_captive_harian": ck.pangsa_captive_harian,
        "dominasi": ck.dominasi,
        "jam_berisi": [
            {
                "jam": t.jam,
                "n_transaksi": t.n_transaksi,
                "nominal_median": t.nominal_median,
                "pangsa_captive": t.pangsa_captive,
            }
            for t in ck.jam
            if t.n_transaksi > 0
        ],
        "keyakinan": ck.keyakinan.model_dump(),
        "catatan": ck.catatan,
    }


def cek_zona(db: Session, hex_id: str) -> dict[str, Any]:
    """ZoneGuard satu heksagon. Jawaban paling penting yang bisa diberikan asisten ini."""
    return zoneguard(ambil_hex(db, hex_id)).model_dump()


def cari_hidden_gem(
    db: Session, kawasan: str | None = None, limit: int = 10, versi: str = "baseline"
) -> dict[str, Any]:
    """GemFinder beserta rangkuman alasan tiap heksagon terpilih."""
    kawasan = periksa_kawasan(kawasan)
    gems = modul_skor.hidden_gems(db=db, kawasan=kawasan, limit=max(10, min(limit, 20)), versi=versi)
    return {
        "jumlah": len(gems),
        "hasil": [
            {
                "h3_index": g.skor.h3_index,
                "kawasan": g.skor.kawasan,
                "hidden_gem_score": g.skor.hidden_gem_score,
                "opportunity_score": g.skor.opportunity_score,
                "n_metode_lolos": g.n_metode_lolos,
                "ringkasan": g.ringkasan,
                "keyakinan": g.skor.keyakinan.model_dump(),
            }
            for g in gems
        ],
    }


def cek_risiko(
    db: Session, kawasan: str | None = None, limit: int = 10, versi: str = "baseline"
) -> dict[str, Any]:
    """RiskRadar: lokasi kuadran Jebakan Gengsi yang churn-nya melewati ambang wajar."""
    kawasan = periksa_kawasan(kawasan)
    titik = modul_skor.risk_radar(
        db=db, kawasan=kawasan, hanya_berperingatan=True, limit=min(limit, 50), versi=versi
    )
    return {
        "jumlah": len(titik),
        "hasil": [t.model_dump() for t in titik],
    }


def _ringkas_detail(d) -> dict[str, Any]:
    """Bentuk ringkas DetailHeksagon untuk konteks model.

    43 variabel mentah tidak dikirim seluruhnya: sebagian besar tidak relevan
    dengan pertanyaan yang sedang dijawab, dan mengirim semuanya hanya membuat
    model kehilangan fokus sekaligus menaikkan biaya.
    """
    return {
        "h3_index": d.skor.h3_index,
        "kawasan": d.skor.kawasan,
        "opportunity_score": d.skor.opportunity_score,
        "hidden_gem_score": d.skor.hidden_gem_score,
        "kuadran": d.skor.kuadran,
        "kuadran_penjelasan": d.kuadran_penjelasan,
        "peringkat": d.skor.peringkat,
        "indeks": d.indeks.model_dump(),
        "zoneguard": d.zoneguard.model_dump(),
        "risiko": d.risiko.model_dump(),
        "keyakinan": d.skor.keyakinan.model_dump(),
        "harga": {
            "harga_sewa_median": d.variabel.get("harga_sewa_median"),
            "harga_sewa_per_m2": d.variabel.get("harga_sewa_per_m2"),
            "belanja_per_jam": d.variabel.get("belanja_per_jam"),
            "harga_median_porsi": d.variabel.get("harga_median_porsi"),
            "njop_m2": d.variabel.get("njop_m2"),
        },
    }


REGISTRI = {
    "cari_lokasi": cari_lokasi,
    "bandingkan": bandingkan,
    "jelaskan_skor": jelaskan_skor,
    "cek_harga": cek_harga,
    "pola_jam": pola_jam,
    "cek_zona": cek_zona,
    "cari_hidden_gem": cari_hidden_gem,
    "cek_risiko": cek_risiko,
}

NAMA_FRONTEND = {"flyTo", "highlight", "setLayer", "filter"}


def panggil_fungsi(
    db: Session, nama: str, argumen: dict[str, Any], pengguna=None
) -> Any:
    """Titik masuk tunggal untuk seluruh function call dari LLM.

    Validasi di sini bukan formalitas: argumen datang dari keluaran model bahasa,
    jadi tidak boleh dipercaya mentah-mentah. Nama fungsi di luar registri ditolak,
    bukan dijalankan secara dinamis.

    Argumen bernilai None dibuang lebih dulu. Mode strict mewajibkan setiap
    parameter hadir, jadi model mengirim `null` untuk yang tidak dipakai -
    meneruskannya apa adanya akan menimpa nilai bawaan fungsi dengan None.
    """
    fungsi = REGISTRI.get(nama)
    if fungsi is None:
        raise KesalahanAPI(
            f"Fungsi '{nama}' tidak tersedia.", {"tersedia": sorted(REGISTRI)}
        )
    bersih = {k: v for k, v in argumen.items() if v is not None}
    # `pengguna` TIDAK pernah datang dari model - model tidak tahu siapa yang
    # bertanya dan tidak boleh bisa berpura-pura jadi siapa pun. Ia disuntik
    # dari endpoint /ai/tanya, hanya ke alat yang memang menerimanya.
    bersih.pop("pengguna", None)
    if "pengguna" in inspect.signature(fungsi).parameters:
        bersih["pengguna"] = pengguna
    return fungsi(db, **bersih)


# ---------------------------------------------------------------------------
# Definisi alat untuk LLM
# ---------------------------------------------------------------------------
# Mode strict dipakai supaya `input` yang diterima dijamin sesuai skema. Syaratnya
# `additionalProperties: false` dan seluruh properti masuk `required`; parameter
# opsional dinyatakan lewat tipe yang boleh null, bukan dengan mengeluarkannya
# dari required.


def _p(tipe: str, deskripsi: str, opsional: bool = False) -> dict[str, Any]:
    return {"type": [tipe, "null"] if opsional else tipe, "description": deskripsi}


def _alat(nama: str, deskripsi: str, properti: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": nama,
        "description": deskripsi,
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": properti,
            "required": list(properti),
            "additionalProperties": False,
        },
    }


H3 = _p("string", "Kode heksagon H3 resolusi 9, mis. 89650e0a6cbffff")
KAWASAN = _p(
    "string",
    "Salah satu dari: Manggarai, Tanah Abang, Depok Baru, Bekasi, Dukuh Atas BNI, Harjamukti",
    opsional=True,
)

ALAT_BACKEND: list[dict[str, Any]] = [
    _alat(
        "cari_lokasi",
        "Cari heksagon yang cocok dengan kriteria usaha pengguna. Sudah menyaring "
        "ZoneGuard, jadi lokasi yang zonanya melarang usaha tidak akan muncul.",
        {
            "jenis_usaha": _p("string", "Kelas induk: F1|F2|R1|R2|S1|S2|K1|T1", opsional=True),
            "budget_sewa_bulanan": _p("number", "Batas atas sewa dalam rupiah per bulan", opsional=True),
            "maks_menit_jalan": _p("number", "Batas waktu jalan kaki dari simpul transit", opsional=True),
            "kawasan": KAWASAN,
            "limit": _p("integer", "Jumlah hasil, maksimum 20", opsional=True),
        },
    ),
    _alat(
        "jelaskan_skor",
        "Ambil rincian kontribusi tiap variabel terhadap skor satu heksagon. "
        "Pakai ini setiap kali pengguna bertanya KENAPA sebuah skor tinggi atau rendah.",
        {"hex_id": H3},
    ),
    _alat(
        "bandingkan",
        "Bandingkan dua heksagon berdampingan.",
        {"hex_a": H3, "hex_b": H3},
    ),
    _alat(
        "cek_harga",
        "PriceLens: harga sewa per m², belanja per jam, dan rentang harga wajar di "
        "kawasan itu. Pakai untuk pertanyaan soal mahal atau murah.",
        {"hex_id": H3},
    ),
    _alat(
        "pola_jam",
        "Commuter Clock: pola transaksi per jam 05:00-22:00, memisahkan captive rider "
        "(tidak punya alternatif selain transit) dan choice rider (punya kendaraan "
        "pribadi tetapi memilih transit). Pakai untuk pertanyaan soal jam ramai.",
        {"hex_id": H3},
    ),
    _alat(
        "cek_zona",
        "ZoneGuard: apakah zona RDTR di lokasi ini mengizinkan kegiatan usaha. "
        "WAJIB dipanggil sebelum merekomendasikan lokasi tertentu kepada pengguna.",
        {"hex_id": H3},
    ),
    _alat(
        "cari_hidden_gem",
        "GemFinder: heksagon yang datanya bagus tetapi tampilannya biasa saja, "
        "beserta alasan terpilihnya. Hanya berisi yang lolos minimal 2 dari 3 metode.",
        {"kawasan": KAWASAN, "limit": _p("integer", "Minimal 10", opsional=True)},
    ),
    _alat(
        "cek_risiko",
        "RiskRadar: lokasi Jebakan Gengsi - terlihat mahal tetapi ekonominya tidak "
        "mendukung, dengan pergantian usaha di atas ambang wajar kawasan.",
        {"kawasan": KAWASAN, "limit": _p("integer", "Jumlah hasil", opsional=True)},
    ),
]

ALAT_FRONTEND: list[dict[str, Any]] = [
    _alat(
        "flyTo",
        "Gerakkan kamera peta ke satu titik. Panggil setelah menemukan lokasi supaya "
        "pengguna benar-benar melihatnya, jangan hanya menyebutnya dalam teks.",
        {
            "lat": _p("number", "Lintang"),
            "lon": _p("number", "Bujur"),
            "zoom": _p("integer", "Level zoom 10-18", opsional=True),
        },
    ),
    _alat(
        "highlight",
        "Sorot satu atau beberapa heksagon di peta.",
        {"hex_ids": {"type": "array", "items": {"type": "string"}, "description": "Daftar kode H3"}},
    ),
    _alat(
        "setLayer",
        "Ganti layer tematik peta.",
        {
            "nama_layer": {
                "type": "string",
                "enum": ["opportunity", "hidden_gem", "risk_radar", "pricelens", "zoneguard"],
                "description": "Layer yang ditampilkan",
            }
        },
    ),
    _alat(
        "filter",
        "Saring heksagon yang tampil di peta.",
        {
            "min_score": _p("number", "Ambang skor peluang 0-100", opsional=True),
            "kuadran": _p(
                "string", "HIDDEN_GEM|JEBAKAN_GENGSI|PEMENANG_JELAS|HINDARI", opsional=True
            ),
        },
    ),
]

SEMUA_ALAT = ALAT_BACKEND + ALAT_FRONTEND


PROMPT_SISTEM = """\
Anda adalah asisten Loconomics, WebGIS pemilih lokasi usaha di sekitar simpul \
transportasi massal Jabodetabek. Pengguna Anda kebanyakan calon pelaku UMKM, \
bukan analis data.

ATURAN YANG TIDAK BOLEH DILANGGAR

1. Anda TIDAK PERNAH menghitung, memperkirakan, atau mengarang angka. Setiap \
angka dalam jawaban Anda harus berasal dari hasil pemanggilan alat pada percakapan \
ini. Kalau alat tidak mengembalikan angka yang diminta pengguna, katakan datanya \
belum ada - jangan menyusun angka yang masuk akal.

2. Setiap kali menyebut skor, sebutkan juga tingkat keyakinannya. Skor 82 dari 40 \
titik survei dan skor 82 dari 3 titik survei adalah dua pernyataan yang berbeda, \
dan pengguna berhak tahu yang mana. Kalau keyakinannya RENDAH, katakan terus terang \
bahwa datanya masih tipis.

3. Sebelum merekomendasikan sebuah lokasi, periksa zonasinya dengan cek_zona. \
Lokasi berstatus DILARANG tidak boleh direkomendasikan dengan alasan apa pun. \
Lokasi berstatus TIDAK_DIKETAHUI boleh disebut, tetapi Anda wajib mengatakan bahwa \
status izinnya belum bisa dipastikan.

4. Jawaban Anda harus MENGGERAKKAN PETA, bukan berhenti sebagai teks. Setelah \
menemukan atau menjelaskan lokasi, panggil flyTo dan highlight supaya pengguna \
melihat yang Anda maksud. Kalau pertanyaannya soal harga, panggil setLayer \
"pricelens". Soal hidden gem, "hidden_gem". Soal risiko, "risk_radar".

CARA MENJAWAB

Bahasa Indonesia sehari-hari, tanpa jargon. "Persentil 78" berarti "lebih tinggi \
daripada 78 dari 100 lokasi lain di kawasan itu" - tulis yang kedua.

Ringkas. Dua sampai empat kalimat untuk pertanyaan biasa. Pakai daftar hanya kalau \
memang membandingkan beberapa lokasi.

Jujur soal keterbatasan. Kalau sebuah angka belum ada, itu jawaban yang sah dan \
jauh lebih berguna daripada tebakan.

Jangan menyebutkan nama alat, nama kolom basis data, atau kode variabel seperti \
D05 kepada pengguna. Terjemahkan ke bahasa manusia: D05 adalah "seberapa penting \
simpul transitnya", P05 "harga sewa", C07 "pedagang keliling".

Anda memberi informasi untuk pertimbangan, bukan nasihat investasi. Jangan pernah \
menjanjikan keuntungan.\
"""


def _konteks(permintaan: PermintaanAI) -> str | None:
    """Konteks peta yang sedang dilihat pengguna, kalau ada.

    Dikirim sebagai bagian pesan pengguna, bukan prompt sistem, supaya prefiks
    yang di-cache tetap sama di seluruh percakapan.
    """
    bagian = []
    if permintaan.hex_terpilih:
        bagian.append(f"Heksagon yang sedang dibuka pengguna: {permintaan.hex_terpilih}")
    if permintaan.layer_aktif:
        bagian.append(f"Layer aktif: {permintaan.layer_aktif}")
    return "\n".join(bagian) if bagian else None


def _ringkas_hasil(nama: str, hasil: Any) -> str:
    """Satu baris untuk kolom jejak. Bukan seluruh payload."""
    if isinstance(hasil, dict):
        if "jumlah" in hasil:
            return f"{nama}: {hasil['jumlah']} hasil"
        if "h3_index" in hasil:
            return f"{nama}: {hasil['h3_index']}"
        if "status" in hasil:
            return f"{nama}: {hasil['status']}"
    return f"{nama}: selesai"


def _kumpulkan_hex(hasil: Any, keranjang: list[str]) -> None:
    """Kumpulkan h3_index yang muncul di hasil alat, untuk field hex_disebut."""
    if isinstance(hasil, dict):
        if isinstance(hasil.get("h3_index"), str):
            keranjang.append(hasil["h3_index"])
        for nilai in hasil.values():
            _kumpulkan_hex(nilai, keranjang)
    elif isinstance(hasil, list):
        for item in hasil:
            _kumpulkan_hex(item, keranjang)


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.get("/fungsi", summary="Daftar fungsi yang boleh dipanggil AI")
def daftar_fungsi() -> dict[str, Any]:
    """Dipakai frontend untuk tahu aksi peta apa saja yang mungkin diminta AI,
    dan dipakai saat menyusun dokumentasi metodologi AI (ketentuan C.1)."""
    return {
        "backend": [{"nama": a["name"], "deskripsi": a["description"]} for a in ALAT_BACKEND],
        "frontend": [{"nama": a["name"], "deskripsi": a["description"]} for a in ALAT_FRONTEND],
        "skema_lengkap": SEMUA_ALAT,
    }


@router.get("/status", summary="Apakah AI Consultant siap dipakai")
def status() -> dict[str, Any]:
    """Dipanggil frontend saat memuat, supaya panel AI bisa menampilkan keadaan
    sebenarnya alih-alih menunggu pertanyaan pertama gagal."""
    siap = tersedia()
    return {
        "siap": siap,
        "model": model_aktif() if siap else None,
        "n_alat_backend": len(ALAT_BACKEND),
        "n_alat_peta": len(ALAT_FRONTEND),
        "pesan": None if siap else "LLM_API_KEY belum diisi di backend/.env",
    }


def _pemanggil(request: Request | None) -> str:
    """Identitas pemanggil untuk pembatas laju.

    Alamat IP, bukan sesi: tidak ada autentikasi di API ini, jadi tidak ada
    identitas lain yang bisa dipercaya. Di belakang proksi Render, alamat aslinya
    ada di X-Forwarded-For.
    """
    if request is None:
        return "internal"
    diteruskan = request.headers.get("x-forwarded-for")
    if diteruskan:
        return diteruskan.split(",")[0].strip()
    return request.client.host if request.client else "tidak diketahui"


@router.post("/tanya", response_model=JawabanAI, summary="Tanya AI Consultant")
def tanya(
    permintaan: PermintaanAI,
    db: Annotated[Session, Depends(get_db)],
    request: Request = None,  # type: ignore[assignment]
    pengguna: PenggunaOpsional = None,
) -> JawabanAI:
    """Alur lengkap satu pertanyaan.

    Loop ditulis tangan, bukan memakai tool runner SDK, karena backend perlu
    memperlakukan dua kelompok alat secara berbeda: alat backend dijalankan dan
    hasilnya dikembalikan ke model, sedangkan alat peta TIDAK dijalankan di sini -
    ia dikumpulkan ke `aksi_peta` dan dieksekusi peta di layar pengguna. Tool
    runner akan mencoba menjalankan keduanya.

    Dua pembatas diperiksa SEBELUM model dipanggil - ini satu-satunya endpoint di
    seluruh backend yang membelanjakan uang sungguhan.
    """
    periksa_laju(_pemanggil(request))
    periksa_anggaran(db, settings.llm_plafon_harian_usd)

    try:
        c = klien()
    except LLMBelumSiap as e:
        raise LayananBelumSiap(str(e)) from e

    # Riwayat diputar ulang sebagai giliran biasa. Hasil alat dari giliran lama
    # sengaja TIDAK ikut: yang perlu diingat model hanyalah apa yang sudah
    # dikatakan, bukan seluruh payload JSON yang pernah dibacanya. Kalau ia butuh
    # angkanya lagi, ia memanggil alatnya lagi - dan itu justru yang benar, karena
    # angka di basis data bisa saja berubah sejak giliran sebelumnya.
    pesan: list[dict[str, Any]] = [
        {"role": "user" if m.peran == "pengguna" else "assistant", "content": m.teks}
        for m in permintaan.riwayat
        if m.teks.strip()
    ]
    # Percakapan tidak boleh diawali giliran asisten.
    while pesan and pesan[0]["role"] != "user":
        pesan.pop(0)

    konteks = _konteks(permintaan)
    isi_awal = permintaan.pertanyaan if not konteks else f"{konteks}\n\n{permintaan.pertanyaan}"
    pesan.append({"role": "user", "content": isi_awal})

    aksi_peta: list[AksiPeta] = []
    jejak: list[JejakFungsi] = []
    sumber_angka: list[FaktorSkor] = []
    hex_disebut: list[str] = []
    total_biaya = 0.0
    balasan = None

    for putaran in range(MAKS_PUTARAN):
        balasan = c.messages.create(
            model=model_aktif(),
            max_tokens=MAKS_TOKEN,
            system=PROMPT_SISTEM,
            tools=SEMUA_ALAT,
            messages=pesan,
        )
        total_biaya += biaya_usd(balasan.usage) or 0.0

        # Klasifikator keamanan menolak permintaan: HTTP 200 tapi tanpa isi yang
        # bisa dipakai. Harus diperiksa sebelum membaca content.
        if balasan.stop_reason == "refusal":
            raise KesalahanAPI(
                "Pertanyaan ini ditolak oleh penyaring keamanan model. Coba ubah kalimatnya."
            )

        if balasan.stop_reason != "tool_use":
            break

        panggilan = [b for b in balasan.content if b.type == "tool_use"]
        pesan.append({"role": "assistant", "content": balasan.content})

        hasil_alat = []
        for blok in panggilan:
            argumen = dict(blok.input)

            # --- Alat peta: TIDAK dijalankan di sini ---
            if blok.name in NAMA_FRONTEND:
                aksi_peta.append(AksiPeta(fungsi=blok.name, argumen=_argumen_peta(blok.name, argumen)))
                jejak.append(
                    JejakFungsi(
                        fungsi=blok.name,  # type: ignore[arg-type]
                        argumen=argumen,
                        ringkas_hasil="diteruskan ke peta",
                    )
                )
                hasil_alat.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": blok.id,
                        "content": "Aksi peta diteruskan ke antarmuka dan akan dijalankan di layar pengguna.",
                    }
                )
                continue

            # --- Alat backend: dijalankan, hasilnya kembali ke model ---
            try:
                hasil = panggil_fungsi(db, blok.name, argumen, pengguna=pengguna)
            except (KesalahanAPI, ValueError, KeyError, TypeError) as e:
                pesan_galat = getattr(e, "pesan", None) or str(e)
                log.warning("Alat %s gagal: %s", blok.name, pesan_galat)
                hasil_alat.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": blok.id,
                        "content": f"Gagal: {pesan_galat}",
                        "is_error": True,
                    }
                )
                jejak.append(
                    JejakFungsi(
                        fungsi=blok.name,  # type: ignore[arg-type]
                        argumen=argumen,
                        ringkas_hasil=f"gagal - {pesan_galat}",
                    )
                )
                continue

            if blok.name == "jelaskan_skor" and isinstance(hasil, dict):
                sumber_angka.extend(
                    FaktorSkor(**f) for f in hasil.get("faktor_teratas", [])
                )
            _kumpulkan_hex(hasil, hex_disebut)

            jejak.append(
                JejakFungsi(
                    fungsi=blok.name,  # type: ignore[arg-type]
                    argumen=argumen,
                    ringkas_hasil=_ringkas_hasil(blok.name, hasil),
                )
            )
            hasil_alat.append(
                {
                    "type": "tool_result",
                    "tool_use_id": blok.id,
                    "content": json.dumps(hasil, default=str, ensure_ascii=False),
                }
            )

        pesan.append({"role": "user", "content": hasil_alat})
    else:
        log.warning("Batas %d putaran alat tercapai", MAKS_PUTARAN)

    teks = "\n".join(b.text for b in balasan.content if b.type == "text").strip()
    if not teks:
        teks = (
            "Saya sudah menjalankan pencarian tetapi belum berhasil menyusun jawabannya. "
            "Coba persempit pertanyaannya, misalnya dengan menyebut kawasannya."
        )

    keyakinan = None
    if permintaan.hex_terpilih:
        hx = db.get(HexFeature, permintaan.hex_terpilih)
        if hx is not None:
            from app.api.bersama import badge

            keyakinan = badge(hx)

    db.add(
        AICallLog(
            fitur="B1",
            model=model_aktif(),
            input_ref=permintaan.pertanyaan[:500],
            output_ringkas=teks[:1000],
            perlu_review=not jejak,  # jawaban tanpa satu pun panggilan alat layak ditinjau
            biaya_usd=round(total_biaya, 6),
        )
    )
    db.commit()

    return JawabanAI(
        teks=teks,
        aksi_peta=aksi_peta,
        sumber_angka=sumber_angka,
        keyakinan=keyakinan,
        jejak=jejak,
        model=model_aktif(),
        hex_disebut=list(dict.fromkeys(hex_disebut)),
    )


def _argumen_peta(nama: str, argumen: dict[str, Any]) -> dict[str, Any]:
    """Sesuaikan argumen alat peta dengan kontrak frontend.

    `filter` dideklarasikan ke model sebagai dua parameter datar (min_score,
    kuadran) supaya skemanya bisa strict, tetapi frontend menerimanya terbungkus
    dalam satu objek `kriteria`. Pembungkusan itu terjadi di sini, bukan di
    frontend, supaya kontrak yang dipegang peta tetap satu bentuk.
    """
    if nama == "filter":
        kriteria = {k: v for k, v in argumen.items() if v is not None}
        return {"kriteria": kriteria}
    return {k: v for k, v in argumen.items() if v is not None}
