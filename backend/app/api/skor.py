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
    LABEL_KUADRAN,
    PENJELASAN_KUADRAN,
)
from app.core.database import get_db
from app.core.galat import KesalahanAPI
from app.models import HexFeature, LocationScore
from app.schemas import (
    AlasanGem,
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

#: Header jumlah baris sebelum limit/offset.
#:
#: Namanya hidup di sini sebagai konstanta, bukan sebagai string di dua tempat,
#: karena ia HARUS ikut `expose_headers` di main.py. Peramban menyembunyikan
#: setiap header respons yang tidak disebutkan di sana, jadi header yang lupa
#: didaftarkan bukan header yang "belum dipakai" - ia header yang tidak pernah
#: bisa dibaca frontend sama sekali, dan gagalnya diam.
HEADER_TOTAL = "X-Total-Count"


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
    daftar_kawasan = periksa_kawasan_banyak(kawasan)
    if daftar_kawasan:
        stmt = stmt.where(HexFeature.kawasan.in_(daftar_kawasan))

    ambang: dict[str, tuple[float | None, float | None]] = {}
    hasil = []
    for hx, sc in db.execute(stmt).all():
        if hx.kawasan not in ambang:
            ambang[hx.kawasan] = persentil_churn(db, hx.kawasan)
        p75, p90 = ambang[hx.kawasan]
        risiko = peringatan_risiko(hx, p75, p90)

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
    """Garis pemisah kuadran, DITURUNKAN dari label - bukan dihitung ulang.

    Versi sebelumnya menghitung `percentile_cont(0.5)` sendiri, dan salah dua
    kali sekaligus. Pertama, ia menyaring per kawasan, padahal pipeline
    menetapkan kuadran memakai median SELURUH heksagon: di Dukuh Atas BNI median
    lokalnya 0,71 sementara global 0,41, jadi hanya 48% titiknya yang jatuh di
    sel yang sesuai labelnya. Kedua, median yang dihitung ulang bisa bergeser
    dari median yang dipakai pipeline begitu ada baris masuk atau keluar.

    Yang di bawah ini tidak bisa salah dengan cara itu. `kuadran` sudah memuat
    keputusannya; batasnya cukup dibaca sebagai nilai TERKECIL di sisi tinggi.
    Karena pipeline memakai `>=` median, nilai itu memang persis tepi kolom
    kanan (dan baris atas), berapa pun mediannya dan bagaimana pun pipeline
    mengelompokkan datanya. Aturan 1 repo ini juga terpenuhi: ini membaca, bukan
    menghitung skor.

    Tanpa filter kawasan, jadi garisnya diam saat pengguna berpindah kawasan.
    Garis yang ikut bergeser membuat dua kawasan tidak bisa dibandingkan.
    """
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
) -> DiagramKuadran:
    """Titik sebar untuk diagram kuadran yang bisa diklik.

    Sengaja TIDAK menyaring ZoneGuard: diagram ini alat analisis, bukan
    rekomendasi. Justru berguna melihat di mana area terlarang jatuh.

    Sumbu datar prestise visual (bagaimana lokasi terlihat), sumbu tegak skor
    peluang (apa kata datanya).

    Garis pemisahnya DITURUNKAN DARI LABEL, bukan dihitung ulang - lihat
    `batas_kuadran()`. Dengan begitu titik dan labelnya tidak bisa bertentangan.
    """
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


# ===========================================================================
# Loconomics Premium
# ===========================================================================
#
# Tiga endpoint di bawah memakai dependensi `PenggunaPremium`, bukan `if` di
# dalam badan fungsinya. Alasannya sama dengan `saring_zoneguard()`: penjaga
# yang harus diingat untuk dipanggil adalah penjaga yang suatu saat lupa
# dipanggil. Sebagai dependensi ia ikut ke OpenAPI, terlihat di /docs, dan
# tidak bisa terlewat karena seseorang menambahkan jalur `return` lebih awal.
#
# TIDAK SATU PUN dari ketiganya boleh dibungkus @ber_cache. Isinya memang tidak
# bergantung pada siapa pemanggilnya, tetapi objek pengguna ikut masuk sebagai
# argumen kata-kunci dan `repr()`-nya memuat alamat memori - kuncinya jadi unik
# tiap permintaan. Lihat peringatan di app/core/cache.py.


