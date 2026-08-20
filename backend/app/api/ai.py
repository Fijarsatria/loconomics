"""AI Consultant - lapisan AI yang hadir di dalam antarmuka WebGIS.

ATURAN KERAS (docs/ai.md): LLM tidak pernah menghitung angka.
Ia hanya boleh memanggil fungsi di berkas ini, menerima angka dari basis data,
lalu merangkainya menjadi kalimat. Satu halusinasi angka saat demo cukup untuk
menghancurkan kredibilitas seluruh proyek.

Tujuh fungsi terbagi dua kelompok yang jalannya berbeda:

  Dieksekusi BACKEND (menyentuh basis data, mengembalikan angka)
    cari_lokasi, bandingkan, jelaskan_skor

  Dieksekusi FRONTEND (aksi peta, tidak menyentuh basis data)
    flyTo, highlight, setLayer, filter
    -> backend hanya meneruskannya sebagai instruksi di field `aksi_peta`

Pembagian ini penting: kalau flyTo dieksekusi di backend, tidak ada yang bergerak
di layar pengguna. Ketentuan C.2 meminta keluaran AI yang benar-benar mendarat
di peta, bukan sekadar teks.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.hex import badge, detail_heksagon
from app.core.database import get_db
from app.models import HexFeature, LocationScore
from app.schemas import JawabanAI, PermintaanAI, SkorHeksagon

router = APIRouter(prefix="/ai", tags=["ai"])

# Fungsi yang boleh dipanggil LLM. Skema ini yang dikirim ke provider LLM
# sebagai definisi tool/function calling.
FUNGSI_BACKEND = {
    "cari_lokasi": {
        "deskripsi": "Cari heksagon yang cocok dengan kriteria usaha pengguna.",
        "argumen": {
            "jenis_usaha": "kelas induk taksonomi: F1|F2|R1|R2|S1|S2|K1|T1",
            "budget_sewa_bulanan": "batas atas harga sewa dalam rupiah",
            "maks_menit_jalan": "batas waktu jalan kaki dari simpul transit",
            "kawasan": "salah satu dari 6 kawasan pilot",
        },
    },
    "bandingkan": {
        "deskripsi": "Bandingkan dua heksagon berdampingan.",
        "argumen": {"hex_a": "h3_index", "hex_b": "h3_index"},
    },
    "jelaskan_skor": {
        "deskripsi": "Ambil rincian kontribusi tiap variabel terhadap skor satu heksagon.",
        "argumen": {"hex_id": "h3_index"},
    },
}

FUNGSI_FRONTEND = {
    "flyTo": {"lat": "float", "lon": "float", "zoom": "int"},
    "highlight": {"hex_ids": "list[str]"},
    "setLayer": {"nama_layer": "opportunity|hidden_gem|risk_radar|pricelens|zoneguard"},
    "filter": {"kriteria": "dict"},
}


# ---------------------------------------------------------------------------
# Implementasi fungsi backend - satu-satunya sumber angka untuk LLM
# ---------------------------------------------------------------------------


def cari_lokasi(
    db: Session,
    jenis_usaha: str | None = None,
    budget_sewa_bulanan: float | None = None,
    maks_menit_jalan: float | None = None,
    kawasan: str | None = None,
    limit: int = 5,
    versi: str = "baseline",
) -> list[SkorHeksagon]:
    """Kriteria pengguna -> daftar heksagon. Seluruh penyaringan dilakukan SQL."""
    stmt = (
        select(HexFeature, LocationScore)
        .join(
            LocationScore,
            (LocationScore.h3_index == HexFeature.h3_index) & (LocationScore.versi == versi),
        )
        # ZoneGuard: lokasi yang zonanya melarang usaha tidak pernah direkomendasikan
        .where(HexFeature.zona_izin_komersial.is_not(False))
        .order_by(LocationScore.opportunity_score.desc().nullslast())
        .limit(limit)
    )
    if kawasan:
        stmt = stmt.where(HexFeature.kawasan == kawasan)
    if budget_sewa_bulanan is not None:
        stmt = stmt.where(HexFeature.harga_sewa_median <= budget_sewa_bulanan)
    if maks_menit_jalan is not None:
        stmt = stmt.where(HexFeature.waktu_jalan_menit <= maks_menit_jalan)

    return [
        SkorHeksagon(
            h3_index=hx.h3_index,
            kawasan=hx.kawasan,
            opportunity_score=sc.opportunity_score,
            hidden_gem_score=sc.hidden_gem_score,
            kuadran=sc.kuadran,  # type: ignore[arg-type]
            peringkat=sc.peringkat,
            zona_izin_komersial=hx.zona_izin_komersial,
            keyakinan=badge(hx),
        )
        for hx, sc in db.execute(stmt).all()
    ]


def bandingkan(db: Session, hex_a: str, hex_b: str, versi: str = "baseline") -> dict[str, Any]:
    return {
        "a": detail_heksagon(hex_a, db, versi).model_dump(),
        "b": detail_heksagon(hex_b, db, versi).model_dump(),
    }


def jelaskan_skor(db: Session, hex_id: str, versi: str = "baseline") -> dict[str, Any]:
    return detail_heksagon(hex_id, db, versi).model_dump()


REGISTRI = {
    "cari_lokasi": cari_lokasi,
    "bandingkan": bandingkan,
    "jelaskan_skor": jelaskan_skor,
}


def panggil_fungsi(db: Session, nama: str, argumen: dict[str, Any]) -> Any:
    """Titik masuk tunggal untuk seluruh function call dari LLM.

    Validasi di sini bukan formalitas: argumen datang dari keluaran model bahasa,
    jadi tidak boleh dipercaya mentah-mentah. Nama fungsi di luar registri ditolak,
    bukan dijalankan secara dinamis.
    """
    fungsi = REGISTRI.get(nama)
    if fungsi is None:
        raise HTTPException(status_code=400, detail=f"Fungsi '{nama}' tidak tersedia")
    return fungsi(db, **argumen)


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.get("/fungsi", summary="Daftar fungsi yang boleh dipanggil AI")
def daftar_fungsi() -> dict[str, Any]:
    """Dipakai frontend untuk tahu aksi peta apa saja yang mungkin diminta AI,
    dan dipakai saat menyusun dokumentasi metodologi AI (ketentuan C.1)."""
    return {"backend": FUNGSI_BACKEND, "frontend": FUNGSI_FRONTEND}


@router.post("/tanya", response_model=JawabanAI, summary="Tanya AI Consultant")
def tanya(permintaan: PermintaanAI, db: Session = Depends(get_db)) -> JawabanAI:
    """Alur yang harus diimplementasikan saat provider LLM sudah dipilih:

      1. Kirim `permintaan.pertanyaan` + konteks peta + definisi FUNGSI_BACKEND
         dan FUNGSI_FRONTEND ke LLM.
      2. LLM membalas dengan permintaan function call.
      3. Untuk fungsi backend  -> jalankan lewat panggil_fungsi(), kembalikan
         hasilnya ke LLM sebagai bahan narasi.
         Untuk fungsi frontend -> teruskan apa adanya ke `aksi_peta`.
      4. Susun JawabanAI. Setiap angka di `teks` wajib punya pasangannya di
         `sumber_angka`; kalau tidak ada, angka itu halusinasi dan harus ditolak.

    Provider belum ditentukan (keputusan AI Engineer, lihat docs/ai.md).
    MAPID tidak menyediakan token AI - kandidat gratis: Groq, Claude, Gemini, DeepSeek.
    Kunci API-nya WAJIB di backend, tidak boleh di frontend.
    """
    raise HTTPException(
        status_code=501,
        detail=(
            "AI Consultant belum tersambung ke provider LLM. "
            "Fungsi backend (cari_lokasi, bandingkan, jelaskan_skor) sudah siap dipanggil "
            "lewat panggil_fungsi(). Lihat docs/ai.md bagian B1."
        ),
    )
