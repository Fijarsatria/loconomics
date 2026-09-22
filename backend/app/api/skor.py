"""Peringkat, GemFinder, RiskRadar, dan ZoneGuard."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import Float, case, func, select
from sqlalchemy.orm import Session, aliased

from app.api.bersama import (
    ambil_hex,
    badge,
    gabung_skor,
    peringatan_risiko,
    periksa_kawasan,
    periksa_kawasan_banyak,
    persentil_churn,
    saring_zoneguard,
    skor_heksagon,
    zoneguard,
)
from app.core.akun import PenggunaPremium, PenggunaWajib, langganan_aktif
from app.core.aturan import (
    TINGKAT_BERPERINGATAN,
    CHURN_PERSENTIL_BAHAYA,
    CHURN_PERSENTIL_WASPADA,
    BAHASA_BAWAAN,
    Bahasa,
    LABEL_KUADRAN,
    LABEL_KUADRAN_EN,
    PENJELASAN_KUADRAN,
    PENJELASAN_KUADRAN_EN,
    kalimat,
    pilih,
    rp,
    cakupan_prestise,
)
from app.core.database import get_db
from app.core.galat import KesalahanAPI
from app.models import HexFeature, LocationScore
from app.schemas import (
    AlasanGem,
    CakupanPrestise,
    BarisKomparasi,
    DinamikaKawasan,
    DiagramKuadran,
    HiddenGem,
    IndeksKomposit,
    Komparasi,
    PeringatanRisiko,
    RiwayatSkor,
    SkorHeksagon,
    StatusZoneGuard,
    TitikKuadran,
    TitikRiwayat,
    AlasanRekomendasi,
    HasilRekomendasi,
    Rekomendasi,
)

router = APIRouter(prefix="/skor", tags=["skor"])

# Ambang lolos tiap metode hidden gem. Sama dengan yang dipakai pipeline saat
# menghitung n_metode_lolos - di sini dipakai hanya untuk MENJELASKAN mengapa
# sebuah heksagon lolos, bukan untuk menentukan lolos atau tidak.
GEM_RESIDUAL_KUARTIL = 0.25
GEM_IPTT_KUARTIL = 0.75

HEADER_TOTAL = "X-Total-Count"


def _baris_skor(rows) -> list[SkorHeksagon]:
    return [skor_heksagon(hx, sc) for hx, sc in rows]


# ---------------------------------------------------------------------------
# Peringkat
# ---------------------------------------------------------------------------


def _total(db: Session, stmt) -> int:
    """Jumlah baris sebelum limit/offset, untuk header X-Total-Count."""
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
    """Peringkat lokasi terbaik."""
    daftar_kawasan = periksa_kawasan_banyak(kawasan)
    dasar = saring_zoneguard(gabung_skor(versi))
    if daftar_kawasan:
        dasar = dasar.where(HexFeature.kawasan.in_(daftar_kawasan))

    respons.headers[HEADER_TOTAL] = str(_total(db, dasar))
    stmt = (
        dasar.order_by(LocationScore.opportunity_score.desc().nullslast())
        .offset(offset)
        .limit(limit)
    )
    return _baris_skor(db.execute(stmt).all())


@router.get(
    "/daftar-layer",
    response_model=list[SkorHeksagon],
    summary="Daftar heksagon per layer (PriceLens/ZoneGuard)",
)
def daftar_layer(
    db: Annotated[Session, Depends(get_db)],
    respons: Response,
    layer: Annotated[Literal["pricelens", "zoneguard"], Query()] = "pricelens",
    kawasan: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 120,
    versi: str = "baseline",
) -> list[SkorHeksagon]:
    """Daftar per heksagon untuk layer PriceLens dan ZoneGuard.

    Sengaja TIDAK lewat saring_zoneguard(): ZoneGuard justru harus bisa
    menampilkan heksagon yang DILARANG. Urutannya mengikuti layer-nya sendiri,
    bukan opportunity_score - jadi ini bukan peringkat rekomendasi.
    """
    daftar_kawasan = periksa_kawasan_banyak(kawasan)
    dasar = gabung_skor(versi)
    if daftar_kawasan:
        dasar = dasar.where(HexFeature.kawasan.in_(daftar_kawasan))

    if layer == "pricelens":
        dasar = dasar.where(HexFeature.harga_sewa_per_m2.is_not(None)).order_by(
            HexFeature.harga_sewa_per_m2.asc()
        )
    else:
        # Diizinkan dulu, lalu belum diketahui, lalu dilarang.
        dasar = dasar.order_by(
            case(
                (HexFeature.zona_izin_komersial.is_(True), 0),
                (HexFeature.zona_izin_komersial.is_(None), 1),
                else_=2,
            ).asc()
        )

    respons.headers[HEADER_TOTAL] = str(_total(db, dasar))
    return _baris_skor(db.execute(dasar.limit(limit)).all())


# ---------------------------------------------------------------------------
# Versi skor - sisi baca simulator what-if (fitur B3)
# ---------------------------------------------------------------------------


@router.get("/versi", summary="Versi skor yang tersedia")
def daftar_versi(db: Annotated[Session, Depends(get_db)]) -> list[dict]:
    """Versi skor yang sudah dihitung pipeline dan tersimpan."""
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
    """Seberapa banyak peringkat berubah antara dua versi bobot."""
    daftar_kawasan = periksa_kawasan_banyak(kawasan)
    A = aliased(LocationScore)
    B = aliased(LocationScore)

    gabung = (
        select(A, B, HexFeature)
        .select_from(A)
        .join(B, (B.h3_index == A.h3_index) & (B.versi == b))
        .join(HexFeature, HexFeature.h3_index == A.h3_index)
        .where(A.versi == a, A.peringkat.is_not(None), B.peringkat.is_not(None))
    )
    if daftar_kawasan:
        gabung = gabung.where(HexFeature.kawasan.in_(daftar_kawasan))

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
    """Kuartil residual biaya dan IPTT dalam satu kawasan."""
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
    hx: HexFeature,
    sc: LocationScore,
    residual_p25: float | None,
    iptt_p75: float | None,
    bahasa: Bahasa = BAHASA_BAWAAN,
) -> list[AlasanGem]:
    """Rangkuman alasan sebuah heksagon terpilih - dirakit dari angka basis data."""
    alasan: list[AlasanGem] = []

    if (
        sc.residual_biaya is not None
        and residual_p25 is not None
        and sc.residual_biaya <= residual_p25
    ):
        sewa = (
            kalimat("gem_sewa", bahasa, sewa=rp(hx.harga_sewa_median, bahasa))
            if hx.harga_sewa_median
            else kalimat("gem_biaya", bahasa)
        )
        alasan.append(
            AlasanGem(
                metode="residual_biaya",
                bukti=kalimat("gem_residual", bahasa, sewa=sewa, kawasan=hx.kawasan),
                kode_variabel=["P05", "P01", "D05", "D11"],
            )
        )

    if sc.kuadran == "HIDDEN_GEM":
        alasan.append(
            AlasanGem(
                metode="kuadran",
                bukti=kalimat("gem_kuadran", bahasa),
                kode_variabel=["M03", "P02", "C05"],
            )
        )

    if sc.iptt is not None and iptt_p75 is not None and sc.iptt >= iptt_p75:
        alasan.append(
            AlasanGem(
                metode="iptt",
                bukti=kalimat("gem_iptt", bahasa),
                kode_variabel=["C07", "D10", "C08"],
            )
        )

    return alasan


def _ringkasan(
    hx: HexFeature, sc: LocationScore, alasan: list[AlasanGem], bahasa: Bahasa = BAHASA_BAWAAN
) -> str:
    """Satu paragraf siap tampil di kartu."""
    if sc.hidden_gem_score is None:
        return kalimat("gem_tanpa_skor", bahasa, kawasan=hx.kawasan)

    resmi = sc.n_metode_lolos
    ekor = kalimat(
        "badge_ekor",
        bahasa,
        badge=kalimat(f"badge_{hx.tingkat_keyakinan}", bahasa),
        n=hx.n_titik_misi,
    )

    if not alasan:
        return (
            kalimat("gem_skor", bahasa, skor=f"{sc.hidden_gem_score:.2f}")
            + (kalimat("gem_lolos", bahasa, n=resmi) if resmi else ". ")
            + kalimat("gem_tanpa_rincian", bahasa, kawasan=hx.kawasan, ekor=ekor)
        )

    dipenuhi = ", ".join(kalimat(f"gem_metode_{a.metode}", bahasa) for a in alasan)
    jumlah = resmi if resmi is not None else len(alasan)
    catatan = (
        ""
        if resmi is None or resmi == len(alasan)
        else kalimat("gem_selisih", bahasa, n=len(alasan))
    )

    return kalimat(
        "gem_ringkas",
        bahasa,
        jumlah=jumlah,
        dipenuhi=dipenuhi,
        catatan=catatan,
        bukti=alasan[0].bukti,
        ekor=ekor,
    )


@router.get("/hidden-gems", response_model=list[HiddenGem], summary="GemFinder")
def hidden_gems(
    db: Annotated[Session, Depends(get_db)],
    kawasan: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=10, le=100, description="Kriteria penerimaan: minimal 10")] = 10,
    versi: str = "baseline",
    bahasa: Annotated[Bahasa, Query(description="Bahasa kalimat: id atau en")] = BAHASA_BAWAAN,
) -> list[HiddenGem]:
    """Heksagon berskor Hidden Gem tertinggi, beserta rangkuman alasan terpilihnya."""
    stmt = (
        saring_zoneguard(gabung_skor(versi))
        .where(LocationScore.hidden_gem_score.is_not(None))
        .order_by(LocationScore.hidden_gem_score.desc())
        .limit(limit)
    )
    daftar_kawasan = periksa_kawasan_banyak(kawasan)
    if daftar_kawasan:
        stmt = stmt.where(HexFeature.kawasan.in_(daftar_kawasan))

    baris = db.execute(stmt).all()

    # Ambang dihitung sekali per kawasan, bukan sekali per baris.
    ambang: dict[str, tuple[float | None, float | None]] = {}
    hasil = []
    for hx, sc in baris:
        if hx.kawasan not in ambang:
            ambang[hx.kawasan] = _ambang_gem(db, hx.kawasan)
        residual_p25, iptt_p75 = ambang[hx.kawasan]

        daftar = alasan_gem(hx, sc, residual_p25, iptt_p75, bahasa)
        hasil.append(
            HiddenGem(
                skor=skor_heksagon(hx, sc),
                n_metode_lolos=sc.n_metode_lolos if sc.n_metode_lolos is not None else len(daftar),
                alasan=daftar,
                ringkasan=_ringkasan(hx, sc, daftar, bahasa),
                zoneguard=zoneguard(hx, bahasa),
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
    bahasa: Annotated[Bahasa, Query(description="Bahasa kalimat: id atau en")] = BAHASA_BAWAAN,
) -> list[TitikKuadran]:
    """Kuadran kanan bawah: terlihat mewah, ekonominya tidak jalan."""
    stmt = (
        gabung_skor(versi)
        .where(LocationScore.kuadran == "JEBAKAN_GENGSI")
        .order_by(HexFeature.indeks_churn.desc().nullslast())
        .limit(limit)
    )
    daftar_kawasan = periksa_kawasan_banyak(kawasan)
    if daftar_kawasan:
        stmt = stmt.where(HexFeature.kawasan.in_(daftar_kawasan))

    ambang: dict[str, tuple[float | None, float | None]] = {}
    hasil = []
    for hx, sc in db.execute(stmt).all():
        if hx.kawasan not in ambang:
            ambang[hx.kawasan] = persentil_churn(db, hx.kawasan)
        p75, p90 = ambang[hx.kawasan]
        risiko = peringatan_risiko(hx, p75, p90, bahasa)

        if hanya_berperingatan and risiko.tingkat not in TINGKAT_BERPERINGATAN:
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


def batas_kuadran(db: Session, versi: str) -> tuple[float | None, float | None]:
    """Garis pemisah kuadran, DITURUNKAN dari label - bukan dihitung ulang."""
    return db.execute(
        select(
            func.min(
                case(
                    (
                        LocationScore.kuadran.in_(("PEMENANG_JELAS", "JEBAKAN_GENGSI")),
                        LocationScore.prestise_visual,
                    )
                )
            ),
            func.min(
                case(
                    (
                        LocationScore.kuadran.in_(("HIDDEN_GEM", "PEMENANG_JELAS")),
                        LocationScore.opportunity_score,
                    )
                )
            ),
        ).where(LocationScore.versi == versi)
    ).one()


@router.get("/kuadran", response_model=DiagramKuadran, summary="Diagram kuadran interaktif")
def diagram_kuadran(
    db: Annotated[Session, Depends(get_db)],
    kawasan: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(le=5000)] = 2000,
    versi: str = "baseline",
    bahasa: Annotated[Bahasa, Query(description="Bahasa kalimat: id atau en")] = BAHASA_BAWAAN,
) -> DiagramKuadran:
    """Titik sebar untuk diagram kuadran yang bisa diklik."""
    stmt = gabung_skor(versi).limit(limit)
    daftar_kawasan = periksa_kawasan_banyak(kawasan)
    if daftar_kawasan:
        stmt = stmt.where(HexFeature.kawasan.in_(daftar_kawasan))
    baris = db.execute(stmt).all()

    batas = batas_kuadran(db, versi)

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
        keterangan={
            k: f"{pilih(LABEL_KUADRAN, LABEL_KUADRAN_EN, bahasa)[k]} - {v}"
            for k, v in pilih(PENJELASAN_KUADRAN, PENJELASAN_KUADRAN_EN, bahasa).items()
        },
        # Dihitung dari baris yang SUDAH dimuat, bukan dari kueri baru: keterangan
        # sumbu harus menerangkan titik yang benar-benar digambar, dan kalau ia
        # bertanya sendiri ke basis data ia bisa menerangkan himpunan lain.
        cakupan_prestise=CakupanPrestise(**cakupan_prestise([hx for hx, _ in baris])),  # type: ignore[arg-type]
    )


@router.get(
    "/risiko/{h3_index}", response_model=PeringatanRisiko, summary="Peringatan risiko satu heksagon"
)
def risiko_heksagon(
    h3_index: str,
    db: Annotated[Session, Depends(get_db)],
    bahasa: Annotated[Bahasa, Query(description="Bahasa kalimat: id atau en")] = BAHASA_BAWAAN,
) -> PeringatanRisiko:
    hx = ambil_hex(db, h3_index)
    p75, p90 = persentil_churn(db, hx.kawasan)
    return peringatan_risiko(hx, p75, p90, bahasa)


# ---------------------------------------------------------------------------
# ZoneGuard
# ---------------------------------------------------------------------------


@router.get("/zoneguard/ringkasan", summary="Cakupan ZoneGuard per kawasan")
def zoneguard_ringkasan(db: Annotated[Session, Depends(get_db)]) -> list[dict]:
    """Berapa heksagon yang dilarang, diizinkan, dan belum diketahui per kawasan."""
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
def zoneguard_heksagon(
    h3_index: str,
    db: Annotated[Session, Depends(get_db)],
    bahasa: Annotated[Bahasa, Query(description="Bahasa kalimat: id atau en")] = BAHASA_BAWAAN,
) -> StatusZoneGuard:
    hx = ambil_hex(db, h3_index)
    return zoneguard(hx, bahasa)




ARAH_METRIK: dict[str, bool] = {
    "opportunity_score": True,
    "hidden_gem_score": True,
    "ipt": True,
    "iae": True,
    "ikp": False,
    "ibr": False,
    "harga_sewa_per_m2": False,
    "belanja_per_jam": True,
    "waktu_jalan_menit": False,
    "n_kompetitor_langsung": False,
    # Enam aspek baru (11 Sep 2026). Arahnya ditulis DI SINI, bukan di
    # frontend: "churn tinggi itu buruk" adalah aturan produk, dan aturan yang
    # hidup di dua tempat cepat atau lambat berselisih.
    "puncak_sore": True,
    "kepadatan_poi_total": True,
    "keragaman_usaha": True,
    "indeks_churn": False,
    "pop_100m": True,
    "harga_sewa_median": False,
}

MAKS_KOMPARASI = 4


@router.get("/komparasi", response_model=Komparasi, summary="Komparasi berdampingan (Premium)")
def komparasi(
    pengguna: PenggunaPremium,
    db: Annotated[Session, Depends(get_db)],
    h3: Annotated[
        list[str],
        Query(description="Ulangi parameter ini 2-4 kali: ?h3=...&h3=..."),
    ],
    versi: Annotated[str, Query()] = "baseline",
    bahasa: Annotated[Bahasa, Query(description="Bahasa kalimat: id atau en")] = BAHASA_BAWAAN,
) -> Komparasi:
    """Bandingkan 2-4 heksagon berdampingan."""
    unik: list[str] = []
    for x in h3:
        bersih = x.strip()
        if bersih and bersih not in unik:
            unik.append(bersih)

    if not 2 <= len(unik) <= MAKS_KOMPARASI:
        raise KesalahanAPI(
            f"Komparasi butuh 2 sampai {MAKS_KOMPARASI} heksagon yang berbeda, "
            f"diterima {len(unik)}.",
            {"diterima": len(unik), "maks": MAKS_KOMPARASI},
        )

    baris: list[BarisKomparasi] = []
    for h in unik:
        hx = ambil_hex(db, h)
        sc = db.execute(
            select(LocationScore).where(
                LocationScore.h3_index == h, LocationScore.versi == versi
            )
        ).scalar_one_or_none()
        p75, p90 = persentil_churn(db, hx.kawasan)
        baris.append(
            BarisKomparasi(
                h3_index=h,
                kawasan=hx.kawasan,
                opportunity_score=sc.opportunity_score if sc else None,
                hidden_gem_score=sc.hidden_gem_score if sc else None,
                kuadran=sc.kuadran if sc else None,
                peringkat=sc.peringkat if sc else None,
                indeks=IndeksKomposit(
                    ipt=sc.ipt if sc else None,
                    iae=sc.iae if sc else None,
                    ikp=sc.ikp if sc else None,
                    ibr=sc.ibr if sc else None,
                ),
                zoneguard=zoneguard(hx, bahasa),
                risiko=peringatan_risiko(hx, p75, p90, bahasa),
                harga_sewa_per_m2=hx.harga_sewa_per_m2,
                belanja_per_jam=hx.belanja_per_jam,
                waktu_jalan_menit=hx.waktu_jalan_menit,
                n_kompetitor_langsung=hx.n_kompetitor_langsung,
                puncak_sore=hx.puncak_sore,
                kepadatan_poi_total=hx.kepadatan_poi_total,
                keragaman_usaha=hx.keragaman_usaha,
                indeks_churn=hx.indeks_churn,
                pop_100m=hx.pop_100m,
                harga_sewa_median=hx.harga_sewa_median,
                keyakinan=badge(hx),
            )
        )

    def nilai(b: BarisKomparasi, metrik: str):
        if metrik in ("ipt", "iae", "ikp", "ibr"):
            return getattr(b.indeks, metrik)
        return getattr(b, metrik, None)

    menang: dict[str, str | None] = {}
    for metrik, tinggi_baik in ARAH_METRIK.items():
        punya = [(b, nilai(b, metrik)) for b in baris]
        punya = [(b, v) for b, v in punya if v is not None]
        if not punya:
            # Kosong tetap kosong. Tidak ada pemenang di metrik yang tidak
            # dimiliki satu pun kolom - dan menunjuk salah satunya sebagai
            # pemenang dari data yang tidak ada adalah kebohongan bercetak tebal.
            menang[metrik] = None
            continue
        terbaik = (max if tinggi_baik else min)(punya, key=lambda t: t[1])
        menang[metrik] = terbaik[0].h3_index

    return Komparasi(baris=baris, menang=menang)


@router.get(
    "/riwayat/{h3_index}", response_model=RiwayatSkor, summary="Riwayat skor (Premium)"
)
def riwayat_skor(
    h3_index: str,
    pengguna: PenggunaPremium,
    db: Annotated[Session, Depends(get_db)],
    bahasa: Annotated[Bahasa, Query(description="Bahasa kalimat: id atau en")] = BAHASA_BAWAAN,
) -> RiwayatSkor:
    """Skor heksagon ini di setiap versi yang pernah diterbitkan pipeline."""
    ambil_hex(db, h3_index)

    baris = db.execute(
        select(LocationScore)
        .where(LocationScore.h3_index == h3_index)
        .order_by(LocationScore.dihitung_pada.asc().nullslast())
    ).scalars().all()

    titik = [
        TitikRiwayat(
            versi=b.versi,
            dihitung_pada=b.dihitung_pada,
            opportunity_score=b.opportunity_score,
            hidden_gem_score=b.hidden_gem_score,
            kuadran=b.kuadran,
            peringkat=b.peringkat,
        )
        for b in baris
    ]

    cukup = len(titik) >= 2
    if cukup:
        awal = titik[0].opportunity_score
        akhir = titik[-1].opportunity_score
        if awal is not None and akhir is not None:
            kunci = "naik" if akhir > awal else ("turun" if akhir < awal else "tetap")
            catatan = kalimat(
                "riwayat_tren",
                bahasa,
                n=len(titik),
                arah=kalimat(f"riwayat_arah_{kunci}", bahasa),
                selisih=f"{abs(akhir - awal):.1f}",
            )
        else:
            catatan = kalimat("riwayat_sebagian", bahasa, n=len(titik))
    else:
        catatan = kalimat("riwayat_satu", bahasa)

    return RiwayatSkor(
        h3_index=h3_index, titik=titik, cukup_untuk_tren=cukup, catatan=catatan
    )


@router.get(
    "/dinamika", response_model=DinamikaKawasan, summary="Dinamika kawasan (Premium)"
)
def dinamika_kawasan(
    pengguna: PenggunaPremium,
    db: Annotated[Session, Depends(get_db)],
    kawasan: Annotated[str, Query(description="Salah satu dari 6 kawasan pilot")],
    versi: Annotated[str, Query()] = "baseline",
    bahasa: Annotated[Bahasa, Query(description="Bahasa kalimat: id atau en")] = BAHASA_BAWAAN,
) -> DinamikaKawasan:
    """Sebaran churn dan komposisi kuadran satu kawasan."""
    nama = periksa_kawasan(kawasan)
    assert nama is not None  # periksa_kawasan hanya mengembalikan None untuk input None

    p50, p75, p90 = db.execute(
        select(
            func.percentile_cont(0.5).within_group(HexFeature.indeks_churn.cast(Float)),
            func.percentile_cont(CHURN_PERSENTIL_WASPADA)
            .within_group(HexFeature.indeks_churn.cast(Float)),
            func.percentile_cont(CHURN_PERSENTIL_BAHAYA)
            .within_group(HexFeature.indeks_churn.cast(Float)),
        ).where(HexFeature.kawasan == nama, HexFeature.indeks_churn.is_not(None))
    ).one()

    n_waspada = 0
    n_bahaya = 0
    if p75 is not None:
        n_waspada = db.execute(
            select(func.count())
            .select_from(HexFeature)
            .where(
                HexFeature.kawasan == nama,
                HexFeature.indeks_churn.cast(Float) >= p75,
            )
        ).scalar_one()
    if p90 is not None:
        n_bahaya = db.execute(
            select(func.count())
            .select_from(HexFeature)
            .where(
                HexFeature.kawasan == nama,
                HexFeature.indeks_churn.cast(Float) >= p90,
            )
        ).scalar_one()

    per_kuadran = {
        (k or "TANPA_SKOR"): n
        for k, n in db.execute(
            select(LocationScore.kuadran, func.count())
            .join(HexFeature, HexFeature.h3_index == LocationScore.h3_index)
            .where(HexFeature.kawasan == nama, LocationScore.versi == versi)
            .group_by(LocationScore.kuadran)
        ).all()
    }

    n_hex, rata, n_survei = db.execute(
        select(
            func.count(),
            func.avg(LocationScore.opportunity_score),
            func.count(HexFeature.n_titik_misi).filter(HexFeature.n_titik_misi > 0),
        )
        .select_from(HexFeature)
        .join(
            LocationScore,
            (LocationScore.h3_index == HexFeature.h3_index)
            & (LocationScore.versi == versi),
            isouter=True,
        )
        .where(HexFeature.kawasan == nama)
    ).one()

    return DinamikaKawasan(
        kawasan=nama,
        n_heksagon=n_hex or 0,
        churn_p50=round(p50, 4) if p50 is not None else None,
        churn_p75=round(p75, 4) if p75 is not None else None,
        churn_p90=round(p90, 4) if p90 is not None else None,
        n_waspada=n_waspada,
        n_bahaya=n_bahaya,
        per_kuadran=per_kuadran,
        rata_opportunity=round(rata, 2) if rata is not None else None,
        cakupan_survei=round(n_survei / n_hex, 3) if n_hex else None,
        versi=versi,
        catatan=kalimat("dinamika_catatan", bahasa),
    )



DEKAT_MENIT = 8.0
SEPI_KOMPETITOR = 5.0
CHURN_TENANG = 0.30


def _alasan_untuk(
    hx, sc, budget: int | None, p75: float | None, bahasa: Bahasa = BAHASA_BAWAAN
) -> list[AlasanRekomendasi]:
    """Susun alasan dari angka heksagon ini. Tidak ada kalimat tanpa angka."""
    keluar: list[AlasanRekomendasi] = []

    if budget and hx.harga_sewa_median is not None and hx.harga_sewa_median <= budget:
        sisa = budget - hx.harga_sewa_median
        keluar.append(
            AlasanRekomendasi(
                kode="MUAT_ANGGARAN",
                teks=kalimat(
                    "rek_MUAT_ANGGARAN",
                    bahasa,
                    sewa=rp(hx.harga_sewa_median, bahasa),
                    sisa=rp(sisa, bahasa),
                ),
                nilai=hx.harga_sewa_median,
            )
        )

    if sc is not None and sc.kuadran == "HIDDEN_GEM":
        keluar.append(
            AlasanRekomendasi(
                kode="HIDDEN_GEM",
                teks=kalimat("rek_HIDDEN_GEM", bahasa),
                nilai=sc.hidden_gem_score,
            )
        )

    if hx.waktu_jalan_menit is not None and hx.waktu_jalan_menit <= DEKAT_MENIT:
        keluar.append(
            AlasanRekomendasi(
                kode="DEKAT_SIMPUL",
                teks=kalimat("rek_DEKAT_SIMPUL", bahasa, menit=f"{hx.waktu_jalan_menit:.0f}"),
                nilai=hx.waktu_jalan_menit,
            )
        )

    if (
        hx.n_kompetitor_langsung is not None
        and hx.n_kompetitor_langsung <= SEPI_KOMPETITOR
        and (hx.kepadatan_poi_total or 0) > 0
    ):
        keluar.append(
            AlasanRekomendasi(
                kode="SEPI_PESAING",
                teks=kalimat("rek_SEPI_PESAING", bahasa, n=f"{hx.n_kompetitor_langsung:.0f}"),
                nilai=hx.n_kompetitor_langsung,
            )
        )

    if hx.belanja_per_jam is not None and hx.belanja_per_jam > 0:
        keluar.append(
            AlasanRekomendasi(
                kode="UANG_BERPINDAH",
                teks=kalimat("rek_UANG_BERPINDAH", bahasa, rp=rp(hx.belanja_per_jam, bahasa)),
                nilai=hx.belanja_per_jam,
            )
        )

    # --- Catatan: hal yang tetap harus diketahui walau lokasinya bagus ------
    if hx.indeks_churn is not None and p75 is not None and hx.indeks_churn >= p75:
        keluar.append(
            AlasanRekomendasi(
                kode="CHURN_TINGGI",
                teks=kalimat("rek_CHURN_TINGGI", bahasa),
                nilai=hx.indeks_churn,
                jenis="catatan",
            )
        )
    if hx.zona_izin_komersial is None:
        keluar.append(
            AlasanRekomendasi(
                kode="RDTR_KOSONG",
                teks=kalimat("rek_RDTR_KOSONG", bahasa),
                jenis="catatan",
            )
        )
    if hx.n_titik_misi is not None and hx.n_titik_misi == 0:
        keluar.append(
            AlasanRekomendasi(
                kode="BELUM_DISURVEI",
                teks=kalimat("rek_BELUM_DISURVEI", bahasa),
                nilai=0.0,
                jenis="catatan",
            )
        )
    elif hx.n_titik_misi is not None and hx.n_titik_misi < 10:
        keluar.append(
            AlasanRekomendasi(
                kode="DATA_TIPIS",
                teks=kalimat("rek_DATA_TIPIS", bahasa, n=hx.n_titik_misi),
                nilai=float(hx.n_titik_misi),
                jenis="catatan",
            )
        )
    return keluar


CICIP_GRATIS = 1


@router.get(
    "/rekomendasi",
    response_model=HasilRekomendasi,
    summary="Rekomendasi lokasi menurut preferensi akun",
)
def rekomendasi(
    pengguna: PenggunaWajib,
    db: Annotated[Session, Depends(get_db)],
    kawasan: Annotated[str | None, Query(description="Timpa kawasan preferensi")] = None,
    budget: Annotated[int | None, Query(ge=0, description="Timpa anggaran preferensi")] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 12,
    versi: Annotated[str, Query()] = "baseline",
    bahasa: Annotated[Bahasa, Query(description="Bahasa kalimat: id atau en")] = BAHASA_BAWAAN,
) -> HasilRekomendasi:
    """Daftar lokasi yang menjawab keadaan SATU orang."""
    import json

    pref = {}
    if pengguna.preferensi:
        try:
            pref = json.loads(pengguna.preferensi) or {}
        except ValueError:
            pref = {}

    kw = periksa_kawasan_banyak(kawasan or pref.get("kawasan"))
    anggaran = budget if budget is not None else pref.get("budget_sewa_bulanan")

    dasar = saring_zoneguard(gabung_skor(versi))
    if kw:
        dasar = dasar.where(HexFeature.kawasan.in_(kw))
    if anggaran:
        # Heksagon TANPA data sewa tetap ikut. Membuangnya berarti menyamakan
        # "belum disurvei" dengan "terlalu mahal", dan itu persis aturan 4 repo
        # ini: kosong tetap kosong, bukan nol dan bukan tak terhingga.
        dasar = dasar.where(
            (HexFeature.harga_sewa_median <= anggaran)
            | (HexFeature.harga_sewa_median.is_(None))
        )

    total = _total(db, dasar)
    premium = langganan_aktif(db, pengguna) is not None
    ambil = limit if premium else min(limit, CICIP_GRATIS)

    baris = db.execute(
        dasar.order_by(LocationScore.opportunity_score.desc().nullslast()).limit(ambil)
    ).all()

    hasil: list[Rekomendasi] = []
    for hx, sc in baris:
        p75, p90 = persentil_churn(db, hx.kawasan)
        alasan = _alasan_untuk(hx, sc, anggaran, p75, bahasa)
        cocok = [a for a in alasan if a.jenis == "cocok"]
        ringkas = cocok[0].teks if cocok else kalimat("rek_ringkas_umum", bahasa)
        hasil.append(
            Rekomendasi(
                skor=skor_heksagon(hx, sc),
                kawasan=hx.kawasan,
                lat=db.execute(
                    select(func.ST_Y(func.ST_Centroid(HexFeature.geom))).where(
                        HexFeature.h3_index == hx.h3_index
                    )
                ).scalar_one_or_none(),
                lon=db.execute(
                    select(func.ST_X(func.ST_Centroid(HexFeature.geom))).where(
                        HexFeature.h3_index == hx.h3_index
                    )
                ).scalar_one_or_none(),
                harga_sewa_median=hx.harga_sewa_median,
                harga_sewa_per_m2=hx.harga_sewa_per_m2,
                belanja_per_jam=hx.belanja_per_jam,
                waktu_jalan_menit=hx.waktu_jalan_menit,
                jarak_simpul_m=hx.jarak_simpul_m,
                n_kompetitor_langsung=hx.n_kompetitor_langsung,
                indeks_churn=hx.indeks_churn,
                zoneguard=zoneguard(hx, bahasa),
                risiko=peringatan_risiko(hx, p75, p90, bahasa),
                alasan=alasan,
                ringkasan=ringkas,
            )
        )

    bagian = []
    if pref.get("jenis_usaha"):
        bagian.append(str(pref["jenis_usaha"]).replace("_", " "))
    if kw:
        bagian.append(" + ".join(kw))
    if anggaran:
        bagian.append(kalimat("rek_anggaran", bahasa, rp=rp(anggaran, bahasa)))

    if not bagian:
        catatan = kalimat("rek_tanpa_preferensi", bahasa)
    elif not premium:
        catatan = kalimat("rek_dipotong", bahasa, total=total)
    else:
        catatan = kalimat("rek_penuh", bahasa, total=total)

    return HasilRekomendasi(
        hasil=hasil,
        total_cocok=total,
        kriteria={
            "jenis_usaha": pref.get("jenis_usaha"),
            "kawasan": kw,
            "budget_sewa_bulanan": anggaran,
            "ringkas": ", ".join(bagian) if bagian else None,
        },
        dipotong=not premium and total > len(hasil),
        catatan=catatan,
    )
