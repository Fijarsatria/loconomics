"""Aturan produk yang berlaku saat menyusun respons.

Semua yang ada di berkas ini adalah aturan TAMPILAN: kapan peringatan muncul,
bagaimana sebuah angka dinarasikan, label apa yang dipakai. Tidak satu pun
mengubah skor. Skor sudah selesai dihitung di pipeline/s6_score.py sebelum
backend menyentuhnya - lihat CLAUDE.md aturan 1.

Menggeser angka di sini mengubah kapan peringatan muncul, tidak pernah mengubah
peringkat lokasi mana pun.
"""

from typing import Literal

# ---------------------------------------------------------------------------
# RiskRadar - ambang indeks churn (P06)
# ---------------------------------------------------------------------------
# "Ambang batas wajar" ditetapkan relatif terhadap kawasan yang sama, bukan
# absolut nasional: churn 0,4 di Tanah Abang dan 0,4 di Harjamukti punya arti
# yang sangat berbeda karena dasar aktivitasnya berbeda.
#
# Lantai absolut ada supaya kawasan yang seluruhnya stabil tidak memunculkan
# peringatan hanya karena satu heksagon kebetulan paling tinggi di antara yang
# semuanya rendah. Tanpa lantai, setiap kawasan otomatis punya 25% area
# "berisiko" - peringatan yang selalu muncul akan berhenti dibaca.

CHURN_PERSENTIL_WASPADA = 0.75
CHURN_PERSENTIL_BAHAYA = 0.90
CHURN_LANTAI_ABSOLUT = 0.30

TingkatRisiko = Literal["AMAN", "WASPADA", "BAHAYA"]


def tingkat_risiko_churn(
    churn: float | None, p75: float | None, p90: float | None
) -> TingkatRisiko:
    """Satu-satunya tempat aturan peringatan churn didefinisikan.

    p75 dan p90 adalah persentil dalam kawasan yang sama, dihitung SQL.
    Nilai kosong tidak pernah dianggap aman secara diam-diam - ia tetap AMAN
    tetapi badge keyakinan yang menyertainya akan menunjukkan datanya tipis.
    """
    if churn is None or churn < CHURN_LANTAI_ABSOLUT:
        return "AMAN"
    if p90 is not None and churn >= p90:
        return "BAHAYA"
    if p75 is not None and churn >= p75:
        return "WASPADA"
    return "AMAN"


LABEL_RISIKO: dict[str, str] = {
    "AMAN": "Pergantian usaha di kawasan ini wajar",
    "WASPADA": "Pergantian usaha lebih sering daripada 75% area lain di kawasan ini",
    "BAHAYA": "Pergantian usaha termasuk 10% tertinggi di kawasan ini",
}


# ---------------------------------------------------------------------------
# Commuter Clock
# ---------------------------------------------------------------------------
# Harus sama dengan JAM_MULAI / JAM_SELESAI di pipeline/config.py. Pipeline yang
# mengisi tabelnya, backend yang menyajikan - keduanya harus sepakat rentangnya.

JAM_MULAI, JAM_SELESAI = 5, 22
JAM_OPERASIONAL = list(range(JAM_MULAI, JAM_SELESAI + 1))


# ---------------------------------------------------------------------------
# ZoneGuard
# ---------------------------------------------------------------------------
# Tiga status, tiga arti yang berbeda. NULL bukan FALSE: "belum ada RDTR digital"
# bukan "dilarang". Menyamakan keduanya akan mematikan seluruh kawasan yang RDTR-nya
# belum digital - kesalahan yang langsung terlihat di peta.

StatusZona = Literal["DIIZINKAN", "DILARANG", "TIDAK_DIKETAHUI"]


def status_zona(zona_izin_komersial: bool | None) -> StatusZona:
    if zona_izin_komersial is True:
        return "DIIZINKAN"
    if zona_izin_komersial is False:
        return "DILARANG"
    return "TIDAK_DIKETAHUI"


PENJELASAN_ZONA: dict[str, str] = {
    "DIIZINKAN": "Zona RDTR di lokasi ini mengizinkan kegiatan usaha.",
    "DILARANG": (
        "Zona RDTR di lokasi ini tidak mengizinkan kegiatan usaha. "
        "Skor peluang dinolkan dan lokasi ini tidak pernah direkomendasikan, "
        "berapa pun nilai variabel lainnya."
    ),
    "TIDAK_DIKETAHUI": (
        "Kawasan ini belum punya RDTR digital, sehingga status izinnya belum bisa "
        "dipastikan. Skor tetap dihitung, tetapi verifikasi ke dinas terkait "
        "tetap diperlukan sebelum menyewa."
    ),
}


# ---------------------------------------------------------------------------
# Label kuadran
# ---------------------------------------------------------------------------

LABEL_KUADRAN: dict[str, str] = {
    "HIDDEN_GEM": "Hidden Gem",
    "PEMENANG_JELAS": "Pemenang Jelas",
    "JEBAKAN_GENGSI": "Jebakan Gengsi",
    "HINDARI": "Hindari",
}

PENJELASAN_KUADRAN: dict[str, str] = {
    "HIDDEN_GEM": "Datanya bagus tetapi tampilannya biasa saja - sewanya biasanya jauh lebih murah.",
    "PEMENANG_JELAS": "Datanya bagus dan tampilannya mahal - aman, tetapi Anda ikut membayar gengsinya.",
    "JEBAKAN_GENGSI": "Tampilannya mahal tetapi ekonominya tidak mendukung - kuadran yang paling sering menjebak.",
    "HINDARI": "Potensi ekonomi dan daya tarik visualnya sama-sama rendah.",
}
