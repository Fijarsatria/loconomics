"""Sambungan ke penyedia model bahasa.

Dipisahkan dari app/api/ai.py supaya modul API tidak tahu-menahu soal SDK mana
yang dipakai. Kalau penyedia diganti, hanya berkas ini yang berubah.

Kunci API dibaca dari environment dan TIDAK PERNAH dikirim ke frontend. Ini bukan
kehati-hatian berlebihan: seluruh variabel VITE_ ikut ter-bundel ke berkas yang
bisa dibuka siapa saja, jadi satu kebocoran cukup untuk membuat tagihan berjalan
atas nama orang lain.
"""

from __future__ import annotations

import logging

from app.core.config import settings

log = logging.getLogger(__name__)

# Model default. Bisa ditimpa lewat LLM_MODEL di .env tanpa menyentuh kode.
MODEL_DEFAULT = "claude-opus-5"

# Batas keras putaran percakapan dengan alat. Delapan sudah lebih dari cukup untuk
# pertanyaan paling rumit sekalipun (cari -> jelaskan -> bandingkan -> gerakkan peta);
# batas ini ada supaya model yang tersesat tidak memanggil alat tanpa henti dan
# menghabiskan biaya.
MAKS_PUTARAN = 8

# Cukup untuk narasi beberapa paragraf plus panggilan alat. Bukan angka besar:
# jawaban AI Consultant memang harus ringkas.
MAKS_TOKEN = 4096


class LLMBelumSiap(RuntimeError):
    """Dilempar kalau penyedia belum dikonfigurasi.

    Sengaja bukan jawaban palsu. Endpoint yang menangkapnya mengembalikan 501
    dengan pesan yang menjelaskan apa yang kurang - itu lebih berguna bagi tim
    daripada jawaban kosong yang terlihat berhasil.
    """


def model_aktif() -> str:
    return settings.llm_model or MODEL_DEFAULT


def tersedia() -> bool:
    """Apakah AI Consultant bisa dipakai sekarang. Dipakai endpoint /ai/status."""
    try:
        klien()
    except LLMBelumSiap:
        return False
    return True


_klien = None


def klien():
    """Klien Anthropic, dibuat sekali lalu dipakai ulang.

    Pembuatan ditunda sampai panggilan pertama supaya aplikasi tetap bisa start
    tanpa kunci API - seluruh endpoint lain tidak butuh LLM, dan backend yang
    menolak start hanya karena AI Consultant belum dikonfigurasi akan mematikan
    fitur yang sebenarnya sehat.
    """
    global _klien
    if _klien is not None:
        return _klien

    if not settings.llm_api_key:
        # Sebabnya ke LOG, kalimatnya ke pengguna. Pesan galat ini sampai apa
        # adanya ke layar - ia salah satu dari sedikit galat yang memang
        # disengaja diteruskan - jadi ia tidak boleh menyebut nama berkas,
        # nama variabel lingkungan, maupun perintah yang harus dijalankan.
        log.warning("LLM_API_KEY belum diisi di backend/.env - Konsultan AI dimatikan")
        raise LLMBelumSiap("Konsultan AI belum tersambung ke penyedia modelnya. Bagian lain di peta - skor, kuadran, ZoneGuard, dan rekomendasi - tidak terpengaruh.")

    try:
        import anthropic
    except ModuleNotFoundError as e:  # pragma: no cover - hanya saat dependensi kurang
        raise LLMBelumSiap(
            "Paket 'anthropic' belum terpasang. Jalankan: pip install -r requirements.txt"
        ) from e

    _klien = anthropic.Anthropic(api_key=settings.llm_api_key)
    log.info("Klien LLM siap, model %s", model_aktif())
    return _klien


def biaya_usd(usage) -> float | None:
    """Perkiraan biaya satu panggilan, untuk kolom ai_call_logs.biaya_usd.

    Tarif Claude Opus 5 per Juni 2026: $5 per juta token masukan, $25 per juta
    token keluaran. Ditulis sebagai perkiraan, bukan tagihan - token cache dan
    diskon tidak ikut dihitung di sini.
    """
    if usage is None:
        return None
    masuk = getattr(usage, "input_tokens", 0) or 0
    keluar = getattr(usage, "output_tokens", 0) or 0
    return round(masuk / 1_000_000 * 5.0 + keluar / 1_000_000 * 25.0, 6)
