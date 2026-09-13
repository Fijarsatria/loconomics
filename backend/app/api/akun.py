"""Akun, langganan, pemantauan, dan Laporan Kelayakan.

Mesinnya ada di `app/core/akun.py`; yang di sini rutenya.

SATU HAL YANG PERLU DIBACA SEBELUM MENYUNTING BERKAS INI. Tidak ada uang
sungguhan yang berpindah di sini. `POST /akun/langganan` langsung mengaktifkan
tanpa memverifikasi pembayaran apa pun,
karena QRIS-nya memang belum terpasang. Itu keadaan yang DINYATAKAN - responsnya
membawa `metode_bayar: "demo"`, dan antarmuka menuliskannya di layar. Begitu
gerbang pembayaran sungguhan masuk, yang berubah cuma satu hal: endpoint itu
berhenti mengaktifkan langsung dan mulai menunggu webhook. Bentuk tabelnya
sudah menyiapkan itu lewat `referensi_bayar`.

Jangan pernah membuat endpoint ini terlihat seolah sudah memverifikasi
pembayaran. Layar berbayar palsu yang meyakinkan lebih buruk daripada layar
berbayar yang jujur mengaku demo.
"""

from __future__ import annotations

import io
import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, Response
import json

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.bersama import ambil_hex, badge, peringatan_risiko, persentil_churn, zoneguard
from app.core import batas
from app.core.akun import (
    PAKET_LANGGANAN,
    PenggunaOpsional,
    PenggunaPremium,
    PenggunaWajib,
    buat_tiket,
    langganan_aktif,
    periksa_sandi,
    ringkas_akun,
    sidik_sandi,
)
from app.core.database import get_db
from app.core.galat import (
    AkunSudahAda,
    KesalahanAPI,
    KredensialSalah,
    TidakDitemukan,
)
from app.models import (
    HexFeature,
    HexHourlyProfile,
    LocationScore,
    ScoreFactor,
    Subscription,
    User,
    WatchlistItem,
)
from app.core.aturan import kode_lokasi
from app.core.simulasi import JENIS_USAHA
from app.api.bersama import periksa_kawasan
from app.schemas import (
    Akun,
    PreferensiUsaha,
    ButirPantauan,
    PermintaanDaftar,
    PermintaanLangganan,
    PermintaanMasuk,
    PermintaanPantau,
    SesiAkun,
)

log = logging.getLogger("loconomics.akun")

router = APIRouter(prefix="/akun", tags=["akun"])

VERSI_BAKU = "baseline"


def _pemanggil(request: Request) -> str:
    return request.client.host if request.client else "-"


# ---------------------------------------------------------------------------
# Daftar dan masuk
# ---------------------------------------------------------------------------


