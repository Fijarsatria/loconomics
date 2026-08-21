"""Peringkat, GemFinder, RiskRadar, dan ZoneGuard.

Skor tidak pernah dihitung di sini. Seluruh perhitungan indeks dilakukan offline
oleh pipeline/s6_score.py dan hasilnya disimpan ke location_scores. Modul ini
membaca, mengurutkan, menyaring, dan merangkai penjelasan dari angka yang sudah ada.

Satu aturan berlaku di seluruh berkas: setiap endpoint yang MEREKOMENDASIKAN
lokasi wajib melewati saring_zoneguard(). Yang tidak merekomendasikan - diagram
kuadran, misalnya - justru harus menampilkan area terlarang supaya pengguna
melihat area itu memang dikecualikan.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import Float, func, select
from sqlalchemy.orm import Session, aliased

from app.api.bersama import (
    ambil_hex,
    badge,
    gabung_skor,
    peringatan_risiko,
    periksa_kawasan,
    persentil_churn,
    saring_zoneguard,
    skor_heksagon,
    zoneguard,
)
from app.core.aturan import LABEL_KUADRAN, PENJELASAN_KUADRAN
from app.core.database import get_db
from app.models import HexFeature, LocationScore
from app.schemas import (
    AlasanGem,
    DiagramKuadran,
    HiddenGem,
    PeringatanRisiko,
    SkorHeksagon,
    StatusZoneGuard,
    TitikKuadran,
)

router = APIRouter(prefix="/skor", tags=["skor"])

# Ambang lolos tiap metode hidden gem. Sama dengan yang dipakai pipeline saat
# menghitung n_metode_lolos - di sini dipakai hanya untuk MENJELASKAN mengapa
# sebuah heksagon lolos, bukan untuk menentukan lolos atau tidak.
GEM_RESIDUAL_KUARTIL = 0.25
GEM_IPTT_KUARTIL = 0.75


def _baris_skor(rows) -> list[SkorHeksagon]:
    return [skor_heksagon(hx, sc) for hx, sc in rows]


# ---------------------------------------------------------------------------
# Peringkat
# ---------------------------------------------------------------------------


def _total(db: Session, stmt) -> int:
    """Jumlah baris sebelum limit/offset, untuk header X-Total-Count.

    Dihitung dari statement yang sama supaya filternya tidak pernah bisa berbeda
    dari yang dipakai mengambil data - kesalahan klasik yang menghasilkan
    paginasi yang menunjuk halaman kosong.
    """
    inti = stmt.limit(None).offset(None).order_by(None).subquery()
    return db.execute(select(func.count()).select_from(inti)).scalar_one()


@router.get("/ranking", response_model=list[SkorHeksagon], summary="Peringkat Opportunity Score")
def ranking(
    db: Annotated[Session, Depends(get_db)],
    respons: Response,
    kawasan: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    versi: str = "baseline",
) -> list[SkorHeksagon]:
    """Peringkat lokasi terbaik.

    ZoneGuard disaring di sini: ini endpoint rekomendasi, dan merekomendasikan
    lokasi yang zonanya melarang usaha adalah kesalahan yang jauh lebih mahal
    daripada melewatkan satu lokasi bagus.

    Jumlah seluruh hasil dikirim di header `X-Total-Count`, bukan dibungkus ke
    dalam badan respons - supaya bentuk baliknya tetap larik dan pemanggil yang
    tidak peduli paginasi tidak perlu ikut berubah.
    """
    kawasan = periksa_kawasan(kawasan)
    dasar = saring_zoneguard(gabung_skor(versi))
    if kawasan:
        dasar = dasar.where(HexFeature.kawasan == kawasan)

    respons.headers["X-Total-Count"] = str(_total(db, dasar))
    stmt = (
        dasar.order_by(LocationScore.opportunity_score.desc().nullslast())
        .offset(offset)
        .limit(limit)
    )
    return _baris_skor(db.execute(stmt).all())


# ---------------------------------------------------------------------------
# Versi skor - sisi baca simulator what-if (fitur B3)
# ---------------------------------------------------------------------------


@router.get("/versi", summary="Versi skor yang tersedia")
def daftar_versi(db: Annotated[Session, Depends(get_db)]) -> list[dict]:
    """Versi skor yang sudah dihitung pipeline dan tersimpan.

    Backend tidak pernah MEMBUAT versi baru - itu berarti menghitung skor, dan
    skor hanya dihitung di pipeline/s6_score.py. Yang bisa dilakukan di sini
    hanya menyajikan dan membandingkan versi yang sudah ada.
    """
    baris = db.execute(
        select(
            LocationScore.versi,
            func.count().label("n"),
            func.max(LocationScore.dihitung_pada).label("terakhir"),
            func.avg(LocationScore.opportunity_score).label("rata_skor"),
        )
        .group_by(LocationScore.versi)
        .order_by(LocationScore.versi)
    ).all()
    return [
        {
            "versi": r.versi,
            "n_heksagon": r.n,
            "dihitung_pada": r.terakhir,
            "rata_opportunity_score": round(float(r.rata_skor), 2) if r.rata_skor else None,
            "baseline": r.versi == "baseline",
        }
        for r in baris
    ]


@router.get("/banding-versi", summary="Bandingkan dua versi skor")
def banding_versi(
    db: Annotated[Session, Depends(get_db)],
    a: Annotated[str, Query(description="Versi pembanding, biasanya 'baseline'")] = "baseline",
    b: Annotated[str, Query(description="Versi yang diuji")] = "baseline",
    kawasan: Annotated[str | None, Query()] = None,
    limit_pindah: Annotated[int, Query(ge=1, le=50)] = 10,
) -> dict:
    """Seberapa banyak peringkat berubah antara dua versi bobot.

    Inilah bentuk yang bisa disajikan dari uji sensitivitas: bukan pembelaan atas
    angka bobot, melainkan bukti bahwa hasilnya tidak sensitif terhadap angka itu.
    Target yang dipakai proyek ini rho > 0,85 - lihat docs/skoring.md.

    Korelasi dihitung SQL dengan `corr()` atas kolom `peringkat`. Karena peringkat
    sudah berupa rank, korelasi Pearson atas keduanya SAMA DENGAN korelasi Spearman
    atas skornya - jadi tidak perlu scipy di backend, dan tidak ada skor yang
    dihitung ulang di sini.
    """
    kawasan = periksa_kawasan(kawasan)
    A = aliased(LocationScore)
    B = aliased(LocationScore)

    gabung = (
        select(A, B, HexFeature)
        .select_from(A)
        .join(B, (B.h3_index == A.h3_index) & (B.versi == b))
        .join(HexFeature, HexFeature.h3_index == A.h3_index)
        .where(A.versi == a, A.peringkat.is_not(None), B.peringkat.is_not(None))
    )
    if kawasan:
        gabung = gabung.where(HexFeature.kawasan == kawasan)

    inti = gabung.subquery()
    ringkas = db.execute(
        select(
            func.count().label("n"),
            func.corr(inti.c.peringkat, inti.c.peringkat_1).label("rho"),
            func.avg(func.abs(inti.c.peringkat - inti.c.peringkat_1)).label("geser_rata"),
            func.max(func.abs(inti.c.peringkat - inti.c.peringkat_1)).label("geser_maks"),
        )
    ).one()

    pindah = db.execute(
        gabung.order_by(func.abs(A.peringkat - B.peringkat).desc()).limit(limit_pindah)
    ).all()

    rho = float(ringkas.rho) if ringkas.rho is not None else None
    return {
        "versi_a": a,
        "versi_b": b,
        "n_dibandingkan": ringkas.n,
        "rho_spearman": round(rho, 4) if rho is not None else None,
        "lolos_ambang": rho is not None and rho > 0.85,
        "ambang": 0.85,
        "geser_peringkat_rata": round(float(ringkas.geser_rata), 1) if ringkas.geser_rata else None,
        "geser_peringkat_maks": ringkas.geser_maks,
        "paling_berpindah": [
            {
                "h3_index": hx.h3_index,
                "kawasan": hx.kawasan,
                "peringkat_a": sa.peringkat,
                "peringkat_b": sb.peringkat,
                "geser": (sa.peringkat or 0) - (sb.peringkat or 0),
                "kuadran_a": sa.kuadran,
                "kuadran_b": sb.kuadran,
            }
            for sa, sb, hx in pindah
        ],
    }


# ---------------------------------------------------------------------------
# GemFinder
# ---------------------------------------------------------------------------


def _ambang_gem(db: Session, kawasan: str) -> tuple[float | None, float | None]:
    """Kuartil residual biaya dan IPTT dalam satu kawasan.

    Dipakai untuk menyusun kalimat alasan, bukan untuk menentukan kelolosan -
    kelolosan sudah diputuskan pipeline dan tersimpan di n_metode_lolos.
    """
    baris = db.execute(
        select(
            func.percentile_cont(GEM_RESIDUAL_KUARTIL)
            .within_group(LocationScore.residual_biaya.cast(Float))
            .label("residual_p25"),
            func.percentile_cont(GEM_IPTT_KUARTIL)
            .within_group(LocationScore.iptt.cast(Float))
            .label("iptt_p75"),
        )
        .select_from(LocationScore)
        .join(HexFeature, HexFeature.h3_index == LocationScore.h3_index)
        .where(HexFeature.kawasan == kawasan)
    ).one()
    return baris[0], baris[1]


def alasan_gem(
    hx: HexFeature, sc: LocationScore, residual_p25: float | None, iptt_p75: float | None
) -> list[AlasanGem]:
    """Rangkuman alasan sebuah heksagon terpilih - dirakit dari angka basis data.

    Sengaja TIDAK dibuat LLM. Alasan yang dikarang model bahasa terdengar bagus
    tetapi tidak bisa diaudit; kalimat di bawah selalu bisa ditelusuri ke kolom
    yang menghasilkannya, dan itu yang ditanyakan juri.
    """
    alasan: list[AlasanGem] = []

    if (
        sc.residual_biaya is not None
        and residual_p25 is not None
        and sc.residual_biaya <= residual_p25
    ):
        sewa = (
            f"Sewa median di sini Rp{hx.harga_sewa_median:,.0f} per bulan"
            if hx.harga_sewa_median
            else "Biaya di sini"
        ).replace(",", ".")
        alasan.append(
            AlasanGem(
                metode="residual_biaya",
                bukti=(
                    f"{sewa} - lebih murah daripada yang seharusnya, mengingat potensi "
                    f"transit dan aktivitas ekonominya. Termasuk 25% termurah relatif "
                    f"terhadap potensinya di kawasan {hx.kawasan}."
                ),
                kode_variabel=["P05", "P01", "D05", "D11"],
            )
        )

    if sc.kuadran == "HIDDEN_GEM":
        alasan.append(
            AlasanGem(
                metode="kuadran",
                bukti=(
                    "Skor peluang di atas median kawasan, tetapi prestise visualnya di "
                    "bawah median - persis pola lokasi yang datanya bagus tetapi "
                    "penampilannya membuat orang melewatkannya."
                ),
                kode_variabel=["M03", "P02", "C05"],
            )
        )

    if sc.iptt is not None and iptt_p75 is not None and sc.iptt >= iptt_p75:
        alasan.append(
            AlasanGem(
                metode="iptt",
                bukti=(
                    "Banyak pedagang keliling dan pembeli ramai, tetapi sedikit usaha "
                    "menetap. Permintaannya sudah terbukti ada, belum ada yang "
                    "melayaninya secara permanen."
                ),
                kode_variabel=["C07", "D10", "C08"],
            )
        )

    return alasan


NAMA_METODE = {
    "residual_biaya": "harga di bawah potensinya",
    "kuadran": "bagus di data, biasa di tampilan",
    "iptt": "permintaan belum terlayani",
}

BADGE_KALIMAT = {
    "TINGGI": "Didukung survei yang rapat",
    "SEDANG": "Didukung survei secukupnya",
    "RENDAH": "Datanya masih tipis, perlu verifikasi lapangan",
}


def _ringkasan(hx: HexFeature, sc: LocationScore, alasan: list[AlasanGem]) -> str:
    """Satu paragraf siap tampil di kartu.

    Jumlah metode yang disebut diambil dari `n_metode_lolos` milik pipeline, bukan
    dari panjang daftar alasan. Keduanya bisa berbeda: pipeline menghitung ambang
    terhadap seluruh dataset, sedangkan alasan di sini direkonstruksi terhadap
    kawasan. Kalau berbeda, yang benar adalah angka pipeline - itu yang menentukan
    kelolosan - dan selisihnya dikatakan terus terang, bukan ditutup dengan angka
    yang kebetulan cocok dengan kalimatnya.
    """
    if sc.hidden_gem_score is None:
        return f"Heksagon di {hx.kawasan}. Skor hidden gem belum dihitung."

    resmi = sc.n_metode_lolos
    badge_txt = BADGE_KALIMAT[hx.tingkat_keyakinan]
    ekor = f"{badge_txt} - {hx.n_titik_misi} titik misi."

    if not alasan:
        return (
            f"Skor hidden gem {sc.hidden_gem_score:.2f}"
            + (f", lolos {resmi} dari 3 metode. " if resmi else ". ")
            + "Rincian metodenya belum bisa direkonstruksi - jalankan ulang "
            f"pipeline s6_score untuk kawasan {hx.kawasan}. {ekor}"
        )

    dipenuhi = ", ".join(NAMA_METODE[a.metode] for a in alasan)
    jumlah = resmi if resmi is not None else len(alasan)
    catatan = (
        ""
        if resmi is None or resmi == len(alasan)
        else f" (rincian yang bisa ditampilkan di sini {len(alasan)}, "
        f"karena ambangnya dihitung ulang terhadap kawasan)"
    )

    return (
        f"Terpilih lewat {jumlah} dari 3 metode ({dipenuhi}){catatan}. "
        f"{alasan[0].bukti} {ekor}"
    )


@router.get("/hidden-gems", response_model=list[HiddenGem], summary="GemFinder")
def hidden_gems(
    db: Annotated[Session, Depends(get_db)],
    respons: Response = None,  # type: ignore[assignment]
    kawasan: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=10, le=100, description="Kriteria penerimaan: minimal 10")] = 10,
    versi: str = "baseline",
) -> list[HiddenGem]:
    """Heksagon berskor Hidden Gem tertinggi, beserta rangkuman alasan terpilihnya.

    Sebuah heksagon hanya masuk kalau lolos lebih dari satu metode deteksi
    (residual regresi, kuadran prestise, IPTT) - lihat docs/skoring.md. Penyaringan
    itu sudah dilakukan pipeline; di sini tinggal mengurutkan dan menjelaskan.

    Batas bawah `limit` dikunci di 10 supaya kriteria penerimaan "minimal 10
    heksagon teratas" tidak bisa dilanggar dari sisi pemanggil.
    """
    stmt = (
        saring_zoneguard(gabung_skor(versi))
        .where(LocationScore.hidden_gem_score.is_not(None))
        .order_by(LocationScore.hidden_gem_score.desc())
        .limit(limit)
    )
    kawasan = periksa_kawasan(kawasan)
    if kawasan:
        stmt = stmt.where(HexFeature.kawasan == kawasan)

    baris = db.execute(stmt).all()

    # Ambang dihitung sekali per kawasan, bukan sekali per baris.
    ambang: dict[str, tuple[float | None, float | None]] = {}
    hasil = []
    for hx, sc in baris:
        if hx.kawasan not in ambang:
            ambang[hx.kawasan] = _ambang_gem(db, hx.kawasan)
        residual_p25, iptt_p75 = ambang[hx.kawasan]

        daftar = alasan_gem(hx, sc, residual_p25, iptt_p75)
        hasil.append(
            HiddenGem(
                skor=skor_heksagon(hx, sc),
                n_metode_lolos=sc.n_metode_lolos if sc.n_metode_lolos is not None else len(daftar),
                alasan=daftar,
                ringkasan=_ringkasan(hx, sc, daftar),
                zoneguard=zoneguard(hx),
            )
        )
    return hasil


# ---------------------------------------------------------------------------
# RiskRadar
# ---------------------------------------------------------------------------


@router.get("/risk-radar", response_model=list[TitikKuadran], summary="RiskRadar (Jebakan Gengsi)")
def risk_radar(
    db: Annotated[Session, Depends(get_db)],
    kawasan: Annotated[str | None, Query()] = None,
    hanya_berperingatan: Annotated[bool, Query(description="Hanya yang churn-nya melewati ambang wajar kawasan")] = True,
    limit: Annotated[int, Query(le=200)] = 50,
    versi: str = "baseline",
) -> list[TitikKuadran]:
    """Kuadran kanan bawah: terlihat mewah, ekonominya tidak jalan.

    Ditampilkan sebagai peringatan - platform tidak hanya merekomendasikan, tetapi
    juga melindungi pengguna dari lokasi yang paling sering menjebak.

    Peringatan hanya muncul kalau indeks churn (P06) melewati persentil 75 kawasan
    DAN di atas lantai absolut. Lantai itu penting: tanpanya setiap kawasan otomatis
    punya 25% area "berisiko", dan peringatan yang selalu muncul berhenti dibaca.
    """
    stmt = (
        gabung_skor(versi)
        .where(LocationScore.kuadran == "JEBAKAN_GENGSI")
        .order_by(HexFeature.indeks_churn.desc().nullslast())
        .limit(limit)
    )
    kawasan = periksa_kawasan(kawasan)
    if kawasan:
        stmt = stmt.where(HexFeature.kawasan == kawasan)

    ambang: dict[str, tuple[float | None, float | None]] = {}
    hasil = []
    for hx, sc in db.execute(stmt).all():
        if hx.kawasan not in ambang:
            ambang[hx.kawasan] = persentil_churn(db, hx.kawasan)
        p75, p90 = ambang[hx.kawasan]
        risiko = peringatan_risiko(hx, p75, p90)

        if hanya_berperingatan and risiko.tingkat == "AMAN":
            continue

        hasil.append(
            TitikKuadran(
                h3_index=hx.h3_index,
                kawasan=hx.kawasan,
                x_prestise=sc.prestise_visual,
                y_peluang=sc.opportunity_score,
                kuadran=sc.kuadran,  # type: ignore[arg-type]
                indeks_churn=hx.indeks_churn,
                risiko=risiko.tingkat,
                keyakinan=badge(hx),
            )
        )
    return hasil


@router.get("/kuadran", response_model=DiagramKuadran, summary="Diagram kuadran interaktif")
def diagram_kuadran(
    db: Annotated[Session, Depends(get_db)],
    kawasan: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(le=5000)] = 2000,
    versi: str = "baseline",
) -> DiagramKuadran:
    """Titik sebar untuk diagram kuadran yang bisa diklik.

    Sengaja TIDAK menyaring ZoneGuard: diagram ini alat analisis, bukan
    rekomendasi. Justru berguna melihat di mana area terlarang jatuh.

    Sumbu datar prestise visual (bagaimana lokasi terlihat), sumbu tegak skor
    peluang (apa kata datanya). Garis pemisahnya median masing-masing sumbu,
    sama seperti yang dipakai pipeline saat menetapkan kuadran - jadi titik dan
    labelnya tidak akan bertentangan.
    """
    stmt = gabung_skor(versi).limit(limit)
    kawasan = periksa_kawasan(kawasan)
    if kawasan:
        stmt = stmt.where(HexFeature.kawasan == kawasan)
    baris = db.execute(stmt).all()

    batas = db.execute(
        select(
            func.percentile_cont(0.5)
            .within_group(LocationScore.prestise_visual.cast(Float))
            .label("x"),
            func.percentile_cont(0.5)
            .within_group(LocationScore.opportunity_score.cast(Float))
            .label("y"),
        )
        .select_from(LocationScore)
        .join(HexFeature, HexFeature.h3_index == LocationScore.h3_index)
        .where(*( [HexFeature.kawasan == kawasan] if kawasan else [] ))
    ).one()

    ambang: dict[str, tuple[float | None, float | None]] = {}
    titik = []
    for hx, sc in baris:
        if hx.kawasan not in ambang:
            ambang[hx.kawasan] = persentil_churn(db, hx.kawasan)
        p75, p90 = ambang[hx.kawasan]
        titik.append(
            TitikKuadran(
                h3_index=hx.h3_index,
                kawasan=hx.kawasan,
                x_prestise=sc.prestise_visual,
                y_peluang=sc.opportunity_score,
                kuadran=sc.kuadran,  # type: ignore[arg-type]
                indeks_churn=hx.indeks_churn,
                risiko=peringatan_risiko(hx, p75, p90).tingkat,
                keyakinan=badge(hx),
            )
        )

    return DiagramKuadran(
        titik=titik,
        batas_x=batas[0],
        batas_y=batas[1],
        keterangan={k: f"{LABEL_KUADRAN[k]} - {v}" for k, v in PENJELASAN_KUADRAN.items()},
    )


@router.get(
    "/risiko/{h3_index}", response_model=PeringatanRisiko, summary="Peringatan risiko satu heksagon"
)
def risiko_heksagon(h3_index: str, db: Annotated[Session, Depends(get_db)]) -> PeringatanRisiko:
    hx = ambil_hex(db, h3_index)
    p75, p90 = persentil_churn(db, hx.kawasan)
    return peringatan_risiko(hx, p75, p90)


# ---------------------------------------------------------------------------
# ZoneGuard
# ---------------------------------------------------------------------------


@router.get("/zoneguard/ringkasan", summary="Cakupan ZoneGuard per kawasan")
def zoneguard_ringkasan(db: Annotated[Session, Depends(get_db)]) -> list[dict]:
    """Berapa heksagon yang dilarang, diizinkan, dan belum diketahui per kawasan.

    Angka `tidak_diketahui` yang besar adalah kabar penting, bukan aib: ia
    menunjukkan berapa banyak kawasan yang RDTR digitalnya belum ada. Menyembunyikannya
    akan membuat ZoneGuard terlihat lebih meyakinkan daripada kenyataannya.
    """
    baris = db.execute(
        select(
            HexFeature.kawasan,
            func.count().label("total"),
            func.count().filter(HexFeature.zona_izin_komersial.is_(True)).label("diizinkan"),
            func.count().filter(HexFeature.zona_izin_komersial.is_(False)).label("dilarang"),
            func.count().filter(HexFeature.zona_izin_komersial.is_(None)).label("tidak_diketahui"),
        )
        .group_by(HexFeature.kawasan)
        .order_by(HexFeature.kawasan)
    ).all()

    return [
        {
            "kawasan": r.kawasan,
            "total": r.total,
            "diizinkan": r.diizinkan,
            "dilarang": r.dilarang,
            "tidak_diketahui": r.tidak_diketahui,
            "cakupan_rdtr": round((r.total - r.tidak_diketahui) / r.total, 3) if r.total else 0.0,
        }
        for r in baris
    ]


@router.get(
    "/zoneguard/{h3_index}", response_model=StatusZoneGuard, summary="Status zonasi satu heksagon"
)
def zoneguard_heksagon(h3_index: str, db: Annotated[Session, Depends(get_db)]) -> StatusZoneGuard:
    hx = ambil_hex(db, h3_index)
    return zoneguard(hx)
