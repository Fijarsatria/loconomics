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

# Bawaan saat LLM_PROVIDER=gemini. Bisa ditimpa LLM_MODEL, sama seperti di atas.
MODEL_GEMINI = "gemini-flash-latest"

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
    if settings.llm_model:
        return settings.llm_model
    return MODEL_GEMINI if settings.llm_provider.lower() == "gemini" else MODEL_DEFAULT


#: Sampai kapan penyedia dianggap sedang menolak. Epoch detik; 0 = tidak.
_penuh_sampai: float = 0.0

#: Lima belas menit. Bukan sampai kuota harian benar-benar pulih (tengah malam
#: Pasifik), karena kita tidak bisa membedakan "jatah harian habis" dari
#: "sedang ramai sesaat" tanpa mencoba lagi - dan menyembunyikan Konsultan AI
#: sampai besok karena satu ledakan lalu lintas lebih merugikan daripada
#: menampilkannya. Sesudah jendela ini status kembali optimistis, dan
#: percobaan berikutnya yang menguji ulang keadaannya.
JENDELA_PENUH_DETIK = 15 * 60


#: Sekat bawah. Penyedia yang menyuruh mencoba lagi "dalam 2 detik" tetap
#: ditandai penuh setengah menit: dua pengunjung yang menekan kirim pada detik
#: yang sama akan sama-sama membentur batas yang sama, dan yang kedua tidak
#: perlu ikut menunggu balasan galat untuk mengetahuinya.
JENDELA_PENUH_MINIMUM = 30


def tandai_penyedia_penuh(detik: float | None = None) -> None:
    """Dipanggil klien saat SELURUH modelnya menolak (429/503).

    Ada supaya `/ai/status` berhenti berbohong. Tanpa ini status cuma menjawab
    "kuncinya terpasang?" - dan itu tetap `true` sepanjang jatah harian habis,
    jadi panel Konsultan AI mengundang orang bertanya lalu gagal pada
    pertanyaan pertama. Itu persis keadaan yang endpoint ini dibuat untuk
    mencegah. Terjadi 13 Sep 2026: jatah Gemini habis dipakai OCR foto misi,
    dan `/ai/status` di backend publik tetap menjawab `siap: true`.

    `detik` DITAMBAHKAN 13 Sep 2026 sesudah diukur, dan ia memperbaiki
    kesalahan yang arahnya berlawanan. Balasan 429 Google ternyata membawa
    lamanya sendiri, dan yang benar-benar terjadi di terbitan hidup berbunyi:

        Quota exceeded for metric: generate_content_free_tier_requests,
        limit: 20, model: gemini-3-flash. Please retry in 1.93s

    Dua puluh permintaan per MENIT, dan disuruh kembali dua detik lagi. Tanpa
    parameter ini, hambatan dua detik itu mematikan Konsultan AI **lima belas
    menit** dan membuat `/ai/status` mengabarkan "jatah hariannya habis" -
    kalimat yang salah tentang keadaan yang sudah lewat. Di depan juri yang
    mencoba fitur berbobot 20%, selisih antara dua detik dan lima belas menit
    adalah selisih antara jeda dan kegagalan.

    Kosong berarti penyedianya tidak memberi tahu, dan barulah 15 menit yang
    lama dipakai: kalau kita tidak tahu berapa lama, menganggapnya lama lebih
    aman daripada mengundang orang mencoba lagi setiap detik.
    """
    global _penuh_sampai
    import time

    if detik is None:
        jendela = float(JENDELA_PENUH_DETIK)
    else:
        jendela = min(max(float(detik), JENDELA_PENUH_MINIMUM), float(JENDELA_PENUH_DETIK))
    _penuh_sampai = time.time() + jendela


def tandai_penyedia_pulih() -> None:
    """Dipanggil klien pada panggilan yang BERHASIL."""
    global _penuh_sampai
    _penuh_sampai = 0.0


def penyedia_penuh() -> bool:
    import time

    return _penuh_sampai > time.time()


def sisa_penuh_detik() -> int:
    """Berapa detik lagi sebelum penyedianya dicoba lagi. 0 kalau tidak penuh.

    Dipakai `/ai/status` supaya kalimat yang muncul di panel menyebut lamanya
    yang SEBENARNYA. "Coba lagi sebentar lagi" untuk hambatan dua detik dan
    untuk jatah harian yang habis adalah kalimat yang sama untuk dua keadaan
    yang menuntut keputusan berbeda dari pembacanya.
    """
    import time

    return max(0, int(round(_penuh_sampai - time.time())))


def tersedia() -> bool:
    """Apakah AI Consultant bisa dipakai sekarang. Dipakai endpoint /ai/status.

    DUA syarat, bukan satu: kuncinya terpasang, DAN penyedianya tidak sedang
    menolak seluruh modelnya. Yang kedua ditambahkan 13 Sep 2026 - lihat
    `tandai_penyedia_penuh`.
    """
    if penyedia_penuh():
        return False
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

    # Penyedia dipilih dari LLM_PROVIDER. Keduanya mengembalikan objek dengan
    # bentuk yang SAMA - `.messages.create()` yang menjawab blok bergaya
    # Anthropic - jadi `api/ai.py` tidak pernah tahu mana yang sedang dipakai.
    if settings.llm_provider.lower() == "gemini":
        from app.core.llm_gemini import KlienGemini

        _klien = KlienGemini(settings.llm_api_key)
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
    """Perkiraan biaya satu panggilan, untuk kolom ai_call_logs.biaya_usd.

    Tarif Claude Opus 5 per Juni 2026: $5 per juta token masukan, $25 per juta
    token keluaran. Ditulis sebagai perkiraan, bukan tagihan - token cache dan
    diskon tidak ikut dihitung di sini.
    """
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