@router.post("/daftar", response_model=SesiAkun, summary="Buat akun baru")
def daftar(
    p: PermintaanDaftar,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> SesiAkun:
    """Akun baru selalu lahir sebagai `gratis`.

    Tidak ada masa coba premium otomatis. Kalau ada, tingkat seseorang berubah
    sendiri di suatu tanggal tanpa ia melakukan apa pun - dan fitur yang tiba-tiba
    hilang terbaca sebagai kerusakan, bukan sebagai masa coba yang habis.
    """
    batas.periksa_laju(f"daftar:{_pemanggil(request)}")

    nama = p.nama_pengguna.strip()
    email = p.email.strip().lower()

    ada = db.execute(
        select(User).where((User.nama_pengguna == nama) | (User.email == email))
    ).scalar_one_or_none()
    if ada is not None:
        # Sengaja menyebut yang mana yang bentrok. Ini BUKAN kebocoran yang sama
        # dengan pada formulir masuk: di sini orangnya sedang mencoba memakai
        # nama itu, dan "sudah dipakai" adalah satu-satunya cara membuat ia bisa
        # memilih nama lain. Yang dijaga di formulir masuk justru sebaliknya.
        bentrok = "nama pengguna" if ada.nama_pengguna == nama else "surel"
        raise AkunSudahAda(
            f"{bentrok.capitalize()} itu sudah dipakai. Coba yang lain, atau masuk saja.",
            {"bentrok": "nama_pengguna" if ada.nama_pengguna == nama else "email"},
        )

    user = User(
        nama_pengguna=nama,
        email=email,
        sidik_sandi=sidik_sandi(p.sandi),
        nama_tampilan=(p.nama_tampilan or nama).strip()[:80],
        peran="pengguna",
        saldo_token=0,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # Dua pendaftaran serentak dengan nama sama: yang kalah mendarat di sini.
        # Pemeriksaan di atas mengurus kasus biasa; ini yang mengurus balapannya.
        db.rollback()
        raise AkunSudahAda("Nama pengguna atau surel itu baru saja dipakai. Coba lagi.")
    db.refresh(user)

    log.info("akun baru: %s (%s)", user.nama_pengguna, user.email)
    return SesiAkun(tiket=buat_tiket(user.id), akun=Akun(**ringkas_akun(db, user)))


@router.post("/masuk", response_model=SesiAkun, summary="Masuk dengan nama pengguna atau surel")
def masuk(
    p: PermintaanMasuk,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> SesiAkun:
    batas.periksa_laju(f"masuk:{_pemanggil(request)}")

    identitas = p.identitas.strip()
    user = db.execute(
        select(User).where(
            (User.nama_pengguna == identitas) | (User.email == identitas.lower())
        )
    ).scalar_one_or_none()

    # Sidik tetap diperiksa walau akunnya tidak ada, memakai sidik buangan yang
    # bentuknya sah. Tanpa ini, permintaan untuk akun yang tidak ada kembali
    # jauh lebih cepat daripada yang ada - dan selisih waktu itu sendiri sudah
    # menjawab "apakah surel ini terdaftar", persis yang pesan galatnya tolak
    # untuk jawab.
    tersimpan = user.sidik_sandi if user else _SIDIK_HANTU
    cocok = periksa_sandi(p.sandi, tersimpan)

    if not user or not cocok or not user.aktif:
        raise KredensialSalah("Nama pengguna, surel, atau kata sandinya tidak cocok.")

    user.terakhir_masuk = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    db.refresh(user)
    return SesiAkun(tiket=buat_tiket(user.id), akun=Akun(**ringkas_akun(db, user)))


#: Sidik untuk kata sandi acak yang tidak pernah dipakai siapa pun. Hanya ada
#: supaya jalur "akun tidak ada" memakan waktu yang sama dengan jalur biasa.
_SIDIK_HANTU = sidik_sandi("sidik-hantu-yang-tidak-pernah-cocok-dengan-apa-pun")


@router.get("/saya", response_model=Akun, summary="Akun yang sedang masuk")
def saya(user: PenggunaWajib, db: Annotated[Session, Depends(get_db)]) -> Akun:
    """Dipanggil frontend saat memuat, untuk memvalidasi tiket yang tersimpan.

    Tiket yang sudah kedaluwarsa atau akunnya dinonaktifkan mendarat di 401, dan
    frontend membuang tiketnya. Itu sebabnya tidak ada daftar pencabutan: setiap
    permintaan sudah menyentuh basis data.
    """
    return Akun(**ringkas_akun(db, user))


# ---------------------------------------------------------------------------
# Katalog dan pembayaran
# ---------------------------------------------------------------------------


@router.post("/preferensi", response_model=Akun, summary="Simpan preferensi usaha")
def simpan_preferensi(
    p: PreferensiUsaha,
    user: PenggunaWajib,
    db: Annotated[Session, Depends(get_db)],
) -> Akun:
    """Diisi saat onboarding premium; boleh diubah kapan saja.

    Yang divalidasi keras hanya dua hal yang dipakai bercabang di tempat lain:
    jenis usaha harus salah satu dari katalog simulasi (ia jadi bawaan panel
    simulasi), dan kawasan harus salah satu dari enam pilot (ia menyetel
    saringan peta). Budget bebas - ia cuma ditampilkan kembali ke pemiliknya.
    """
    if p.jenis_usaha is not None and p.jenis_usaha not in JENIS_USAHA:
        raise TidakDitemukan(
            f"Jenis usaha '{p.jenis_usaha}' tidak dikenal.",
            {"tersedia": sorted(JENIS_USAHA)},
        )
    kawasan = periksa_kawasan(p.kawasan) if p.kawasan else None

    user.preferensi = json.dumps(
        {
            "jenis_usaha": p.jenis_usaha,
            "kawasan": kawasan,
            "budget_sewa_bulanan": p.budget_sewa_bulanan,
        }
    )
    db.commit()
    db.refresh(user)
    return Akun(**ringkas_akun(db, user))


@router.get("/paket", summary="Katalog langganan")
def katalog() -> dict[str, Any]:
    """Publik. Harga harus bisa dilihat sebelum orang membuat akun."""
    return {
        "langganan": PAKET_LANGGANAN,
        "mata_uang": "IDR",
        # Dibaca antarmuka untuk menuliskan keadaan pembayaran apa adanya.
        "pembayaran_aktif": False,
        "catatan_pembayaran": (
            "Gerbang pembayaran QRIS belum terpasang. Aktivasi di lingkungan ini "
            "berjalan langsung tanpa transaksi sungguhan."
        ),
    }


@router.post("/langganan", response_model=Akun, summary="Aktifkan Loconomics Premium")
def berlangganan(
    p: PermintaanLangganan,
    user: PenggunaWajib,
    db: Annotated[Session, Depends(get_db)],
) -> Akun:
    paket = next((x for x in PAKET_LANGGANAN if x["kode"] == p.paket), None)
    if paket is None:
        raise TidakDitemukan(
            f"Paket '{p.paket}' tidak dikenal.",
            {"paket_tersedia": [x["kode"] for x in PAKET_LANGGANAN]},
        )

    sekarang = datetime.now(timezone.utc).replace(tzinfo=None)
    # Perpanjangan menumpuk dari SISA yang masih ada, bukan dari hari ini.
    # Berlangganan lagi di hari ke-3 tidak boleh menghanguskan 27 hari sisanya.
    berjalan = langganan_aktif(db, user)
    mulai = sekarang
    if berjalan and berjalan.berlaku_sampai and berjalan.berlaku_sampai > sekarang:
        mulai = berjalan.berlaku_sampai
        berjalan.status = "diperpanjang"

    db.add(
        Subscription(
            user_id=user.id,
            paket=paket["kode"],
            status="aktif",
            selamanya=False,
            harga_rp=paket["harga_rp"],
            dimulai_pada=sekarang,
            berlaku_sampai=mulai + timedelta(days=int(paket["hari"])),
            metode_bayar="demo",
        )
    )
    db.commit()
    db.refresh(user)
    log.info("langganan aktif: %s paket=%s", user.nama_pengguna, paket["kode"])
    return Akun(**ringkas_akun(db, user))


# ---------------------------------------------------------------------------
# Pemantauan
# ---------------------------------------------------------------------------


@router.get("/pantauan", response_model=list[ButirPantauan], summary="Daftar pantauan")
def daftar_pantauan(
    user: PenggunaWajib, db: Annotated[Session, Depends(get_db)]
) -> list[ButirPantauan]:
    """Selisih dihitung terhadap angka yang DIBEKUKAN saat mulai memantau.

    Bukan terhadap angka yang dihitung ulang sekarang. Bedanya penting: yang
    pertama melaporkan perubahan yang sungguh terjadi, yang kedua selalu
    melaporkan nol dan terlihat seperti fitur yang bekerja.
    """
    butir = db.execute(
        select(WatchlistItem)
        .where(WatchlistItem.user_id == user.id)
        .order_by(WatchlistItem.id.desc())
    ).scalars().all()
    if not butir:
        return []

    ids = [b.h3_index for b in butir]
    sekarang = {
        r.HexFeature.h3_index: r
        for r in db.execute(
            select(
                HexFeature,
                LocationScore,
                func.ST_Y(func.ST_Centroid(HexFeature.geom)).label("lat"),
                func.ST_X(func.ST_Centroid(HexFeature.geom)).label("lon"),
            )
            .join(
                LocationScore,
                (LocationScore.h3_index == HexFeature.h3_index)
                & (LocationScore.versi == VERSI_BAKU),
                isouter=True,
            )
            .where(HexFeature.h3_index.in_(ids))
        ).all()
    }

    keluar: list[ButirPantauan] = []
    for b in butir:
        r = sekarang.get(b.h3_index)
        hx = r.HexFeature if r else None
        sc = r.LocationScore if r else None
        skor_kini = sc.opportunity_score if sc else None
        selisih = (
            round(skor_kini - b.skor_saat_dipantau, 2)
            if skor_kini is not None and b.skor_saat_dipantau is not None
            else None
        )
        risiko = None
        if hx is not None:
            p75, p90 = persentil_churn(db, hx.kawasan)
            risiko = peringatan_risiko(hx, p75, p90).tingkat
        keluar.append(
            ButirPantauan(
                h3_index=b.h3_index,
                kawasan=hx.kawasan if hx else None,
                lat=r.lat if r else None,
                lon=r.lon if r else None,
                catatan=b.catatan,
                skor_saat_dipantau=b.skor_saat_dipantau,
                skor_sekarang=skor_kini,
                selisih=selisih,
                versi_saat_dipantau=b.versi_saat_dipantau,
                versi_sekarang=VERSI_BAKU,
                kuadran=sc.kuadran if sc else None,
                risiko=risiko,
                dibuat_pada=b.dibuat_pada,
            )
        )
    return keluar


@router.post("/pantauan", response_model=ButirPantauan, summary="Tambah ke pantauan")
def tambah_pantauan(
    p: PermintaanPantau,
    user: PenggunaWajib,
    db: Annotated[Session, Depends(get_db)],
) -> ButirPantauan:
    hx = ambil_hex(db, p.h3_index)
    sc = db.execute(
        select(LocationScore).where(
            LocationScore.h3_index == p.h3_index, LocationScore.versi == VERSI_BAKU
        )
    ).scalar_one_or_none()

    ada = db.execute(
        select(WatchlistItem).where(
            WatchlistItem.user_id == user.id, WatchlistItem.h3_index == p.h3_index
        )
    ).scalar_one_or_none()
    if ada is None:
        ada = WatchlistItem(
            user_id=user.id,
            h3_index=p.h3_index,
            catatan=p.catatan,
            skor_saat_dipantau=sc.opportunity_score if sc else None,
            versi_saat_dipantau=VERSI_BAKU,
        )
        db.add(ada)
        db.commit()
        db.refresh(ada)
    elif p.catatan is not None:
        ada.catatan = p.catatan
        db.commit()
        db.refresh(ada)

    p75, p90 = persentil_churn(db, hx.kawasan)
    # lat/lon ikut di sini juga, bukan cuma di GET. Frontend menggambar pin dari
    # jawaban ini segera sesudah menyimpan; kalau kosong, pin baru muncul di
    # pemuatan berikutnya - dan pin yang menunggu muat ulang bukan fitur.
    titik = db.execute(
        select(
            func.ST_Y(func.ST_Centroid(HexFeature.geom)),
            func.ST_X(func.ST_Centroid(HexFeature.geom)),
        ).where(HexFeature.h3_index == p.h3_index)
    ).one_or_none()
    return ButirPantauan(
        h3_index=ada.h3_index,
        kawasan=hx.kawasan,
        lat=titik[0] if titik else None,
        lon=titik[1] if titik else None,
        catatan=ada.catatan,
        skor_saat_dipantau=ada.skor_saat_dipantau,
        skor_sekarang=sc.opportunity_score if sc else None,
        selisih=0.0 if sc and ada.skor_saat_dipantau is not None else None,
        versi_saat_dipantau=ada.versi_saat_dipantau,
        versi_sekarang=VERSI_BAKU,
        kuadran=sc.kuadran if sc else None,
        risiko=peringatan_risiko(hx, p75, p90).tingkat,
        dibuat_pada=ada.dibuat_pada,
    )


@router.delete("/pantauan/{h3_index}", summary="Hapus dari pantauan")
def hapus_pantauan(
    h3_index: str, user: PenggunaWajib, db: Annotated[Session, Depends(get_db)]
) -> dict[str, Any]:
    db.execute(
        delete(WatchlistItem).where(
            WatchlistItem.user_id == user.id, WatchlistItem.h3_index == h3_index
        )
    )
    db.commit()
    return {"dihapus": h3_index}


# ---------------------------------------------------------------------------
# Laporan Kelayakan (PDF)
# ---------------------------------------------------------------------------
@router.get(
    "/laporan/{h3_index}",
    summary="Unduh Laporan Kelayakan satu lokasi (PDF)",
    response_class=Response,
    # Lihat `core/batas.py::penjaga_berat` - jatah CPU harian Azure F1, bukan uang.
    dependencies=[Depends(batas.penjaga_berat)],
)
def laporan_pdf(
    h3_index: str,
    user: PenggunaPremium,
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    """Dokumen resmi untuk pengajuan modal atau sewa.

    Premium saja, lewat dependensi `PenggunaPremium` - bukan `if` di badan
    fungsi. Jalur token satuan dihapus 13 Sep 2026 atas permintaan pemilik
    repo; lihat `core/akun.py::akses_penuh`.

    Isinya membawa badge keyakinan di halaman pertama, bukan di catatan kaki.
    Dokumen ini dibuat untuk dibawa ke pemberi modal, dan angka yang berdiri
    tanpa keterangan seberapa tebal datanya adalah angka yang menyesatkan orang
    yang paling perlu tahu.
    """
    hx = ambil_hex(db, h3_index)

    sc = db.execute(
        select(LocationScore).where(
            LocationScore.h3_index == h3_index, LocationScore.versi == VERSI_BAKU
        )
    ).scalar_one_or_none()
    # Rincian faktor dan profil jam ikut masuk laporan. Keduanya justru bagian
    # yang paling dicari pemberi modal: bukan "skornya 78", melainkan KENAPA 78
    # dan KAPAN uangnya berpindah.
    faktor = db.execute(
        select(ScoreFactor)
        .where(ScoreFactor.h3_index == h3_index, ScoreFactor.versi == VERSI_BAKU)
        .order_by(ScoreFactor.kontribusi.desc().nullslast())
    ).scalars().all()
    jam = db.execute(
        select(HexHourlyProfile)
        .where(HexHourlyProfile.h3_index == h3_index, HexHourlyProfile.n_transaksi > 0)
        .order_by(HexHourlyProfile.jam)
    ).scalars().all()
    p75, p90 = persentil_churn(db, hx.kawasan)

    try:
        isi = _rakit_pdf(
            hx,
            sc,
            zoneguard(hx),
            peringatan_risiko(hx, p75, p90),
            badge(hx),
            user,
            faktor=faktor,
            jam=jam,
        )
    except KesalahanAPI:
        raise
    except Exception:
        log.exception("perakitan PDF gagal untuk %s", h3_index)
        raise

    nama = f"Laporan-{kode_lokasi(hx.h3_index, hx.kawasan).replace(' ', '-')}.pdf"
    return Response(
        content=isi,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{nama}"'},
    )


@router.get(
    "/laporan-komparasi",
    summary="Unduh perbandingan 2-4 lokasi (PDF, Premium)",
    response_class=Response,
    dependencies=[Depends(batas.penjaga_berat)],
)
def laporan_komparasi(
    pengguna: PenggunaPremium,
    db: Annotated[Session, Depends(get_db)],
    h3: Annotated[list[str], Query(description="Ulangi 2-4 kali: ?h3=...&h3=...")],
    versi: Annotated[str, Query()] = VERSI_BAKU,
) -> Response:
    """Tabel perbandingan berdampingan, siap dicetak.

    TIDAK menghitung ulang apa pun: ia memanggil endpoint komparasi yang sama
    dengan yang dipakai layar, lalu menyusun barisnya jadi PDF. Kalau angkanya
    dihitung ulang di sini, cepat atau lambat PDF dan layar akan menyebut dua
    angka berbeda untuk lokasi yang sama - dan yang dibawa orang ke pemberi
    modal justru PDF-nya.

    Premium saja.
    """
    from app.api.skor import komparasi as susun_komparasi

    hasil = susun_komparasi(pengguna=pengguna, db=db, h3=h3, versi=versi)
    try:
        isi = _rakit_pdf_komparasi(hasil.baris, pengguna)
    except KesalahanAPI:
        raise
    except Exception:
        log.exception("perakitan PDF komparasi gagal untuk %s", h3)
        raise

    return Response(
        content=isi,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="Perbandingan-{len(hasil.baris)}-lokasi.pdf"'
        },
    )



@router.get(
    "/laporan-simulasi/{h3_index}",
    summary="Unduh Laporan Simulasi Usaha satu lokasi (PDF)",
    response_class=Response,
    dependencies=[Depends(batas.penjaga_berat)],
)
def laporan_simulasi_pdf(
    h3_index: str,
    user: PenggunaWajib,
    db: Annotated[Session, Depends(get_db)],
    jenis_usaha: Annotated[str, Query()] = "kuliner_ringan",
    jam_buka: Annotated[int, Query(ge=1, le=24)] = 12,
    luas_m2: Annotated[int, Query(ge=1, le=500)] = 20,
    pangsa_persen: Annotated[float, Query(gt=0, le=100)] = 8.0,
    margin_persen: Annotated[float, Query(gt=0, le=100)] = 30.0,
    sewa_bulanan_diminta: Annotated[float | None, Query(ge=0, le=5_000_000_000)] = None,
    harga_rata_rata: Annotated[float | None, Query(ge=0, le=100_000_000)] = None,
    h3_blok: Annotated[str | None, Query()] = None,
) -> Response:
    """Rencana usaha satu halaman, siap dibawa ke pemberi modal.

    TIDAK menghitung ulang apa pun: ia memanggil `simulasi_heksagon` yang sama
    dengan yang dipakai layar, dengan parameter yang sama. Dua jalur yang
    menghitung sendiri-sendiri adalah dua jalur yang cepat atau lambat
    berselisih - dan yang berselisih di sini angka yang dibawa orang ke bank.

    Berbayar lewat penjaga yang sama dengan simulasinya sendiri: `wajib_akses_
    penuh` dipanggil di dalam `simulasi_heksagon`, jadi tidak ada pintu kedua
    yang bisa lupa dikunci.
    """
    from app.api.hex import simulasi_heksagon

    sim = simulasi_heksagon(
        h3_index, db, pengguna=user,
        jenis_usaha=jenis_usaha, jam_buka=jam_buka, luas_m2=luas_m2,
        pangsa_persen=pangsa_persen, margin_persen=margin_persen,
        sewa_bulanan_diminta=sewa_bulanan_diminta, harga_rata_rata=harga_rata_rata,
        h3_blok=h3_blok,
    )
    pdf = _rakit_pdf_simulasi(sim, user)
    nama = f"Simulasi-{h3_index}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{nama}"'},
    )


def _putusan_simulasi(sim) -> tuple[str, str, str]:
    """Kalimat putusan simulasi, dirakit dari hasilnya sendiri.

    Yang dinilai BUKAN skor lokasinya melainkan apakah rencananya menutup
    biayanya - dua pertanyaan berbeda yang sering dikira satu. Lokasi berskor
    90 dengan sewa yang terlalu mahal tetap rugi.
    """
    laba = sim.hasil.laba_kotor_bulanan
    rasio = sim.hasil.rasio_sewa_terhadap_omzet
    if laba is None:
        return (
            "Belum bisa dihitung",
            "Angka yang menyusun simulasi ini belum lengkap untuk lokasi tersebut. "
            "Yang kosong dibiarkan kosong, bukan ditebak.",
            "waspada",
        )
    if laba <= 0:
        return (
            "Rencana ini belum menutup biayanya",
            f"Dengan asumsi yang Anda isi, laba kotor bulanannya {_angka_id(laba, 'Rp', 0)} - "
            "artinya rugi. Naikkan pangsa, turunkan sewa, atau ubah jenis usahanya, lalu "
            "hitung lagi.",
            "bahaya",
        )
    if rasio is not None and rasio > 0.30:
        return (
            "Jalan, tetapi sewanya berat",
            f"Laba kotor {_angka_id(laba, 'Rp', 0)} per bulan, tetapi sewanya memakan "
            f"{_angka_id(rasio * 100, '%', 0)} dari omzet. Di atas 30% biasanya tidak "
            "menyisakan ruang untuk gaji dan bahan baku.",
            "waspada",
        )
    return (
        "Rencana ini masuk akal",
        f"Laba kotor {_angka_id(laba, 'Rp', 0)} per bulan"
        + (f", dengan sewa {_angka_id(rasio * 100, '%', 0)} dari omzet" if rasio is not None else "")
        + ". Angka di bawah memperlihatkan seberapa salah asumsinya boleh sebelum rugi.",
        "baik",
    )


def _rakit_pdf_simulasi(sim, user) -> bytes:
    """Laporan Simulasi Usaha - satu skenario, satu lokasi.

    Urutannya mengikuti pertanyaan yang benar-benar diajukan orang yang akan
    menyewa tempat: untung tidak, dari mana angkanya, seberapa salah asumsinya
    boleh, kapan ramainya, dan apa yang perlu diwaspadai.

    `sensitivitas` naik ke halaman depan sebagai KURVA, bukan tabel. Satu angka
    laba menjawab "kalau asumsinya benar"; kurva itu menjawab "seberapa salah
    asumsinya boleh sebelum rugi" - dan itu pertanyaan yang sebenarnya dibawa
    orangnya.
    """
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    from types import SimpleNamespace

    from app.core import laporan as lap
    from app.core.aturan import kode_lokasi

    nama_lokasi = kode_lokasi(sim.h3_index, sim.kawasan)
    penyangga = io.BytesIO()
    dok = SimpleDocTemplate(
        penyangga, pagesize=A4,
        leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=16 * mm,
        title=f"Simulasi Usaha {nama_lokasi}", author="Loconomics",
    )
    g = _gaya_pdf()
    gl = lap.gaya()
    h, m = sim.hasil, sim.masukan

    isi: list[Any] = [
        lap.kop(
            "Simulasi Usaha",
            f"{m.label_usaha} &nbsp;\u00b7&nbsp; {nama_lokasi} &nbsp;\u00b7&nbsp; {sim.kawasan}",
            dok.width, gl,
        ),
        Spacer(1, 10),
        lap.putusan(*_putusan_simulasi(sim), dok.width, gl),
        Spacer(1, 9),
        lap.kartu_angka(
            [
                ("Omzet per bulan", _angka_id(h.omzet_bulanan, "Rp", 0)),
                ("Sewa per bulan", _angka_id(h.sewa_bulanan, "Rp", 0)),
                ("Laba kotor per bulan", _angka_id(h.laba_kotor_bulanan, "Rp", 0)),
                ("Impas per hari", _angka_id(h.pembeli_impas_per_hari, "pembeli", 0)),
            ],
            dok.width, gl,
        ),
        Spacer(1, 10),
        _pita_keyakinan(sim.keyakinan, dok.width, g, colors),
        Spacer(1, 9),
    ]
    # Simulasi SATU BLOK dinyatakan di halaman pertama, dengan asumsinya.
    # Dokumen ini dibawa ke pemberi modal; omzet blok yang terbaca sebagai hasil
    # ukur per 130 m akan dipercaya lebih dari yang pantas.
    if sim.blok is not None:
        bk = sim.blok
        jalan = f" &middot; {bk.nama_jalan_utama}" if bk.nama_jalan_utama else ""
        faktor = (
            f"Permintaan heksagon dikali <b>{bk.faktor_permintaan:.2f}</b> "
            f"(skor blok {bk.skor_blok} dibanding rata-rata ketujuh blok {bk.rata_skor_heksagon})."
            if bk.faktor_berlaku
            else "Skor blok belum ada; angkanya sama dengan seluruh heksagon."
        )
        isi += [
            Paragraph(
                f"<b>Simulasi blok #{bk.peringkat or '?'}{jalan}</b> &mdash; {faktor} "
                "Asumsi: uang yang berputar diukur per heksagon, bukan per blok.",
                g["kecil"],
            ),
            Spacer(1, 8),
        ]

    # --- Ke mana omzetnya pergi ---------------------------------------------
    if h.omzet_bulanan:
        sewa = max(0.0, h.sewa_bulanan or 0)
        laba = h.laba_kotor_bulanan or 0.0
        if laba > 0:
            # Untung: omzet DIBEDAH jadi bagian-bagiannya. Batang bertumpuk
            # benar di sini karena ketiganya memang menjumlah ke omzetnya.
            sisa = max(0.0, h.omzet_bulanan - sewa - laba)
            isi += [
                Paragraph("1. Ke mana omzetnya pergi", g["h2"]),
                lap.bar_tumpuk(
                    [
                        ("Bahan & biaya lain", sisa, colors.HexColor("#cfdad6")),
                        ("Sewa", sewa, colors.HexColor("#E58A00")),
                        ("Laba kotor", laba, lap.TEAL_TUA),
                    ],
                    dok.width,
                ),
                Spacer(1, 4),
                Paragraph(
                    f"<font color='#8a9490'>\u25a0</font> Bahan &amp; biaya lain "
                    f"{_angka_id(sisa, 'Rp', 0)} &nbsp;&nbsp; "
                    f"<font color='#E58A00'>\u25a0</font> Sewa {_angka_id(sewa, 'Rp', 0)} &nbsp;&nbsp; "
                    f"<font color='#12836C'>\u25a0</font> Laba kotor {_angka_id(laba, 'Rp', 0)}",
                    g["kecil"],
                ),
            ]
        else:
            # RUGI: batang bertumpuk tidak boleh dipakai di sini. Ia menormalkan
            # totalnya jadi 100%, jadi sewa yang tiga kali omzet tergambar
            # sebagai "seluruh omzet habis untuk sewa" - pernyataan yang jauh
            # lebih ringan daripada keadaannya. Dua batang pada SKALA YANG SAMA
            # menyatakan selisihnya apa adanya.
            isi += [
                Paragraph("1. Omzet tidak menutup sewanya", g["h2"]),
                lap.bar_banding(
                    [
                        ("Omzet per bulan", h.omzet_bulanan, lap.TEAL_TUA),
                        ("Sewa per bulan", sewa, colors.HexColor("#B01B1B")),
                    ],
                    dok.width,
                ),
                Spacer(1, 3),
                Paragraph(
                    f"<font color='#12836C'>\u25a0</font> Omzet {_angka_id(h.omzet_bulanan, 'Rp', 0)}"
                    f" &nbsp;&nbsp; <font color='#B01B1B'>\u25a0</font> Sewa {_angka_id(sewa, 'Rp', 0)}"
                    f" &nbsp;&nbsp; kurang {_angka_id(sewa - h.omzet_bulanan, 'Rp', 0)} per bulan",
                    g["kecil"],
                ),
            ]

    # --- Asumsi ------------------------------------------------------------
    isi += [
        Paragraph("2. Asumsi yang Anda isi", g["h2"]),
        _tabel([
            ["Jenis usaha", m.label_usaha],
            ["Jam buka per hari", _angka_id(m.jam_buka, "jam", 0)],
            ["Luas tempat", _angka_id(m.luas_m2, "m2", 0)],
            ["Pangsa pasar yang diasumsikan", _angka_id(m.pangsa_persen, "%", 1)],
            ["Margin kotor", _angka_id(m.margin_persen, "%", 0)],
            ["Hari buka per bulan", _angka_id(m.hari_per_bulan, "hari", 0)],
            ["Sewa yang diminta pemilik", _angka_id(m.sewa_bulanan_diminta, "Rp", 0)],
        ], dok.width, colors),
    ]

    # --- Angka yang DIUKUR, bukan diisi -------------------------------------
    tu = sim.terukur
    isi += [
        Paragraph("3. Angka lokasi yang dipakai", g["h2"]),
        Paragraph(
            "Yang di bawah ini datang dari basis data, bukan dari isian Anda. "
            "Kosong berarti belum terukur di lokasi ini - tidak pernah diganti nol.",
            g["kecil"],
        ),
        Spacer(1, 3),
        _tabel([
            ["Uang berpindah per jam", _angka_id(tu.belanja_per_jam, "Rp", 0)],
            ["Belanja per struk", _angka_id(tu.nominal_median_struk, "Rp", 0)],
            ["Harga rata-rata per porsi", _angka_id(tu.harga_median_porsi, "Rp", 0)],
            ["Sewa per m2 per bulan", _angka_id(tu.harga_sewa_per_m2, "Rp", 0)],
            ["Ketatnya persaingan", _angka_id(tu.indeks_kompetisi)],
            ["Pergantian usaha", _angka_id(tu.indeks_churn)],
        ], dok.width, colors),
    ]

    # --- Seberapa salah asumsinya boleh -------------------------------------
    if sim.sensitivitas:
        titik = [(t.pangsa_persen, t.laba_kotor_bulanan) for t in sim.sensitivitas]
        isi += [
            Paragraph("4. Seberapa salah asumsinya boleh", g["h2"]),
            Paragraph(
                "Laba kotor bulanan pada beberapa nilai pangsa pasar. Rumusnya sama; "
                "yang berubah cuma satu asumsi. Garis putus-putus adalah titik impas.",
                g["kecil"],
            ),
            Spacer(1, 4),
            lap.garis_sensitivitas(titik, dok.width),
            Spacer(1, 3),
            _tabel(
                [[f"Pangsa {_angka_id(t.pangsa_persen, '%', 1)}",
                  _angka_id(t.laba_kotor_bulanan, "Rp", 0)] for t in sim.sensitivitas],
                dok.width, colors,
            ),
        ]

    # --- Kapan ramainya ------------------------------------------------------
    if sim.profil_jam:
        isi += [
            Paragraph("5. Kapan ramainya", g["h2"]),
            # `_grafik_jam` menuntut objek ber-`.jam` dan `.n_transaksi`;
            # `profil_jam` simulasi membawa `.relatif` (0-1, dinormalkan ke jam
            # tersibuk). Dijembatani di sini alih-alih melonggarkan grafiknya:
            # grafik yang menerima dua bentuk masukan adalah grafik yang suatu
            # saat menggambar salah satunya dengan skala yang salah.
            _grafik_jam(
                [SimpleNamespace(jam=j.jam, n_transaksi=j.relatif) for j in sim.profil_jam],
                dok.width,
            ),
        ]
        if sim.jam_teramai:
            isi.append(Paragraph(
                "Tiga jam teramai: "
                + ", ".join(f"{j:02d}.00" for j in sim.jam_teramai),
                g["kecil"],
            ))

    # --- Peringatan ----------------------------------------------------------
    if sim.peringatan:
        isi += [Paragraph("6. Yang perlu diwaspadai", g["h2"])]
        for p in sim.peringatan:
            isi.append(lap.putusan(
                p.tingkat.title(), p.pesan,
                {"BAHAYA": "bahaya", "WASPADA": "waspada"}.get(p.tingkat, "baik"),
                dok.width, gl,
            ))
            isi.append(Spacer(1, 4))

    # --- Rumusnya, apa adanya ------------------------------------------------
    if sim.rumus:
        isi += [
            Paragraph("7. Rumus yang dipakai", g["h2"]),
            Paragraph(
                "Dicetak apa adanya supaya angka di atas bisa dihitung ulang tangan. "
                "Tidak ada model tersembunyi di dalam simulasi ini.",
                g["kecil"],
            ),
            Spacer(1, 3),
            _tabel([[k, v] for k, v in sim.rumus.items()], dok.width, colors),
        ]

    isi += [
        Spacer(1, 10),
        Paragraph(
            "Simulasi ini BUKAN ramalan dan BUKAN skor. Ia satu skenario atas angka lokasi "
            "yang terukur; hasilnya tidak pernah disimpan, tidak memeringkat apa pun, dan "
            "tidak mengubah kuadran lokasi mana pun.",
            g["kecil"],
        ),
    ]

    from app.core.laporan import kaki

    dok.build(isi, onFirstPage=kaki, onLaterPages=kaki)
    return penyangga.getvalue()


def _angka_id(v, satuan: str = "", desimal: int = 2) -> str:
    """Angka bergaya Indonesia. Kosong TETAP kosong, tidak pernah jadi nol."""
    if v is None:
        return "belum ada data"
    if isinstance(v, bool):
        return "ya" if v else "tidak"
    if isinstance(v, str):
        return v
    teks = f"{v:,.{desimal}f}".replace(",", "~").replace(".", ",").replace("~", ".")
    return f"{teks} {satuan}".strip()


def _gaya_pdf():
    """Gaya paragraf yang dipakai kedua laporan. Satu tempat, bukan dua."""
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet

    dasar = getSampleStyleSheet()
    return {
        "h1": ParagraphStyle("h1", parent=dasar["Title"], fontSize=17, spaceAfter=2, alignment=0),
        "h2": ParagraphStyle(
            "h2", parent=dasar["Heading2"], fontSize=10.5, spaceBefore=11, spaceAfter=4,
            textColor=colors.HexColor("#0b3d37"),
        ),
        "n": ParagraphStyle("n", parent=dasar["Normal"], fontSize=9.4, leading=13.5),
        "kecil": ParagraphStyle(
            "kecil", parent=dasar["Normal"], fontSize=8.2, textColor=colors.HexColor("#5b6b68"),
        ),
    }


def _pita_keyakinan(keyakinan, lebar, gaya, colors):
    """Badge keyakinan sebagai pita lebar, di ATAS - bukan di catatan kaki.

    Dokumen ini dibawa ke pemberi modal, dan angka yang berdiri tanpa keterangan
    seberapa tebal datanya adalah angka yang menyesatkan orang yang paling perlu
    tahu.
    """
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Paragraph, Table, TableStyle

    warna = {
        "TINGGI": colors.HexColor("#1f8f7d"),
        "SEDANG": colors.HexColor("#b8860b"),
        "RENDAH": colors.HexColor("#b4483c"),
    }[keyakinan.tingkat]
    sumber = "hasil survei lapangan" if keyakinan.sumber == "observed" else "perkiraan model"
    t = Table(
        [[
            Paragraph(
                f"<b>Keyakinan data: {keyakinan.tingkat}</b> &nbsp; "
                f"{keyakinan.n_titik_misi} titik survei &nbsp;·&nbsp; {sumber}",
                ParagraphStyle("b", parent=gaya["n"], textColor=colors.white, fontSize=9),
            )
        ]],
        colWidths=[lebar],
    )
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), warna),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def _putusan_lokasi(zona, sc, keyakinan) -> tuple[str, str, str]:
    """Satu kalimat putusan untuk kepala Laporan Kelayakan.

    DIRAKIT dari angka, bukan ditulis tetap - jebakan nomor 7 di
    docs/jebakan.md: pemicu yang dihitung dari data dengan kalimat yang ditulis
    tetap akan berbohong untuk sebagian besar kasusnya.

    Urutan pemeriksaannya sama dengan urutan pertanyaan yang benar: boleh tidak
    dulu, baru bagus tidak. Lokasi yang zonanya melarang tidak perlu tahu
    skornya berapa.
    """
    if zona.status == "DILARANG":
        return (
            "Tidak bisa dipakai usaha",
            "Zonasi RDTR di lokasi ini melarang kegiatan usaha. Angka di bawah tetap "
            "dicetak untuk keperluan audit, tetapi tidak ada skor yang membatalkan "
            "larangan tata ruang.",
            "bahaya",
        )
    skor = sc.opportunity_score if sc else None
    if skor is None:
        return (
            "Belum bisa dinilai",
            "Lokasi ini belum punya Opportunity Score. Yang bisa dibaca dari dokumen ini "
            "hanya variabel mentahnya.",
            "waspada",
        )
    tipis = keyakinan.tingkat == "RENDAH"
    ekor = (
        " Datanya masih tipis, jadi baca angka ini sebagai arah - bukan sebagai kepastian."
        if tipis
        else ""
    )
    if skor >= 75:
        return (
            f"Layak dipertimbangkan serius — skor {skor:.0f} dari 100",
            "Lokasi ini berada di kelompok teratas wilayah studi. Yang tersisa memeriksa "
            "sewanya masuk akal dan sisi mana di dalam heksagonnya yang diambil." + ekor,
            "baik",
        )
    if skor >= 50:
        return (
            f"Bisa jalan, dengan syarat — skor {skor:.0f} dari 100",
            "Lokasi menengah. Ia bekerja kalau sewanya di bawah rata-rata kawasan atau "
            "jenis usahanya tidak berebut dengan pesaing yang sudah ada." + ekor,
            "waspada",
        )
    return (
        f"Berisiko — skor {skor:.0f} dari 100",
        "Lokasi ini di bawah kebanyakan lokasi lain di wilayah studi. Butuh alasan yang "
        "sangat kuat di luar data untuk tetap mengambilnya." + ekor,
        "bahaya",
    )


