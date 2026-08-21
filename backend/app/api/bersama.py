"""Potongan yang dipakai lebih dari satu modul API.

Sebelumnya `skor.py` mengimpor `badge()` dari `hex.py`. Begitu modul bertambah,
pola itu berubah jadi impor melingkar. Semua yang dipakai bersama pindah ke sini;
modul API hanya mengimpor dari bawah ke atas, tidak pernah menyamping.

Tidak ada perhitungan skor di berkas ini. Yang ada hanya pembacaan basis data dan
penerapan aturan tampilan dari app/core/aturan.py.
"""

from sqlalchemy import Float, func, select
from sqlalchemy.orm import Session

from app.core.aturan import (
    CHURN_PERSENTIL_BAHAYA,
    CHURN_PERSENTIL_WASPADA,
    LABEL_RISIKO,
    PENJELASAN_ZONA,
    status_zona,
    tingkat_risiko_churn,
)
from app.models import HexFeature, LocationScore
from app.schemas import BadgeKeyakinan, PeringatanRisiko, SkorHeksagon, StatusZoneGuard

# 43 variabel analisis, dikelompokkan sesuai Kamus Data Final (docs/data.md).
DIMENSI: dict[str, list[str]] = {
    "permintaan": [
        "pop_100m", "pop_usia_produktif", "jarak_simpul_m", "waktu_jalan_menit",
        "skor_simpul", "ridership_proksi", "kepadatan_kos", "kepadatan_kantor",
        "generator_keramaian", "skor_ramai_terkoreksi", "intensitas_transaksi",
        "aktivitas_komunitas",
    ],
    "perilaku": [
        "puncak_pagi", "puncak_siang", "puncak_sore", "puncak_malam",
        "rasio_weekend", "pangsa_digital", "harga_median_porsi", "spread_harga",
        "nominal_median_struk", "belanja_per_jam",
    ],
    "kompetisi": [
        "n_kompetitor_langsung", "kepadatan_poi_total", "keragaman_usaha",
        "keragaman_kuliner", "pangsa_waralaba", "rasio_kompetitor_per_kapita",
        "rasio_keliling", "n_menetap_kuliner",
    ],
    "biaya": [
        "njop_m2", "njop_persentil", "pasokan_sewa_komersial", "rasio_sewa_jual",
        "harga_sewa_median", "indeks_churn", "harga_sewa_per_m2",
    ],
    "risiko": ["zona_izin_komersial", "kelas_zona", "risiko_banjir"],
    "morfologi": ["rasio_tutupan_bangunan", "luas_bangunan_median", "skor_prestise_visual"],
}

SEMUA_VARIABEL = [nama for kolom in DIMENSI.values() for nama in kolom]
assert len(SEMUA_VARIABEL) == 43, f"Kamus Data harus 43 variabel, ada {len(SEMUA_VARIABEL)}"


# ---------------------------------------------------------------------------
# Badge keyakinan (Q01-Q03)
# ---------------------------------------------------------------------------


def badge(hx: HexFeature) -> BadgeKeyakinan:
    """Satu-satunya cara membangun badge. Dipakai semua endpoint yang mengirim skor.

    Skor 82 dari 40 titik survei dan skor 82 dari 3 titik survei adalah dua
    pernyataan yang berbeda. Fungsi ini yang memastikan perbedaan itu selalu ikut.
    """
    return BadgeKeyakinan(
        n_titik_misi=hx.n_titik_misi,
        tingkat=hx.tingkat_keyakinan,  # type: ignore[arg-type]
        sumber=hx.data_source,  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------------------
# ZoneGuard
# ---------------------------------------------------------------------------


def zoneguard(hx: HexFeature) -> StatusZoneGuard:
    """Status zonasi satu heksagon.

    `filter_mutlak` benar hanya untuk DILARANG. TIDAK_DIKETAHUI tidak pernah
    ikut disaring: kawasan yang RDTR-nya belum digital bukan kawasan terlarang,
    dan menyamakan keduanya akan mematikan seluruh kawasan itu di peta.
    """
    st = status_zona(hx.zona_izin_komersial)
    return StatusZoneGuard(
        status=st,
        kelas_zona=hx.kelas_zona,
        filter_mutlak=st == "DILARANG",
        penjelasan=PENJELASAN_ZONA[st],
    )


def saring_zoneguard(stmt):
    """Klausa WAJIB untuk setiap query yang MEREKOMENDASIKAN lokasi.

    `is_not(False)` dan bukan `is_(True)`: yang dibuang hanya yang tegas dilarang.
    Heksagon berzona NULL tetap lolos dan dibawa apa adanya beserta peringatannya.

    Kriteria penerimaan fitur ZoneGuard menyebut "filter mutlak". Fungsi inilah
    kemutlakannya - dipanggil di setiap jalur rekomendasi tanpa kecuali:
    /skor/ranking, /skor/hidden-gems, dan fungsi cari_lokasi milik AI.
    """
    return stmt.where(HexFeature.zona_izin_komersial.is_not(False))


# ---------------------------------------------------------------------------
# RiskRadar - persentil churn dalam kawasan
# ---------------------------------------------------------------------------


def persentil_churn(db: Session, kawasan: str) -> tuple[float | None, float | None]:
    """Persentil 75 dan 90 indeks churn dalam satu kawasan.

    Ambangnya relatif terhadap kawasan sendiri, bukan absolut nasional: churn 0,4
    di Tanah Abang dan 0,4 di Harjamukti punya arti berbeda karena dasar
    aktivitasnya berbeda.
    """
    baris = db.execute(
        select(
            func.percentile_cont(CHURN_PERSENTIL_WASPADA)
            .within_group(HexFeature.indeks_churn.cast(Float))
            .label("p75"),
            func.percentile_cont(CHURN_PERSENTIL_BAHAYA)
            .within_group(HexFeature.indeks_churn.cast(Float))
            .label("p90"),
        ).where(HexFeature.kawasan == kawasan, HexFeature.indeks_churn.is_not(None))
    ).one()
    return baris[0], baris[1]


def peringatan_risiko(
    hx: HexFeature, p75: float | None = None, p90: float | None = None
) -> PeringatanRisiko:
    tingkat = tingkat_risiko_churn(hx.indeks_churn, p75, p90)
    return PeringatanRisiko(
        tingkat=tingkat,
        label=LABEL_RISIKO[tingkat],
        indeks_churn=hx.indeks_churn,
        ambang_waspada=p75,
        ambang_bahaya=p90,
    )


# ---------------------------------------------------------------------------
# Perakit skor
# ---------------------------------------------------------------------------


def skor_heksagon(hx: HexFeature, sc: LocationScore | None) -> SkorHeksagon:
    """Bentuk skor yang dipakai di semua daftar dan di layer peta."""
    return SkorHeksagon(
        h3_index=hx.h3_index,
        kawasan=hx.kawasan,
        opportunity_score=sc.opportunity_score if sc else None,
        hidden_gem_score=sc.hidden_gem_score if sc else None,
        kuadran=sc.kuadran if sc else None,  # type: ignore[arg-type]
        peringkat=sc.peringkat if sc else None,
        zona_izin_komersial=hx.zona_izin_komersial,
        keyakinan=badge(hx),
    )


def gabung_skor(versi: str):
    """SELECT HexFeature + LocationScore untuk satu versi skor."""
    return select(HexFeature, LocationScore).join(
        LocationScore,
        (LocationScore.h3_index == HexFeature.h3_index) & (LocationScore.versi == versi),
    )
