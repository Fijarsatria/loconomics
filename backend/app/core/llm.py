"""Sambungan ke penyedia model bahasa."""

from __future__ import annotations

import logging

from app.core.config import settings

log = logging.getLogger(__name__)

# Model default. Bisa ditimpa lewat LLM_MODEL di .env tanpa menyentuh kode.
MODEL_DEFAULT = "claude-opus-5"

# Bawaan saat LLM_PROVIDER=gemini. Bisa ditimpa LLM_MODEL, sama seperti di atas.
MODEL_GEMINI = "gemini-flash-latest"

MAKS_PUTARAN = 8

# Cukup untuk narasi beberapa paragraf plus panggilan alat. Bukan angka besar:
# jawaban AI Consultant memang harus ringkas.
MAKS_TOKEN = 4096


class LLMBelumSiap(RuntimeError):
    """Dilempar kalau penyedia belum dikonfigurasi."""


def model_aktif() -> str:
    if settings.llm_model:
        return settings.llm_model
    return MODEL_GEMINI if settings.llm_provider.lower() == "gemini" else MODEL_DEFAULT


#: Sampai kapan penyedia dianggap sedang menolak. Epoch detik; 0 = tidak.
_penuh_sampai: float = 0.0

JENDELA_PENUH_DETIK = 15 * 60


JENDELA_PENUH_MINIMUM = 30

JENDELA_BERUNTUN = 20 * 60

#: Jendela yang dipakai terakhir kali, dan kapan. Dasar pelipatgandaan.
_jendela_terakhir: float = 0.0
_gagal_terakhir_pada: float = 0.0


def tandai_penyedia_penuh(detik: float | None = None) -> None:
    """Dipanggil klien saat SELURUH modelnya menolak (429/503)."""
    global _penuh_sampai
    import time

    global _jendela_terakhir, _gagal_terakhir_pada
    sekarang = time.time()

    beruntun = _gagal_terakhir_pada > 0 and sekarang - _gagal_terakhir_pada < JENDELA_BERUNTUN
    if detik is None:
        jendela = float(JENDELA_PENUH_DETIK)
    elif beruntun and _jendela_terakhir > 0:
        jendela = min(_jendela_terakhir * 2, float(JENDELA_PENUH_DETIK))
    else:
        jendela = min(max(float(detik), JENDELA_PENUH_MINIMUM), float(JENDELA_PENUH_DETIK))

    _jendela_terakhir = jendela
    _gagal_terakhir_pada = sekarang
    _penuh_sampai = sekarang + jendela


def tandai_penyedia_pulih() -> None:
    """Dipanggil klien pada panggilan yang BERHASIL."""
    global _penuh_sampai, _jendela_terakhir, _gagal_terakhir_pada
    _penuh_sampai = 0.0
    _jendela_terakhir = 0.0
    _gagal_terakhir_pada = 0.0


def penyedia_penuh() -> bool:
    import time

    return _penuh_sampai > time.time()


def sisa_penuh_detik() -> int:
    """Berapa detik lagi sebelum penyedianya dicoba lagi. 0 kalau tidak penuh."""
    import time

    return max(0, int(round(_penuh_sampai - time.time())))


def tersedia() -> bool:
    """Apakah AI Consultant bisa dipakai sekarang. Dipakai endpoint /ai/status."""
    if penyedia_penuh():
        return False
    try:
        klien()
    except LLMBelumSiap:
        return False
    return True


_klien = None


def klien():
    """Klien Anthropic, dibuat sekali lalu dipakai ulang."""
    global _klien
    if _klien is not None:
        return _klien

    if not settings.llm_api_key:
        log.warning("LLM_API_KEY belum diisi di backend/.env - Konsultan AI dimatikan")
        raise LLMBelumSiap("Konsultan AI belum tersambung ke penyedia modelnya. Bagian lain di peta - skor, kuadran, ZoneGuard, dan rekomendasi - tidak terpengaruh.")

    # Penyedia dipilih dari LLM_PROVIDER. Keduanya mengembalikan objek dengan
    # bentuk yang SAMA - `.messages.create()` yang menjawab blok bergaya
    # Anthropic - jadi `api/ai.py` tidak pernah tahu mana yang sedang dipakai.
    if settings.llm_provider.lower() == "gemini":
        from app.core.llm_gemini import KlienGemini

        # Cadangan boleh lebih dari satu, dipisah koma. Urutan di sini urutan
        # percobaannya: kunci utama selalu yang pertama.
        cadangan = [k.strip() for k in settings.llm_api_key_cadangan.split(",") if k.strip()]
        _klien = KlienGemini([settings.llm_api_key, *cadangan])
        log.info("Klien LLM siap (Gemini), model %s", model_aktif())
        return _klien

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
    """Perkiraan biaya satu panggilan, untuk kolom ai_call_logs.biaya_usd."""
    if usage is None:
        return None
    masuk = getattr(usage, "input_tokens", 0) or 0
    keluar = getattr(usage, "output_tokens", 0) or 0
    # Tarifnya IKUT penyedia. Memakai tarif Opus untuk panggilan Gemini akan
    # melebihkan biayanya ~17x, dan plafon harian dihitung dari kolom ini -
    # akibatnya Konsultan AI mati jauh sebelum uangnya benar-benar terpakai.
    if settings.llm_provider.lower() == "gemini":
        from app.core.llm_gemini import TARIF_KELUAR, TARIF_MASUK

        return round(
            masuk / 1_000_000 * TARIF_MASUK + keluar / 1_000_000 * TARIF_KELUAR, 6
        )
    return round(masuk / 1_000_000 * 5.0 + keluar / 1_000_000 * 25.0, 6)