def _rakit_pdf(hx, sc, zona, risiko, keyakinan, user, faktor=None, jam=None) -> bytes:
    """Laporan Kelayakan satu lokasi.

    Sengaja tanpa gambar peta. Menyisipkan tangkapan peta berarti merender
    MapLibre di sisi server - satu peramban tanpa kepala di dalam kontainer API,
    untuk sebuah gambar yang tidak menambah satu pun angka yang bisa diaudit.
    Yang dibawa dokumen ini angka dan asalnya.

    Empat bagian, berurutan seperti pertanyaan yang benar-benar diajukan:
    boleh tidak, seberapa bagus, berapa biayanya, kenapa skornya segitu. Lalu
    seluruh 43 variabel sebagai lampiran, dalam bahasa orang - bukan nama kolom.
    """
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    from app.core.aturan import ARTI_KODE, ARTI_VARIABEL, LABEL_KUADRAN, kode_lokasi
    from app.api.bersama import DIMENSI

    nama_lokasi = kode_lokasi(hx.h3_index, hx.kawasan)
    penyangga = io.BytesIO()
    dok = SimpleDocTemplate(
        penyangga, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
        title=f"Laporan Kelayakan {nama_lokasi}", author="Loconomics",
    )
    from app.core import laporan as lap

    g = _gaya_pdf()
    gl = lap.gaya()
    skor_nilai = sc.opportunity_score if sc else None
    kuadran_kode = sc.kuadran if sc else None

    # Putusan di KEPALA dokumen, dirakit dari angka yang sama dengan yang
    # dicetak di bawahnya. Laporan yang menuntut pembacanya menyusun
    # kesimpulan sendiri dari empat tabel adalah laporan yang kesimpulannya
    # berbeda-beda menurut siapa yang membacanya.
    isi: list[Any] = [
        lap.kop(
            "Laporan Kelayakan Lokasi",
            f"{nama_lokasi} &nbsp;·&nbsp; {hx.kawasan} &nbsp;·&nbsp; "
            "MAPID WebGIS Competition #2 2026",
            dok.width, gl,
        ),
        Spacer(1, 10),
        lap.putusan(*_putusan_lokasi(zona, sc, keyakinan), dok.width, gl),
        Spacer(1, 9),
        lap.kartu_angka(
            [
                ("Opportunity Score", _angka_id(skor_nilai, desimal=0)),
                ("Peringkat wilayah", f"#{sc.peringkat}" if sc and sc.peringkat else "—"),
                ("Kelompok lokasi", LABEL_KUADRAN.get(kuadran_kode, "—") if kuadran_kode else "—"),
                ("Titik survei", str(keyakinan.n_titik_misi)),
            ],
            dok.width, gl,
        ),
        Spacer(1, 9),
        _pita_keyakinan(keyakinan, dok.width, g, colors),
        Spacer(1, 8),
        _profil_pengguna(user, hx, g, colors, dok.width),
        Spacer(1, 4),
    ]
    if keyakinan.tingkat == "RENDAH":
        isi.append(Paragraph(
            "<b>Perhatian.</b> Lokasi ini disurvei tipis. Angka di bawah tetap dihitung "
            "dengan metode yang sama, tetapi rentang kesalahannya lebar. Jangan dipakai "
            "sebagai dasar tunggal keputusan sewa.", g["kecil"]))

    # --- 1. Boleh tidak dipakai usaha ---------------------------------------
    isi += [Paragraph("1. Boleh tidak dipakai usaha", g["h2"])]
    isi.append(_tabel([
        ["Status zona (ZoneGuard)", zona.penjelasan],
        ["Jenis zona menurut aturan tata ruang", zona.kelas_zona or "belum ada data"],
        ["Pergantian usaha (RiskRadar)", f"{risiko.label} — indeks {_angka_id(risiko.indeks_churn)}"],
        ["Risiko banjir", _angka_id(hx.risiko_banjir)],
    ], dok.width, colors))

    # --- 2. Seberapa bagus lokasinya ----------------------------------------
    #
    # DIGAMBAR, bukan didaftar. Delapan baris angka desimal menuntut pembacanya
    # membandingkan sendiri "0,79" dengan "0,49"; delapan batang menjawabnya
    # sebelum angkanya sempat dibaca. Angkanya tetap ada di kolom kanan - yang
    # ditambahkan cuma cara memindainya.
    isi += [Paragraph("2. Seberapa bagus lokasinya", g["h2"])]
    kuadran = (
        LABEL_KUADRAN.get(sc.kuadran, sc.kuadran) if sc and sc.kuadran else "belum ada data"
    )
    kepala = Table(
        [[
            Paragraph(
                f"<font size=22><b>{_angka_id(sc.opportunity_score if sc else None, desimal=0)}</b></font>"
                "<font size=9 color='#5b6b68'> / 100</font><br/>"
                f"<font size=9 color='#5b6b68'>Opportunity Score"
                + (f" &nbsp;·&nbsp; peringkat {sc.peringkat}" if sc and sc.peringkat else "")
                + "</font>",
                g["n"],
            ),
            _kuadran_mini(sc.kuadran if sc else None),
            Paragraph(f"<b>{kuadran}</b><br/><font size=8 color='#5b6b68'>kelompok lokasi</font>", g["n"]),
        ]],
        colWidths=[dok.width * 0.42, dok.width * 0.18, dok.width * 0.40],
    )
    kepala.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    isi.append(kepala)
    isi.append(_tabel_bar([
        ("Akses ke stasiun (IPT)", sc.ipt if sc else None, 1, _angka_id(sc.ipt if sc else None), "tinggi"),
        ("Perputaran uang (IAE)", sc.iae if sc else None, 1, _angka_id(sc.iae if sc else None), "tinggi"),
        ("Ketatnya persaingan (IKP)", sc.ikp if sc else None, 1,
         _angka_id(sc.ikp if sc else None) + "  rendah = baik", "rendah"),
        ("Biaya dan risiko (IBR)", sc.ibr if sc else None, 1,
         _angka_id(sc.ibr if sc else None) + "  rendah = baik", "rendah"),
        ("Skor hidden gem", sc.hidden_gem_score if sc else None, 1,
         _angka_id(sc.hidden_gem_score if sc else None), "tinggi"),
    ], dok.width, colors))

    # --- 3. Biaya dan permintaan --------------------------------------------
    isi += [Paragraph("3. Biaya, permintaan, dan pesaing", g["h2"])]
    isi.append(_tabel([
        ["Sewa per m2 per bulan", _angka_id(hx.harga_sewa_per_m2, "Rp", 0)],
        ["Sewa per bulan", _angka_id(hx.harga_sewa_median, "Rp", 0)],
        ["Uang berpindah per jam", _angka_id(hx.belanja_per_jam, "Rp", 0)],
        ["Belanja per struk", _angka_id(hx.nominal_median_struk, "Rp", 0)],
        ["NJOP tanah", _angka_id(hx.njop_m2, "Rp/m2", 0)],
        ["Jalan kaki ke stasiun", _angka_id(hx.waktu_jalan_menit, "menit", 1)],
        ["Pesaing sejenis", _angka_id(hx.n_kompetitor_langsung, "tempat", 0)],
        ["Penduduk di sekitar", _angka_id(hx.pop_100m, "jiwa", 0)],
    ], dok.width, colors))

    # --- 4. Kenapa skornya segitu -------------------------------------------
    if faktor:
        isi += [Paragraph("4. Kenapa skornya segitu", g["h2"])]
        isi.append(Paragraph(
            "Posisi lokasi ini dibanding seluruh lokasi lain di wilayah studi. "
            "Batang penuh berarti tertinggi.", g["kecil"]))
        isi.append(Spacer(1, 3))
        isi.append(_tabel_bar([
            (
                ARTI_KODE.get(f.kode_variabel, f.kode_variabel),
                f.persentil,
                100,
                (f"persentil {f.persentil:.0f}" if f.persentil is not None else "belum ada pembanding"),
                "tinggi",
            )
            for f in faktor[:8]
        ], dok.width, colors))

    # --- 5. Kapan ramainya ---------------------------------------------------
    if jam:
        isi += [Paragraph("5. Kapan uang berpindah", g["h2"])]
        puncak = max(jam, key=lambda r: r.n_transaksi)
        total = sum(r.n_transaksi for r in jam)
        isi.append(Paragraph(
            "Delapan belas jam operasional, pukul 05.00 sampai 22.00. Jam tanpa "
            "transaksi digambar sebagai batang kosong, bukan dilewati &mdash; "
            "melewatinya membuat lokasi yang ramai tiga jam terlihat sama "
            "sibuknya dengan yang ramai dua belas jam.", g["kecil"]))
        isi.append(Spacer(1, 4))
        isi.append(_grafik_jam(jam, dok.width))
        isi.append(Spacer(1, 6))
        isi.append(_tabel([
            ["Jam paling ramai", f"pukul {puncak.jam:02d}.00"],
            ["Jam yang ada transaksinya", f"{len(jam)} dari 18 jam operasional"],
            ["Total transaksi tercatat", _angka_id(total, "", 0)],
        ], dok.width, colors))

    # --- Lampiran: seluruh 43 variabel, dalam bahasa orang -------------------
    isi += [Paragraph("Lampiran &mdash; seluruh 43 angka lokasi ini", g["h2"])]
    isi.append(Paragraph(
        "Nama variabel ditulis dalam bahasa sehari-hari. Kode di kurung adalah "
        "identitas resminya di Kamus Data, untuk yang ingin menelusuri.", g["kecil"]))
    isi.append(Spacer(1, 4))
    for dimensi, kolom in DIMENSI.items():
        baris = []
        for nama in kolom:
            kode, ramah, satuan = ARTI_VARIABEL[nama]
            baris.append([f"{ramah} ({kode})", _angka_id(getattr(hx, nama, None), satuan)])
        isi.append(Paragraph(f"<b>{dimensi.capitalize()}</b>", g["kecil"]))
        isi.append(_tabel(baris, dok.width, colors))
        isi.append(Spacer(1, 5))

    isi += [
        Spacer(1, 8),
        Paragraph(
            "Dokumen ini dihasilkan otomatis dari basis data Loconomics dan seluruh angkanya "
            "berasal dari pipeline skoring yang sama dengan yang tampil di peta. Tidak ada "
            "angka di dokumen ini yang disusun oleh model bahasa. Metode dan bobotnya "
            "terbuka di dokumentasi proyek.", g["kecil"]),
        Spacer(1, 5),
        Paragraph(
            f"Diterbitkan untuk <b>{user.nama_pengguna}</b> pada "
            f"{datetime.now().strftime('%d-%m-%Y %H:%M')} WIB &nbsp;·&nbsp; versi skor {VERSI_BAKU}",
            g["kecil"]),
    ]

    from app.core.laporan import kaki

    dok.build(isi, onFirstPage=kaki, onLaterPages=kaki)
    return penyangga.getvalue()


