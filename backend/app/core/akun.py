"""Akun, sesi, dan tingkat langganan.

Satu berkas untuk seluruh urusan "siapa yang memanggil dan boleh apa". Rutenya
ada di `app/api/akun.py`; yang di sini adalah mesinnya, supaya modul API mana
pun bisa menuntut tingkat tertentu tanpa mengimpor modul API lain.

TIGA TINGKAT, dan perbedaan kedua dan ketiga yang paling sering salah dipahami:

    tamu     belum masuk sama sekali
    gratis   sudah masuk, TIDAK berlangganan
    premium  langganan aktif, atau akun bertanda `selamanya`

`gratis` TIDAK mendapat apa pun yang tidak didapat `tamu`. Masuk bukan cara
membuka fitur; berlangganan yang membukanya. Ini keputusan produk, bukan
kelalaian - pemiliknya menyatakannya eksplisit.

KENAPA TANPA PUSTAKA PIHAK KETIGA. Kata sandi disidik `hashlib.scrypt` dan
tiket sesi ditandatangani `hmac`, keduanya dari pustaka standar. Bukan karena
pustaka auth itu buruk, tetapi karena yang dibutuhkan di sini persis dua hal
itu, keduanya ada di stdlib, dan seluruhnya muat di satu layar yang bisa dibaca
juri. Tiket yang dihasilkan berbentuk sama dengan JWT HS256 - tiga bagian
base64url dipisah titik - hanya saja tanpa satu pun dependensi baru.

Yang TIDAK dilakukan di sini, sengaja:
  - tidak ada refresh token. Tiketnya berumur 30 hari dan diperiksa ke basis
    data setiap kali dipakai, jadi akun yang dicabut langsung kehilangan akses
    tanpa perlu daftar pencabutan tersendiri.
  - tidak ada penyimpanan sesi di server. Tiket menandatangani id akun saja;
    seluruh keadaan lain - tingkat, sisa token - dibaca segar dari basis data
    tiap permintaan. Tingkat yang basi adalah tingkat yang salah.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.galat import ButuhPremium, TidakTerautentikasi
from app.models import PremiumUnlock, Subscription, User

log = logging.getLogger("loconomics.akun")

Tingkat = Literal["tamu", "gratis", "premium"]

#: Umur tiket sesi. Panjang karena tiket ini bukan satu-satunya penjaga - status
#: akun tetap dibaca dari basis data tiap permintaan.
UMUR_TIKET = timedelta(days=30)

# Parameter scrypt. n=2**14 dengan r=8, p=1 adalah anjuran umum untuk login
# interaktif: sekitar 60-100 ms per verifikasi di mesin biasa. Cukup lambat
# untuk membuat penebakan massal mahal, cukup cepat untuk tidak terasa saat masuk.
_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1
_PANJANG_SIDIK = 32


# ---------------------------------------------------------------------------
# Katalog paket
# ---------------------------------------------------------------------------
#
# Harganya duduk di sini, bukan di `aturan.py`. Aturan.py memuat aturan TAMPILAN
# untuk skor; harga tidak menyentuh skor sama sekali. Dan tidak di frontend:
# harga yang bisa disunting dari peramban adalah harga yang bisa disunting oleh
# pembeli.
#
# Tangga harganya sengaja membuat langganan menang telak. 10 token seharga
# Rp20.000 hampir sama mahal dengan sebulan penuh Rp25.000, dan itu memang
# maksudnya: token untuk orang yang butuh satu-dua laporan dan tidak ingin
# berlangganan, langganan untuk semua orang lain. Tangga yang membuat token
# terlihat lebih hemat akan menghasilkan pelanggan yang membeli token terus.

HARGA_BULANAN_RP = 25_000

PAKET_LANGGANAN: list[dict[str, Any]] = [
    {
        "kode": "bulanan",
        "nama": "Premium Bulanan",
        "harga_rp": HARGA_BULANAN_RP,
        "satuan": "bulan",
        "hari": 30,
        "unggulan": True,
        "rincian": [
            "Seluruh 43 variabel pembentuk indeks",
            "Filter multi-kawasan serentak",
            "Komparasi berdampingan sampai 4 lokasi",
            "Pemantauan kawasan dan riwayat skor",
            "Unduh Laporan Kelayakan (PDF)",
        ],
    },
]

#: 1 token = 1 pembukaan penuh satu heksagon, ATAU 1 unduhan laporan.
BIAYA_TOKEN: dict[str, int] = {"detail": 1, "laporan": 2}

PAKET_TOKEN: list[dict[str, Any]] = [
    {"kode": "token_3", "nama": "Coba", "token": 3, "harga_rp": 9_000},
    {"kode": "token_10", "nama": "Hemat", "token": 10, "harga_rp": 20_000},
    {"kode": "token_25", "nama": "Pro", "token": 25, "harga_rp": 45_000},
]


# ---------------------------------------------------------------------------
# Kunci penandatangan
# ---------------------------------------------------------------------------


def _kunci() -> bytes:
    """Kunci HMAC untuk tiket sesi.

    Di produksi WAJIB dari environment: tanpa itu, siapa pun yang tahu cara
    turunannya dibuat bisa menempa tiket. Di pengembangan, ketiadaannya tidak
    boleh menghentikan `npm run dev`, jadi diturunkan dari connection string -
    stabil antar-restart (tiket tidak hangus tiap reload) dan tidak pernah sama
    antar-mesin.
    """
    if settings.auth_secret:
        return settings.auth_secret.encode()
    if settings.produksi:
        raise RuntimeError(
            "AUTH_SECRET wajib diisi di produksi. "
            "Buat dengan: python -c \"import secrets;print(secrets.token_urlsafe(48))\""
        )
    return hashlib.sha256(b"loconomics-dev|" + settings.database_url.encode()).digest()


# ---------------------------------------------------------------------------
# Kata sandi
# ---------------------------------------------------------------------------


def sidik_sandi(sandi: str) -> str:
    """`scrypt$garam$sidik`, keduanya base64url.

    Garam acak per akun. Dua orang dengan kata sandi sama menghasilkan dua sidik
    berbeda, jadi satu tabel pelangi tidak pernah membuka lebih dari satu akun.
    """
    garam = secrets.token_bytes(16)
    sidik = hashlib.scrypt(
        sandi.encode(), salt=garam, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=_PANJANG_SIDIK
    )
    return f"scrypt${_b64(garam)}${_b64(sidik)}"


def periksa_sandi(sandi: str, tersimpan: str | None) -> bool:
    """Bandingkan kata sandi dengan sidik tersimpan. Selalu waktu-tetap."""
    if not tersimpan:
        return False
    try:
        skema, garam_b64, sidik_b64 = tersimpan.split("$")
        if skema != "scrypt":
            return False
        garam = _nyah_b64(garam_b64)
        harapan = _nyah_b64(sidik_b64)
    except (ValueError, TypeError):
        return False
    coba = hashlib.scrypt(
        sandi.encode(), salt=garam, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=len(harapan)
    )
    # compare_digest, bukan ==. Perbandingan biasa berhenti di byte pertama yang
    # berbeda, dan selisih waktunya cukup untuk menebak sidik byte demi byte.
    return hmac.compare_digest(coba, harapan)


# ---------------------------------------------------------------------------
# Tiket sesi
# ---------------------------------------------------------------------------


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _nyah_b64(teks: str) -> bytes:
    return base64.urlsafe_b64decode(teks + "=" * (-len(teks) % 4))


def buat_tiket(user_id: int) -> str:
    """Tiket sesi bertanda tangan. Bentuknya JWT HS256."""
    kepala = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    sekarang = datetime.now(timezone.utc)
    isi = _b64(
        json.dumps(
            {
                "sub": str(user_id),
                "iat": int(sekarang.timestamp()),
                "exp": int((sekarang + UMUR_TIKET).timestamp()),
            },
            separators=(",", ":"),
        ).encode()
    )
    badan = f"{kepala}.{isi}"
    tanda = hmac.new(_kunci(), badan.encode(), hashlib.sha256).digest()
    return f"{badan}.{_b64(tanda)}"


def baca_tiket(tiket: str) -> int | None:
    """Id akun dari tiket yang sah, atau None.

    Mengembalikan None untuk SEMUA kegagalan - tanda tangan salah, kedaluwarsa,
    bentuk rusak. Pemanggil tidak perlu tahu bedanya, dan membedakannya di
    respons hanya memberi tahu penyerang seberapa dekat tebakannya.
    """
    try:
        kepala, isi, tanda = tiket.split(".")
    except ValueError:
        return None
    harapan = hmac.new(_kunci(), f"{kepala}.{isi}".encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(_nyah_b64(tanda), harapan):
        return None
    try:
        muatan = json.loads(_nyah_b64(isi))
        if muatan["exp"] < datetime.now(timezone.utc).timestamp():
            return None
        return int(muatan["sub"])
    except (ValueError, KeyError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Tingkat
# ---------------------------------------------------------------------------


def langganan_aktif(db: Session, user: User) -> Subscription | None:
    """Langganan yang masih berlaku, kalau ada.

    `selamanya` dipisahkan dari tanggal supaya akun pemilik tidak pernah bisa
    kedaluwarsa karena jam server meleset atau karena lupa diperpanjang saat
    demo berlangsung.
    """
    baris = db.execute(
        select(Subscription)
        .where(Subscription.user_id == user.id, Subscription.status == "aktif")
        .order_by(Subscription.berlaku_sampai.desc().nullsfirst())
    ).scalars().all()
    sekarang = datetime.now(timezone.utc)
    for s in baris:
        if s.selamanya:
            return s
        if s.berlaku_sampai and s.berlaku_sampai.replace(tzinfo=timezone.utc) > sekarang:
            return s
    return None


def sudah_terbuka(db: Session, user: User | None, h3: str, jenis: str = "detail") -> bool:
    """Apakah akun ini sudah pernah membayar token untuk heksagon ini.

    Duduk di core, bukan di api/akun.py, karena `hex.py` juga memanggilnya -
    dan modul API tidak pernah mengimpor menyamping ke modul API lain (lihat
    kepala `api/bersama.py`). Pelanggan premium tidak pernah sampai ke fungsi
    ini; pemanggilnya memeriksa langganan lebih dulu.
    """
    if user is None:
        return False
    return db.execute(
        select(PremiumUnlock.id).where(
            PremiumUnlock.user_id == user.id,
            PremiumUnlock.h3_index == h3,
            PremiumUnlock.jenis == jenis,
        )
    ).first() is not None


def tingkat(db: Session, user: User | None) -> Tingkat:
    if user is None:
        return "tamu"
    return "premium" if langganan_aktif(db, user) else "gratis"


def akses_penuh(db: Session, user: User | None, h3: str) -> bool:
    """Boleh melihat kedalaman penuh SATU heksagon ini?

    Dua jalan masuk dan hanya dua: langganan aktif, atau token yang pernah
    dibelanjakan untuk heksagon ini. Satu fungsi untuk keempat pintunya -
    detail, kartu harga, Commuter Clock, simulasi - supaya "sudah bayar satu
    lokasi" berarti hal yang sama di semua pintu, bukan di sebagian.
    """
    if user is None:
        return False
    return langganan_aktif(db, user) is not None or sudah_terbuka(db, user, h3)


def wajib_akses_penuh(db: Session, user: User | None, h3: str, fitur: str) -> None:
    """Lempar galat ber-kode kalau pemanggil belum boleh melihat `fitur`.

    Dua kode yang berbeda dan itu penting: 401 membuat frontend membuka dialog
    MASUK, 402 membuka dialog LANGGANAN. Menyatukannya memaksa frontend menebak
    dari teks pesan.
    """
    if user is None:
        raise TidakTerautentikasi(
            f"{fitur} bagian dari Loconomics Premium. Masuk dulu untuk membukanya."
        )
    if not akses_penuh(db, user, h3):
        raise ButuhPremium(
            f"{fitur} bagian dari Loconomics Premium — atau buka lokasi ini dengan token.",
            {"h3_index": h3},
        )


# ---------------------------------------------------------------------------
# Dependensi FastAPI
# ---------------------------------------------------------------------------


def _tiket_dari(request: Request) -> str | None:
    kepala = request.headers.get("Authorization", "")
    if kepala.startswith("Bearer "):
        return kepala[7:].strip() or None
    return None


def pengguna_opsional(
    request: Request, db: Annotated[Session, Depends(get_db)]
) -> User | None:
    """Pengguna kalau ada tiket sah, None kalau tidak. TIDAK pernah menolak.

    Ini bentuk yang dipakai endpoint yang melayani tamu maupun pelanggan dengan
    isi yang berbeda - dan itu sebagian besar endpoint di produk ini.
    """
    tiket = _tiket_dari(request)
    if not tiket:
        return None
    uid = baca_tiket(tiket)
    if uid is None:
        return None
    user = db.get(User, uid)
    if user is None or not user.aktif:
        return None
    return user


def wajib_pengguna(
    user: Annotated[User | None, Depends(pengguna_opsional)],
) -> User:
    if user is None:
        raise TidakTerautentikasi("Masuk dulu untuk memakai fitur ini.")
    return user


def wajib_premium(
    user: Annotated[User, Depends(wajib_pengguna)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    """Penjaga untuk endpoint yang isinya memang berbayar.

    Ditaruh sebagai dependensi, bukan sebagai `if` di dalam badan fungsi. Alasan
    yang sama dengan `saring_zoneguard()`: penjaga yang harus diingat untuk
    dipanggil adalah penjaga yang suatu saat lupa dipanggil. Sebagai dependensi
    ia ikut ke OpenAPI dan terlihat di /docs.
    """
    if not langganan_aktif(db, user):
        raise ButuhPremium(
            "Fitur ini bagian dari Loconomics Premium.",
            {"tingkat_sekarang": "gratis"},
        )
    return user


# Alias yang dipakai modul API supaya anotasinya pendek dan seragam.
PenggunaOpsional = Annotated[User | None, Depends(pengguna_opsional)]
PenggunaWajib = Annotated[User, Depends(wajib_pengguna)]
PenggunaPremium = Annotated[User, Depends(wajib_premium)]


def ringkas_akun(db: Session, user: User) -> dict[str, Any]:
    """Bentuk akun yang dikirim ke frontend. Tidak pernah memuat sidik sandi."""
    lang = langganan_aktif(db, user)
    try:
        preferensi = json.loads(user.preferensi) if user.preferensi else None
    except ValueError:
        # JSON rusak di basis data tidak boleh merobohkan seluruh /akun/saya.
        preferensi = None
    return {
        "id": user.id,
        "nama_pengguna": user.nama_pengguna,
        "email": user.email,
        "nama_tampilan": user.nama_tampilan,
        "peran": user.peran,
        "tingkat": "premium" if lang else "gratis",
        "saldo_token": user.saldo_token,
        "dibuat_pada": user.dibuat_pada,
        "preferensi": preferensi,
        "langganan": None
        if lang is None
        else {
            "paket": lang.paket,
            "selamanya": lang.selamanya,
            "berlaku_sampai": lang.berlaku_sampai,
            "dimulai_pada": lang.dimulai_pada,
        },
    }