#: Metrik yang dibandingkan, dan arah mana yang lebih baik.
#: True = makin tinggi makin baik. IKP dan IBR sengaja False - keduanya indeks
#: BEBAN (kompetisi, biaya & risiko), dan aturan itu sudah hidup di backend.
#: Menyalinnya ke frontend berarti dua tempat yang harus terus sepakat.
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
) -> Komparasi:
    """Bandingkan 2-4 heksagon berdampingan.

    Empat, bukan lebih. Bukan batas teknis: kolom kelima tidak lagi muat di
    layar mana pun tanpa digulir menyamping, dan tabel perbandingan yang harus
    digulir menyamping berhenti jadi perbandingan.

    `menang` dihitung DI SINI, bukan di frontend. Untuk tiap metrik ia memuat
    h3_index yang terbaik pada metrik itu, sudah memperhitungkan arah - IKP dan
    IBR tinggi itu buruk. Frontend cukup menebalkan yang disebut, tanpa perlu
    tahu metrik mana yang terbalik.

    Heksagon berzona terlarang TIDAK disaring. Endpoint ini tidak
    merekomendasikan apa pun; ia membandingkan yang sudah dipilih orangnya, dan
    menyembunyikan salah satunya justru menghilangkan alasan terkuat untuk tidak
    memilihnya. Statusnya ikut di tiap kolom.
    """
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
                zoneguard=zoneguard(hx),
                risiko=peringatan_risiko(hx, p75, p90),
                harga_sewa_per_m2=hx.harga_sewa_per_m2,
                belanja_per_jam=hx.belanja_per_jam,
                waktu_jalan_menit=hx.waktu_jalan_menit,
                n_kompetitor_langsung=hx.n_kompetitor_langsung,
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
) -> RiwayatSkor:
    """Skor heksagon ini di setiap versi yang pernah diterbitkan pipeline.

    Basis data ini baru memuat satu versi. Endpoint ini TIDAK mengarang sisanya,
    dan tidak mengembalikan sederet titik berjarak sebulan yang seluruhnya
    berasal dari angka yang sama. Yang dikembalikan satu titik, dengan
    `cukup_untuk_tren: false` dan keterangan kenapa.

    Itu keputusan yang sama dengan yang sudah diambil untuk isochrone di
    docs/data.md: lingkaran palsu lebih buruk daripada tidak ada lingkaran.
    Grafik tren dari satu titik data adalah versi grafis dari lingkaran palsu.
    """
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
            arah = "naik" if akhir > awal else ("turun" if akhir < awal else "tetap")
            catatan = (
                f"{len(titik)} versi tercatat. Opportunity Score {arah} "
                f"{abs(akhir - awal):.1f} poin dari versi pertama ke terakhir."
            )
        else:
            catatan = f"{len(titik)} versi tercatat, sebagian tanpa skor."
    else:
        catatan = (
            "Baru satu versi skor yang diterbitkan, jadi belum ada perubahan untuk "
            "ditampilkan. Riwayat ini terisi sendiri begitu pipeline menerbitkan "
            "versi berikutnya - tidak ada angka yang diperkirakan di sini."
        )

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
) -> DinamikaKawasan:
    """Sebaran churn dan komposisi kuadran satu kawasan.

    Yang dijanjikan tabel fitur adalah "pemantauan pergerakan churn rate dan
    dinamika kawasan sepanjang tahun". Sisi WAKTU-nya belum bisa dipenuhi -
    datanya satu versi - dan itu dikatakan lewat `catatan`, bukan disamarkan
    dengan sumbu bulan berisi angka yang sama diulang dua belas kali.

    Yang BISA dipenuhi sekarang dan benar-benar berguna: sebaran churn kawasan
    dengan ketiga persentilnya, berapa heksagon yang sudah melewati ambang
    waspada dan bahaya, dan komposisi kuadrannya. Ini angka yang sama yang
    dipakai RiskRadar untuk memutuskan peringatan per heksagon - di sini
    diringkas ke tingkat kawasan, tempat keputusan sewa sebenarnya diambil.
    """
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
        catatan=(
            "Sebaran ini potret versi skor yang sedang berlaku, bukan deret waktu. "
            "Basis data baru memuat satu versi penerbitan; sumbu waktunya terisi "
            "begitu pipeline menerbitkan versi berikutnya."
        ),
    )