def _rakit_pdf_komparasi(baris, user) -> bytes:
    """Perbandingan 2-4 lokasi berdampingan.

    `baris` sudah berupa BarisKomparasi milik endpoint komparasi - jadi angka di
    PDF dan angka di layar berasal dari satu perhitungan yang sama, bukan dari
    dua kueri yang kebetulan mirip.
    """
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    from app.core.aturan import LABEL_KUADRAN, kode_lokasi

    penyangga = io.BytesIO()
    # Mendatar: empat kolom lokasi tidak pernah muat di A4 tegak tanpa
    # memampatkan angkanya jadi tidak terbaca.
    dok = SimpleDocTemplate(
        penyangga, pagesize=landscape(A4),
        leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
        title="Perbandingan Lokasi Loconomics", author="Loconomics",
    )
    from app.core import laporan as lap

    g = _gaya_pdf()
    gl = lap.gaya()

    nama = [kode_lokasi(b.h3_index, b.kawasan) for b in baris]
    # Pemenangnya disebut DI KEPALA, bukan ditinggalkan untuk disimpulkan
    # pembacanya dari tabel selebar empat kolom. Dirakit dari skor yang sama
    # dengan yang dicetak di tabel itu.
    berskor = [b for b in baris if b.opportunity_score is not None]
    juara = max(berskor, key=lambda b: b.opportunity_score) if berskor else None
    isi: list[Any] = [
        lap.kop(
            "Perbandingan Lokasi",
            " vs ".join(nama) + " &nbsp;·&nbsp; MAPID WebGIS Competition #2 2026",
            dok.width, gl,
        ),
        Spacer(1, 10),
    ]
    if juara is not None:
        selisih = sorted((b.opportunity_score for b in berskor), reverse=True)
        jarak_skor = (selisih[0] - selisih[1]) if len(selisih) > 1 else None
        isi.append(lap.putusan(
            f"Skor tertinggi: {kode_lokasi(juara.h3_index, juara.kawasan)} "
            f"({juara.opportunity_score:.0f} dari 100)",
            (
                f"Unggul {jarak_skor:.0f} poin dari yang kedua. "
                if jarak_skor is not None and jarak_skor >= 5
                else "Selisihnya tipis dengan yang kedua, jadi pembedanya ada di sewa dan izin. "
                if jarak_skor is not None
                else ""
            )
            + "Skor tertinggi bukan satu-satunya pertimbangan: baca juga kolom zona dan "
              "lencana keyakinan di bawah.",
            "baik" if (jarak_skor or 0) >= 5 else "waspada",
            dok.width, gl,
        ))
        isi.append(Spacer(1, 9))
        isi.append(lap.kartu_angka(
            [(kode_lokasi(b.h3_index, b.kawasan),
              f"{b.opportunity_score:.0f}" if b.opportunity_score is not None else "—")
             for b in baris],
            dok.width, gl,
        ))
    isi += [
        Spacer(1, 9),
        _profil_pengguna(user, None, g, colors, dok.width),
        Spacer(1, 10),
    ]

    # Batang skor berdampingan, DI ATAS tabelnya. Empat kolom angka menuntut
    # pembacanya memindai empat deret digit untuk menjawab satu pertanyaan yang
    # paling sering diajukan - "yang mana yang paling bagus".
    skor = [b.opportunity_score for b in baris]
    maks_skor = max([v for v in skor if v is not None] + [100])
    isi.append(_tabel_bar([
        (
            f"{i + 1}. {n}",
            b.opportunity_score,
            maks_skor,
            _angka_id(b.opportunity_score, "", 0),
            "tinggi",
        )
        for i, (n, b) in enumerate(zip(nama, baris))
    ], dok.width, colors))
    isi.append(Spacer(1, 12))

    def kolom(ambil, satuan="", desimal=2, arah=None):
        nilai = [ambil(b) for b in baris]
        angka = [v for v in nilai if isinstance(v, (int, float))]
        juara = None
        if arah and angka:
            juara = (max(angka) if arah == "tinggi" else min(angka))
        return [
            (
                _angka_id(v, satuan, desimal)
                + ("  *" if juara is not None and v == juara and len(angka) > 1 else "")
            )
            for v in nilai
        ]

    METRIK = [
        ("Opportunity Score (0-100)", lambda b: b.opportunity_score, "", 0, "tinggi"),
        ("Kelompok lokasi", lambda b: LABEL_KUADRAN.get(b.kuadran, b.kuadran), "", 0, None),
        ("Sewa per m2", lambda b: b.harga_sewa_per_m2, "Rp", 0, "rendah"),
        ("Uang berpindah per jam", lambda b: b.belanja_per_jam, "Rp", 0, "tinggi"),
        ("Pesaing sejenis", lambda b: b.n_kompetitor_langsung, "tempat", 0, "rendah"),
        ("Jalan kaki ke stasiun", lambda b: b.waktu_jalan_menit, "menit", 0, "rendah"),
        ("Keramaian sore", lambda b: b.puncak_sore, "", 2, "tinggi"),
        ("Penduduk sekitar", lambda b: b.pop_100m, "jiwa", 0, "tinggi"),
        ("Keramaian usaha", lambda b: b.kepadatan_poi_total, "tempat", 0, "tinggi"),
        ("Keragaman usaha", lambda b: b.keragaman_usaha, "", 2, "tinggi"),
        ("Pergantian usaha", lambda b: b.indeks_churn, "", 2, "rendah"),
        ("Sewa per bulan", lambda b: b.harga_sewa_median, "Rp", 0, "rendah"),
        ("Skor hidden gem", lambda b: b.hidden_gem_score, "", 2, "tinggi"),
        ("Akses ke stasiun (IPT)", lambda b: b.indeks.ipt, "", 2, "tinggi"),
        ("Perputaran uang (IAE)", lambda b: b.indeks.iae, "", 2, "tinggi"),
        ("Ketatnya persaingan (IKP)", lambda b: b.indeks.ikp, "", 2, "rendah"),
        ("Biaya dan risiko (IBR)", lambda b: b.indeks.ibr, "", 2, "rendah"),
        ("Status zona", lambda b: b.zoneguard.status.replace("_", " ").lower(), "", 0, None),
        ("Pergantian usaha", lambda b: b.risiko.label, "", 0, None),
        ("Keyakinan data", lambda b: f"{b.keyakinan.tingkat} ({b.keyakinan.n_titik_misi} titik)", "", 0, None),
    ]

    tabel = [["", *[f"{i + 1}. {n}" for i, n in enumerate(nama)]]]
    for label, ambil, satuan, desimal, arah in METRIK:
        tabel.append([label, *kolom(ambil, satuan, desimal, arah)])

    lebar_label = dok.width * 0.24
    lebar_kolom = (dok.width - lebar_label) / len(baris)
    t = Table(tabel, colWidths=[lebar_label, *([lebar_kolom] * len(baris))], repeatRows=1)
    t.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 8.6),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#5b6b68")),
        ("TEXTCOLOR", (1, 0), (-1, 0), colors.HexColor("#0b3d37")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, colors.HexColor("#dfe7e5")),
        ("LINEBELOW", (0, 0), (-1, 0), 0.9, colors.HexColor("#0b3d37")),
    ]))
    isi.append(t)

    isi += [
        Spacer(1, 10),
        Paragraph(
            "Tanda <b>*</b> menandai nilai terbaik pada baris itu, dan arahnya sudah "
            "diperhitungkan: untuk sewa, pesaing, waktu jalan, IKP, dan IBR yang terbaik "
            "adalah yang TERENDAH. Baris tanpa tanda berarti tidak ada yang bisa disebut "
            "menang - status zona dan tingkat keyakinan bukan angka yang bisa diurutkan.",
            g["kecil"]),
        Spacer(1, 5),
        Paragraph(
            "Lokasi berzona terlarang sengaja ikut ditampilkan. Ini alat perbandingan, "
            "bukan rekomendasi, dan alasan terkuat untuk tidak memilih sebuah lokasi tidak "
            "boleh disembunyikan.", g["kecil"]),
        Spacer(1, 5),
        Paragraph(
            f"Diterbitkan untuk <b>{user.nama_pengguna}</b> pada "
            f"{datetime.now().strftime('%d-%m-%Y %H:%M')} WIB &nbsp;·&nbsp; versi skor {VERSI_BAKU}",
            g["kecil"]),
    ]
    from app.core.laporan import kaki

    dok.build(isi, onFirstPage=kaki, onLaterPages=kaki)
    return penyangga.getvalue()


