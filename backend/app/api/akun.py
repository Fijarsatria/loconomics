"""Akun, langganan, token, pemantauan, dan Laporan Kelayakan.

Mesinnya ada di `app/core/akun.py`; yang di sini rutenya.

SATU HAL YANG PERLU DIBACA SEBELUM MENYUNTING BERKAS INI. Tidak ada uang
sungguhan yang berpindah di sini. `POST /akun/langganan` dan `POST
/akun/token/beli` langsung mengaktifkan tanpa memverifikasi pembayaran apa pun,
karena QRIS-nya memang belum terpasang. Itu keadaan yang DINYATAKAN - responsnya
membawa `metode_bayar: "demo"`, dan antarmuka menuliskannya di layar. Begitu
gerbang pembayaran sungguhan masuk, yang berubah cuma satu hal: kedua endpoint
ini berhenti mengaktifkan langsung dan mulai menunggu webhook. Bentuk tabelnya
sudah menyiapkan itu lewat `referensi_bayar`.

Jangan pernah membuat kedua endpoint ini terlihat seolah sudah memverifikasi
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
    BIAYA_TOKEN,
    PAKET_LANGGANAN,
    PAKET_TOKEN,
    PenggunaOpsional,
    PenggunaPremium,
    PenggunaWajib,
    buat_tiket,
    langganan_aktif,
    periksa_sandi,
    sudah_terbuka,
    ringkas_akun,
    sidik_sandi,
)
from app.core.database import get_db
from app.core.galat import (
    AkunSudahAda,
    KesalahanAPI,
    KredensialSalah,
    TidakDitemukan,
    TokenTidakCukup,
)
from app.models import (
    HexFeature,
    HexHourlyProfile,
    LocationScore,
    ScoreFactor,
    PremiumUnlock,
    Subscription,
    TokenLedger,
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
    MutasiTokenKeluar,
    PermintaanBeliToken,
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


@router.get("/paket", summary="Katalog langganan dan token")
def katalog() -> dict[str, Any]:
    """Publik. Harga harus bisa dilihat sebelum orang membuat akun."""
    return {
        "langganan": PAKET_LANGGANAN,
        "token": PAKET_TOKEN,
        "biaya_token": BIAYA_TOKEN,
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


def _catat_token(db: Session, user: User, jumlah: int, keperluan: str, catatan: str | None = None,
                 h3: str | None = None) -> None:
    """Tulis mutasi DAN saldo dalam satu transaksi.

    Keduanya harus berpindah bersama. Kalau tidak, saldo dan buku besarnya bisa
    berselisih - dan yang berselisih tanpa ada yang tahu adalah uang orang lain.
    """
    user.saldo_token += jumlah
    db.add(
        TokenLedger(
            user_id=user.id,
            jumlah=jumlah,
            keperluan=keperluan,
            catatan=catatan,
            h3_index=h3,
            saldo_sesudah=user.saldo_token,
        )
    )


@router.post("/token/beli", response_model=Akun, summary="Beli token analisis")
def beli_token(
    p: PermintaanBeliToken,
    user: PenggunaWajib,
    db: Annotated[Session, Depends(get_db)],
) -> Akun:
    paket = next((x for x in PAKET_TOKEN if x["kode"] == p.paket), None)
    if paket is None:
        raise TidakDitemukan(
            f"Paket token '{p.paket}' tidak dikenal.",
            {"paket_tersedia": [x["kode"] for x in PAKET_TOKEN]},
        )
    _catat_token(db, user, int(paket["token"]), "beli", f"Paket {paket['nama']} (demo)")
    db.commit()
    db.refresh(user)
    return Akun(**ringkas_akun(db, user))


@router.get("/token/riwayat", response_model=list[MutasiTokenKeluar], summary="Buku besar token")
def riwayat_token(
    user: PenggunaWajib, db: Annotated[Session, Depends(get_db)], limit: int = 50
) -> list[MutasiTokenKeluar]:
    baris = db.execute(
        select(TokenLedger)
        .where(TokenLedger.user_id == user.id)
        .order_by(TokenLedger.id.desc())
        .limit(min(max(limit, 1), 200))
    ).scalars().all()
    return [
        MutasiTokenKeluar(
            jumlah=b.jumlah,
            keperluan=b.keperluan,
            catatan=b.catatan,
            h3_index=b.h3_index,
            saldo_sesudah=b.saldo_sesudah,
            dibuat_pada=b.dibuat_pada,
        )
        for b in baris
    ]


# ---------------------------------------------------------------------------
# Membuka satu heksagon dengan token
# ---------------------------------------------------------------------------


@router.post("/buka/{h3_index}", response_model=Akun, summary="Buka satu heksagon dengan token")
def buka_heksagon(
    h3_index: str,
    user: PenggunaWajib,
    db: Annotated[Session, Depends(get_db)],
) -> Akun:
    """Belanjakan token untuk membuka satu heksagon selamanya.

    Idempoten: memanggilnya lagi untuk heksagon yang sama TIDAK memotong token
    kedua kalinya. Tanpa itu, satu klik ganda memakan dua token dan yang
    kehilangan tidak pernah tahu kenapa.
    """
    ambil_hex(db, h3_index)  # 404 kalau heksagonnya memang tidak ada

    if langganan_aktif(db, user) or sudah_terbuka(db, user, h3_index):
        return Akun(**ringkas_akun(db, user))

    biaya = BIAYA_TOKEN["detail"]
    if user.saldo_token < biaya:
        raise TokenTidakCukup(
            f"Butuh {biaya} token untuk membuka lokasi ini, saldo Anda {user.saldo_token}.",
            {"butuh": biaya, "saldo": user.saldo_token},
        )

    _catat_token(db, user, -biaya, "buka_detail", "Pembongkaran penuh 1 heksagon", h3_index)
    db.add(PremiumUnlock(user_id=user.id, h3_index=h3_index, jenis="detail"))
    try:
        db.commit()
    except IntegrityError:
        # Klik ganda yang lolos ke dua transaksi. Batalkan seluruhnya - termasuk
        # potongan tokennya - lalu laporkan keadaan apa adanya.
        db.rollback()
        db.refresh(user)
    return Akun(**ringkas_akun(db, user))


@router.get("/terbuka", summary="Heksagon yang sudah dibuka akun ini")
def daftar_terbuka(user: PenggunaWajib, db: Annotated[Session, Depends(get_db)]) -> list[str]:
    return list(
        db.execute(
            select(PremiumUnlock.h3_index).where(
                PremiumUnlock.user_id == user.id, PremiumUnlock.jenis == "detail"
            )
        ).scalars().all()
    )


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
)
def laporan_pdf(
    h3_index: str,
    user: PenggunaWajib,
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    """Dokumen resmi untuk pengajuan modal atau sewa.

    Berbayar - premium, atau 2 token. Token dipotong SESUDAH PDF-nya berhasil
    dirakit, bukan sebelum: kalau perakitannya gagal, yang mahal bukan
    kegagalannya melainkan token yang sudah hilang untuk berkas yang tidak
    pernah ada.

    Isinya membawa badge keyakinan di halaman pertama, bukan di catatan kaki.
    Dokumen ini dibuat untuk dibawa ke pemberi modal, dan angka yang berdiri
    tanpa keterangan seberapa tebal datanya adalah angka yang menyesatkan orang
    yang paling perlu tahu.
    """
    hx = ambil_hex(db, h3_index)
    premium = langganan_aktif(db, user) is not None
    sudah = sudah_terbuka(db, user, h3_index, "laporan")

    if not premium and not sudah:
        biaya = BIAYA_TOKEN["laporan"]
        if user.saldo_token < biaya:
            raise TokenTidakCukup(
                f"Laporan Kelayakan butuh {biaya} token, saldo Anda {user.saldo_token}.",
                {"butuh": biaya, "saldo": user.saldo_token},
            )

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

    if not premium and not sudah:
        _catat_token(
            db, user, -BIAYA_TOKEN["laporan"], "laporan", "Laporan Kelayakan PDF", h3_index
        )
        db.add(PremiumUnlock(user_id=user.id, h3_index=h3_index, jenis="laporan"))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()

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

    Premium saja, tanpa jalur token: token dibeli untuk membuka SATU lokasi,
    sedangkan yang ini menggabungkan beberapa. Menagihnya per lokasi akan
    membuat harga satu berkas bergantung pada berapa kolom yang kebetulan
    dipilih.
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
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    from app.core.aturan import ARTI_KODE, ARTI_VARIABEL, LABEL_KUADRAN, kode_lokasi
    from app.api.bersama import DIMENSI

    nama_lokasi = kode_lokasi(hx.h3_index, hx.kawasan)
    penyangga = io.BytesIO()
    dok = SimpleDocTemplate(
        penyangga, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
        title=f"Laporan Kelayakan {nama_lokasi}", author="Loconomics",
    )
    g = _gaya_pdf()
    isi: list[Any] = [
        Paragraph("Laporan Kelayakan Lokasi", g["h1"]),
        Paragraph(
            "Loconomics &mdash; Transit-oriented Retail Recommender &nbsp;·&nbsp; "
            "MAPID WebGIS Competition #2 2026",
            g["kecil"],
        ),
        Spacer(1, 9),
        Paragraph(
            f"<b>{nama_lokasi}</b> &nbsp;·&nbsp; {hx.kawasan} &nbsp;·&nbsp; "
            f"<font face='Courier' size='8'>{hx.h3_index}</font>",
            g["n"],
        ),
        Spacer(1, 8),
        _pita_keyakinan(keyakinan, dok.width, g, colors),
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
    isi += [Paragraph("2. Seberapa bagus lokasinya", g["h2"])]
    kuadran = (
        LABEL_KUADRAN.get(sc.kuadran, sc.kuadran) if sc and sc.kuadran else "belum ada data"
    )
    isi.append(_tabel([
        ["Opportunity Score (0-100)", _angka_id(sc.opportunity_score if sc else None, desimal=0)],
        ["Kelompok lokasi", kuadran],
        ["Peringkat", str(sc.peringkat) if sc and sc.peringkat else "belum ada data"],
        ["Skor hidden gem", _angka_id(sc.hidden_gem_score if sc else None)],
        ["Akses ke stasiun (IPT)", _angka_id(sc.ipt if sc else None)],
        ["Perputaran uang (IAE)", _angka_id(sc.iae if sc else None)],
        ["Ketatnya persaingan (IKP)", _angka_id(sc.ikp if sc else None) + "  — rendah lebih baik"],
        ["Biaya dan risiko (IBR)", _angka_id(sc.ibr if sc else None) + "  — rendah lebih baik"],
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
        baris = [
            [
                ARTI_KODE.get(f.kode_variabel, f.kode_variabel),
                (
                    "lebih tinggi daripada "
                    f"{f.persentil:.0f} dari 100 lokasi lain"
                    if f.persentil is not None
                    else "belum ada pembanding"
                ),
            ]
            for f in faktor[:8]
        ]
        isi.append(_tabel(baris, dok.width, colors))

    # --- 5. Kapan ramainya ---------------------------------------------------
    if jam:
        isi += [Paragraph("5. Kapan uang berpindah", g["h2"])]
        puncak = max(jam, key=lambda r: r.n_transaksi)
        total = sum(r.n_transaksi for r in jam)
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

    dok.build(isi)
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
    g = _gaya_pdf()

    nama = [kode_lokasi(b.h3_index, b.kawasan) for b in baris]
    isi: list[Any] = [
        Paragraph("Perbandingan Lokasi", g["h1"]),
        Paragraph(
            "Loconomics &mdash; Transit-oriented Retail Recommender &nbsp;·&nbsp; "
            + " vs ".join(nama),
            g["kecil"],
        ),
        Spacer(1, 10),
    ]

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
    dok.build(isi)
    return penyangga.getvalue()


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