# ===========================================================================
# Rekomendasi personal
# ===========================================================================
#
# BEDANYA DENGAN /skor/ranking, dan kenapa keduanya sama-sama ada.
#
# `/skor/ranking` memeringkat: semua orang melihat urutan yang sama, dan itu
# memang yang dibutuhkan untuk membaca sebuah kawasan. Endpoint ini
# MEREKOMENDASIKAN: ia menyaring menurut anggaran dan kawasan yang sudah
# dinyatakan seseorang, lalu menjelaskan tiap barisnya dengan angka lokasi itu
# sendiri.
#
# Yang TIDAK dilakukan di sini, dan tidak boleh: menghitung ulang skor. Urutan
# dasarnya tetap `opportunity_score` milik pipeline. Yang ditambahkan cuma
# saringan dan alasan - aturan 1 repo ini tetap utuh.

#: Ambang untuk menyusun kalimat alasan. Semuanya AMBANG PENJELASAN, bukan
#: ambang kelolosan: tidak satu pun dari angka ini yang membuang sebuah lokasi
#: dari daftar. Yang membuang cuma ZoneGuard dan anggaran yang dinyatakan
#: penggunanya sendiri.
DEKAT_MENIT = 8.0
SEPI_KOMPETITOR = 5.0
CHURN_TENANG = 0.30


def _alasan_untuk(hx, sc, budget: int | None, p75: float | None) -> list[AlasanRekomendasi]:
    """Susun alasan dari angka heksagon ini. Tidak ada kalimat tanpa angka."""
    keluar: list[AlasanRekomendasi] = []

    if budget and hx.harga_sewa_median is not None and hx.harga_sewa_median <= budget:
        sisa = budget - hx.harga_sewa_median
        keluar.append(
            AlasanRekomendasi(
                kode="MUAT_ANGGARAN",
                teks=f"Sewa Rp{hx.harga_sewa_median:,.0f}/bln — masih Rp{sisa:,.0f} di bawah anggaran Anda".replace(",", "."),
                nilai=hx.harga_sewa_median,
            )
        )

    if sc is not None and sc.kuadran == "HIDDEN_GEM":
        keluar.append(
            AlasanRekomendasi(
                kode="HIDDEN_GEM",
                teks="Hidden Gem: datanya bagus padahal tampilannya biasa — sewanya belum ikut naik",
                nilai=sc.hidden_gem_score,
            )
        )

    if hx.waktu_jalan_menit is not None and hx.waktu_jalan_menit <= DEKAT_MENIT:
        keluar.append(
            AlasanRekomendasi(
                kode="DEKAT_SIMPUL",
                teks=f"{hx.waktu_jalan_menit:.0f} menit jalan kaki ke simpul transit",
                nilai=hx.waktu_jalan_menit,
            )
        )

    # `kepadatan_poi_total > 0` adalah SYARAT, bukan kerapian. C01 bersumber
    # OpenStreetMap, dan nol di sana punya dua arti yang tidak bisa dibedakan
    # dari kolomnya: "tidak ada pesaing" dan "belum ada yang memetakan apa pun
    # di sini". Terukur 26 Agu 2026: 312 dari 708 heksagon ber-C01 nol, dan
    # sebarannya mengikuti kerapatan pemetaan OSM, bukan kerapatan usaha -
    # 97% heksagon Harjamukti versus 24% Dukuh Atas BNI.
    #
    # Kalau heksagonnya memuat SETIDAKNYA satu usaha terpetakan, peta tahu
    # sesuatu tentang tempat itu dan "sedikit pesaing sejenis" jadi temuan yang
    # sah. Kalau nol usaha sama sekali, yang kita punya bukan temuan melainkan
    # lubang - dan menyodorkannya sebagai alasan memilih lokasi persis
    # "Hidden Gem palsu" yang jadi alasan produk ini ada (aturan 4).
    if (
        hx.n_kompetitor_langsung is not None
        and hx.n_kompetitor_langsung <= SEPI_KOMPETITOR
        and (hx.kepadatan_poi_total or 0) > 0
    ):
        keluar.append(
            AlasanRekomendasi(
                kode="SEPI_PESAING",
                teks=f"Baru {hx.n_kompetitor_langsung:.0f} pesaing sejenis di heksagon ini",
                nilai=hx.n_kompetitor_langsung,
            )
        )

    if hx.belanja_per_jam is not None and hx.belanja_per_jam > 0:
        keluar.append(
            AlasanRekomendasi(
                kode="UANG_BERPINDAH",
                teks=f"Rp{hx.belanja_per_jam:,.0f} berpindah tangan tiap jam di sini".replace(",", "."),
                nilai=hx.belanja_per_jam,
            )
        )

    # --- Catatan: hal yang tetap harus diketahui walau lokasinya bagus ------
    if hx.indeks_churn is not None and p75 is not None and hx.indeks_churn >= p75:
        keluar.append(
            AlasanRekomendasi(
                kode="CHURN_TINGGI",
                teks="Pergantian usaha di sini termasuk tinggi untuk kawasannya — periksa kenapa",
                nilai=hx.indeks_churn,
                jenis="catatan",
            )
        )
    if hx.zona_izin_komersial is None:
        keluar.append(
            AlasanRekomendasi(
                kode="RDTR_KOSONG",
                teks="RDTR digitalnya belum ada — izinnya wajib dicek ke dinas sebelum menyewa",
                jenis="catatan",
            )
        )
    if hx.n_titik_misi is not None and hx.n_titik_misi < 10:
        keluar.append(
            AlasanRekomendasi(
                kode="DATA_TIPIS",
                teks=f"Baru {hx.n_titik_misi} titik survei — angkanya masih bisa bergeser",
                nilai=float(hx.n_titik_misi),
                jenis="catatan",
            )
        )
    return keluar