# ===========================================================================
# Gambar untuk laporan PDF
# ===========================================================================
#
# DIGAMBAR, bukan ditulis. Dokumen yang dibawa ke pemberi modal dibaca dalam
# hitungan menit, dan deret angka tidak bisa dipindai - satu batang yang lebih
# panjang daripada batang di sebelahnya bisa. Ketiga gambar di bawah memakai
# `reportlab.graphics` yang sudah ikut paket, bukan pustaka grafik tambahan:
# yang digambar cuma persegi panjang dan garis.
#
# Nol angka DIKARANG di sini. Tiap gambar menerima nilai yang sudah dihitung
# pipeline dan hanya memilih panjang batangnya.


def _bar(nilai, maks, lebar, tinggi=9, warna=None, latar=None):
    """Satu batang mendatar berskala. `nilai` None = batang kosong berarsir."""
    from reportlab.graphics.shapes import Drawing, Rect, String
    from reportlab.lib import colors as C

    warna = warna or C.HexColor("#1f8f7d")
    latar = latar or C.HexColor("#e7efed")
    d = Drawing(lebar, tinggi)
    d.add(Rect(0, 0, lebar, tinggi, fillColor=latar, strokeColor=None, rx=2, ry=2))
    if nilai is None or not maks:
        d.add(String(4, tinggi / 2 - 3, "belum ada data", fontSize=6.6,
                     fillColor=C.HexColor("#8a9a97")))
        return d
    p = max(0.0, min(1.0, float(nilai) / float(maks)))
    if p > 0:
        d.add(Rect(0, 0, max(2.0, lebar * p), tinggi, fillColor=warna, strokeColor=None,
                   rx=2, ry=2))
    return d


