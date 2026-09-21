"""Akun, sesi, dan tingkat langganan."""

from __future__ import annotations

import base64
import binascii
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
from app.models import Subscription, User

log = logging.getLogger("loconomics.akun")

Tingkat = Literal["tamu", "gratis", "premium"]

#: Umur tiket sesi. Panjang karena tiket ini bukan satu-satunya penjaga - status
#: akun tetap dibaca dari basis data tiap permintaan.
UMUR_TIKET = timedelta(days=30)

#: Panjang minimum AUTH_SECRET di produksi. Lihat `_kunci()` untuk alasannya.
PANJANG_MIN_KUNCI = 32

# Parameter scrypt. n=2**14 dengan r=8, p=1 adalah anjuran umum untuk login
# interaktif: sekitar 60-100 ms per verifikasi di mesin biasa. Cukup lambat
# untuk membuat penebakan massal mahal, cukup cepat untuk tidak terasa saat masuk.
_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1
_PANJANG_SIDIK = 32



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

# ---------------------------------------------------------------------------
# Kunci penandatangan
# ---------------------------------------------------------------------------


def _kunci() -> bytes:
    """Kunci HMAC untuk tiket sesi."""
    if settings.auth_secret:
        if settings.produksi and len(settings.auth_secret) < PANJANG_MIN_KUNCI:
            raise RuntimeError(
                f"AUTH_SECRET terlalu pendek ({len(settings.auth_secret)} karakter, "
                f"minimum {PANJANG_MIN_KUNCI}). "
                "Buat dengan: python -c \"import secrets;print(secrets.token_urlsafe(48))\""
            )
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
    """`scrypt$garam$sidik`, keduanya base64url."""
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
    """Id akun dari tiket yang sah, atau None."""
    try:
        kepala, isi, tanda = tiket.split(".")
    except ValueError:
        return None
    harapan = hmac.new(_kunci(), f"{kepala}.{isi}".encode(), hashlib.sha256).digest()
    try:
        diterima = _nyah_b64(tanda)
    except (ValueError, binascii.Error):
        return None
    if not hmac.compare_digest(diterima, harapan):
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
    """Langganan yang masih berlaku, kalau ada."""
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


def tingkat(db: Session, user: User | None) -> Tingkat:
    if user is None:
        return "tamu"
    return "premium" if langganan_aktif(db, user) else "gratis"


def akses_penuh(db: Session, user: User | None, h3: str) -> bool:
    """Boleh melihat kedalaman penuh SATU heksagon ini?"""
    if user is None:
        return False
    return langganan_aktif(db, user) is not None


def wajib_akses_penuh(db: Session, user: User | None, h3: str, fitur: str) -> None:
    """Lempar galat ber-kode kalau pemanggil belum boleh melihat `fitur`."""
    if user is None:
        raise TidakTerautentikasi(
            f"{fitur} bagian dari Loconomics Premium. Masuk dulu untuk membukanya."
        )
    if not akses_penuh(db, user, h3):
        raise ButuhPremium(
            f"{fitur} bagian dari Loconomics Premium.",
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
    """Pengguna kalau ada tiket sah, None kalau tidak. TIDAK pernah menolak."""
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
    """Penjaga untuk endpoint yang isinya memang berbayar."""
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