#: Berapa baris yang dilihat akun gratis. Bukan nol - rekomendasi adalah inti
#: produk ini, dan produk yang intinya tidak bisa dicicipi tidak pernah
#: meyakinkan siapa pun untuk membayar. Tiga cukup untuk membuktikan daftarnya
#: nyata dan beralasan, terlalu sedikit untuk dipakai memilih.
CICIP_GRATIS = 3


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
) -> HasilRekomendasi:
    """Daftar lokasi yang menjawab keadaan SATU orang.

    Butuh akun - tanpa preferensi tidak ada yang bisa dipersonalisasi, dan
    daftar "personal" yang sama untuk semua orang cuma peringkat dengan nama
    lain.

    Akun gratis menerima tiga teratas beserta seluruh alasannya, dan diberi
    tahu berapa banyak lagi yang cocok. Yang disembunyikan JUMLAHNYA, bukan
    keberadaannya - `total_cocok` selalu angka sebenarnya.

    ZoneGuard disaring, tanpa kecuali. Ini jalur rekomendasi paling langsung di
    seluruh produk: kalau ada satu tempat yang tidak boleh menyarankan zona
    terlarang, tempatnya di sini.
    """
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
        alasan = _alasan_untuk(hx, sc, anggaran, p75)
        cocok = [a for a in alasan if a.jenis == "cocok"]
        ringkas = (
            cocok[0].teks
            if cocok
            else "Skor peluangnya termasuk tertinggi di antara yang memenuhi kriteria Anda."
        )
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
                n_kompetitor_langsung=hx.n_kompetitor_langsung,
                indeks_churn=hx.indeks_churn,
                zoneguard=zoneguard(hx),
                risiko=peringatan_risiko(hx, p75, p90),
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
        bagian.append(f"sewa di bawah Rp{anggaran:,.0f}".replace(",", "."))

    if not bagian:
        catatan = (
            "Belum ada preferensi yang tersimpan, jadi daftar ini masih peringkat "
            "umum. Isi rencana usaha dan kawasan incaran di menu akun untuk "
            "membuatnya menjawab keadaan Anda."
        )
    elif not premium:
        catatan = (
            f"{total} lokasi memenuhi kriteria Anda. Tiga teratas ditampilkan; "
            f"sisanya terbuka untuk pelanggan Loconomics Premium."
        )
    else:
        catatan = f"{total} lokasi memenuhi kriteria Anda, diurutkan menurut Opportunity Score."

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