def _kuadran_mini(kuadran, lebar=54, tinggi=54):
    """Petak 2x2 dengan satu titik di kotak yang benar.

    Kuadran adalah tesis produk ini, dan satu kata ("Hidden Gem") tidak
    menyatakan DI MANA ia berdiri terhadap tiga kemungkinan lain. Petaknya
    menyatakannya tanpa satu kalimat pun.
    """
    from reportlab.graphics.shapes import Circle, Drawing, Rect, String
    from reportlab.lib import colors as C

    # [kolom, baris] - baris 0 di ATAS, sama dengan Kompas Kuadran di layar.
    SEL = {
        "HIDDEN_GEM": (0, 0),
        "PEMENANG_JELAS": (1, 0),
        "HINDARI": (0, 1),
        "JEBAKAN_GENGSI": (1, 1),
    }
    WARNA = {
        "HIDDEN_GEM": "#4C93F7",
        "PEMENANG_JELAS": "#15803D",
        "HINDARI": "#B01B1B",
        "JEBAKAN_GENGSI": "#E58A00",
    }
    d = Drawing(lebar, tinggi)
    sel_w, sel_h = lebar / 2, tinggi / 2
    for kx in range(2):
        for ky in range(2):
            d.add(Rect(kx * sel_w, tinggi - (ky + 1) * sel_h, sel_w, sel_h,
                       fillColor=C.HexColor("#f4f8f7"), strokeColor=C.HexColor("#dfe7e5"),
                       strokeWidth=0.6))
    if kuadran in SEL:
        kx, ky = SEL[kuadran]
        # Isian pucat dihitung sebagai CAMPURAN ke putih, bukan lewat alfa.
        # `HexColor("#4C93F722")` tanpa `hasAlpha=True` diurai sebagai bilangan
        # 32-bit dan menghasilkan warna yang sama sekali lain - petak Hidden Gem
        # yang biru tampil hijau menyala. Terlihat begitu di potret.
        dasar = C.HexColor(WARNA[kuadran])
        pucat = C.Color(
            dasar.red * 0.18 + 0.82,
            dasar.green * 0.18 + 0.82,
            dasar.blue * 0.18 + 0.82,
        )
        d.add(Rect(kx * sel_w, tinggi - (ky + 1) * sel_h, sel_w, sel_h,
                   fillColor=pucat, strokeColor=dasar, strokeWidth=1.2))
        d.add(Circle(kx * sel_w + sel_w / 2, tinggi - (ky + 1) * sel_h + sel_h / 2, 3.6,
                     fillColor=C.HexColor(WARNA[kuadran]), strokeColor=None))
    d.add(String(1, tinggi + 2.5, "bagus", fontSize=5.6, fillColor=C.HexColor("#8a9a97")))
    d.add(String(lebar - 22, -7.5, "kelihatan mahal", fontSize=5.6,
                 fillColor=C.HexColor("#8a9a97")))
    return d


