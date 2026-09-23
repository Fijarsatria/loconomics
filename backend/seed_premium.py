"""Buat sekumpulan akun Loconomics Premium untuk dibagikan tim.

    cd backend && python seed_premium.py --jumlah 10
    cd backend && python seed_premium.py --jumlah 10 --kering   # lihat saja

Sandi diacak dan hanya DICETAK SEKALI di sini (tidak pernah disimpan sebagai
teks). Kalau dijalankan ulang, akun yang sudah ada DILEWATI dan sandinya tidak
diubah - jadi aman diulang, tetapi sandi lama tidak bisa ditampilkan lagi.

Akun ini bertanda `peran="pengguna"`; aktivasi Premium tetap wewenang tim
(endpoint /akun/langganan sudah admin-only).
"""

from __future__ import annotations

import argparse
import secrets
import sys
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.akun import sidik_sandi
from app.core.database import SessionLocal
from app.models import Subscription, User

DOMAIN = "loconomics.mapid.io"


def sandi_kutip() -> str:
    """Sandi acak yang mudah dibacakan: tanpa karakter yang membingungkan."""
    abjad = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
    return "Loco-" + "".join(secrets.choice(abjad) for _ in range(8))


def main() -> int:
    p = argparse.ArgumentParser(description="Buat akun Premium untuk dibagikan.")
    p.add_argument("--jumlah", type=int, default=10, help="Berapa akun (default 10)")
    p.add_argument("--awalan", default="premium", help="Awalan nama pengguna")
    p.add_argument("--kering", action="store_true", help="Hitung saja, tanpa menulis")
    a = p.parse_args()

    db = SessionLocal()
    dibuat: list[tuple[str, str, str]] = []
    dilewati: list[str] = []
    try:
        for i in range(1, a.jumlah + 1):
            nama = f"{a.awalan}{i:02d}"
            email = f"{nama}@{DOMAIN}"
            ada = db.execute(
                select(User).where((User.nama_pengguna == nama) | (User.email == email))
            ).scalar_one_or_none()
            if ada is not None:
                dilewati.append(nama)
                continue

            sandi = sandi_kutip()
            user = User(
                nama_pengguna=nama,
                email=email,
                sidik_sandi=sidik_sandi(sandi),
                nama_tampilan=f"Premium {i:02d}",
                peran="pengguna",
                aktif=True,
                saldo_token=0,
            )
            db.add(user)
            db.flush()
            db.add(
                Subscription(
                    user_id=user.id,
                    paket="selamanya",
                    status="aktif",
                    selamanya=True,
                    harga_rp=0,
                    dimulai_pada=datetime.now(timezone.utc).replace(tzinfo=None),
                    berlaku_sampai=None,
                    metode_bayar="petugas",
                    referensi_bayar="seed-premium",
                )
            )
            dibuat.append((nama, email, sandi))

        if a.kering:
            db.rollback()
        else:
            db.commit()
    finally:
        db.close()

    print()
    print("nama_pengguna,email,sandi")
    for nama, email, sandi in dibuat:
        print(f"{nama},{email},{sandi}")
    if dilewati:
        print(f"\n# dilewati (sudah ada, sandi TIDAK diubah): {', '.join(dilewati)}")
    if a.kering:
        print("# MODE KERING - tidak ada yang ditulis.")
    print(f"\n# total dibuat: {len(dibuat)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