def _grafik_jam(jam, lebar, tinggi=42):
    """Delapan belas batang: kapan uangnya berpindah.

    Jam yang TIDAK punya transaksi digambar sebagai batang nol, bukan dilewati.
    Melewatinya memampatkan sumbu waktu dan membuat toko yang ramai tiga jam
    terlihat sama sibuknya dengan toko yang ramai dua belas jam - jebakan yang
    sudah tercatat di repo ini.
    """
    from reportlab.graphics.shapes import Drawing, Rect, String
    from reportlab.lib import colors as C

    per = {r.jam: r.n_transaksi for r in jam}
    jam_urut = list(range(5, 23))
    maks = max([per.get(j, 0) for j in jam_urut] + [1])
    d = Drawing(lebar, tinggi + 9)
    w = lebar / len(jam_urut)
    for i, j in enumerate(jam_urut):
        n = per.get(j, 0)
        h = (n / maks) * tinggi
        d.add(Rect(i * w + 0.8, 9, w - 1.6, max(0.6, h),
                   fillColor=C.HexColor("#1f8f7d" if n else "#e7efed"), strokeColor=None))
        if j % 4 == 1:
            d.add(String(i * w, 1.5, f"{j:02d}", fontSize=5.8,
                         fillColor=C.HexColor("#8a9a97")))
    return d


def _profil_pengguna(user, hx, g, colors, lebar):
    """Siapa yang menerbitkannya, dan apa yang sedang ia cari.

    Ditambahkan 11 Sep 2026, permintaan pemilik repo. Bukan basa-basi: laporan
    kelayakan dibaca bersama orang lain - pemberi modal, mitra, keluarga - dan
    yang pertama ditanyakan pembaca kedua selalu "ini punya siapa, dan dia
    sedang cari apa". Preferensinya SUDAH ada di basis data sejak onboarding;
    yang belum ada cuma jalannya ke halaman pertama dokumen.

    Anggaran dibandingkan LANGSUNG dengan sewa lokasi ini. Angka yang berdiri
    sendirian menuntut pembacanya menghitung selisihnya sendiri, dan itu
    pekerjaan yang bisa dilakukan dokumen ini untuknya.
    """
    from reportlab.platypus import Paragraph, Table, TableStyle

    pref: dict[str, Any] = {}
    mentah = getattr(user, "preferensi", None)
    if mentah:
        try:
            pref = json.loads(mentah) if isinstance(mentah, str) else dict(mentah)
        except (ValueError, TypeError):
            pref = {}

    baris: list[str] = []
    jenis = pref.get("jenis_usaha")
    if jenis:
        # Nama yang dibaca orang, bukan kunci basis data. `kuliner_ringan` di
        # dokumen yang dibawa ke pemberi modal terbaca sebagai kebocoran nama
        # kolom - jebakan yang sudah tercatat empat kali di repo ini.
        from app.core.simulasi import JENIS_USAHA as _JENIS

        baris.append(f"Rencana usaha: <b>{_JENIS.get(jenis, {}).get('label', jenis)}</b>")
    if pref.get("kawasan"):
        baris.append(f"Kawasan incaran: <b>{pref['kawasan']}</b>")
    # Kuncinya `budget_sewa_bulanan` - nama yang dipakai `simpan_preferensi`.
    # Ditulis salah pada percobaan pertama (`anggaran_sewa`) dan gagalnya DIAM:
    # barisnya cuma tidak muncul, dan tidak ada satu pun galat.
    anggaran = pref.get("budget_sewa_bulanan")
    if isinstance(anggaran, (int, float)) and anggaran > 0:
        potong = f"Anggaran sewa: <b>{_angka_id(anggaran, 'Rp', 0)}</b> per bulan"
        sewa = hx.harga_sewa_median if hx is not None else None
        if isinstance(sewa, (int, float)):
            selisih = anggaran - sewa
            potong += (
                f" &mdash; sewa di sini {_angka_id(sewa, 'Rp', 0)}, "
                + ("<b>masuk anggaran</b>" if selisih >= 0 else "<b>di atas anggaran</b>")
                + f" ({_angka_id(abs(selisih), 'Rp', 0)})"
            )
        baris.append(potong)

    kiri = Paragraph(
        f"<b>Disusun untuk {user.nama_pengguna}</b>"
        + ("<br/>" + "<br/>".join(baris) if baris else
           "<br/>Preferensi usaha belum diisi &mdash; lengkapi di menu akun supaya "
           "laporan berikutnya bisa membandingkan angkanya dengan anggaran Anda."),
        g["n"],
    )
    t = Table([[kiri]], colWidths=[lebar])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f4f8f7")),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#dfe7e5")),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t


def _tabel_bar(baris, lebar, colors):
    """Tabel label - batang - nilai. Tiga kolom, dan yang tengah yang bekerja.

    `baris` = [(label, nilai, maks, teks, arah)] dengan arah 'tinggi' atau
    'rendah'; yang 'rendah' diberi warna berbeda supaya batang panjang tidak
    otomatis terbaca sebagai kabar baik.
    """
    from reportlab.platypus import Table, TableStyle
    from reportlab.lib import colors as C

    isi = []
    for label, nilai, maks, teks, arah in baris:
        warna = C.HexColor("#1f8f7d" if arah == "tinggi" else "#b8860b")
        isi.append([label, _bar(nilai, maks, lebar * 0.34, warna=warna), teks])
    t = Table(isi, colWidths=[lebar * 0.36, lebar * 0.36, lebar * 0.28])
    t.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 8.8),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#5b6b68")),
        ("TEXTCOLOR", (2, 0), (2, -1), colors.HexColor("#12211f")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (2, 0), (2, -1), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, colors.HexColor("#eef3f2")),
    ]))
    return t


def _tabel(baris: list[list[str]], lebar: float, colors) -> Any:
    from reportlab.platypus import Table, TableStyle

    t = Table(baris, colWidths=[lebar * 0.42, lebar * 0.58])
    t.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#5b6b68")),
        ("TEXTCOLOR", (1, 0), (1, -1), colors.HexColor("#12211f")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, colors.HexColor("#dfe7e5")),
    ]))
    return t
