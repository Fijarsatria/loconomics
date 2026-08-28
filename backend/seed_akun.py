"""Buat (atau perbarui) akun pemilik berlangganan selamanya.

    cd backend && python seed_akun.py

Idempoten: dijalankan berkali-kali tidak menggandakan apa pun. Kalau akunnya
sudah ada, kata sandinya disetel ulang ke nilai di bawah dan langganan
selamanya-nya dipastikan masih aktif.

KENAPA SKRIP, BUKAN DI DALAM MIGRASI. Migrasi menggambarkan BENTUK basis data,
dan bentuknya harus sama di mesin siapa pun yang menjalankannya. Akun pemilik
adalah ISI, dan isi yang menyelinap masuk lewat migrasi ikut terpasang di setiap
lingkungan yang pernah menjalankan `alembic upgrade head` - termasuk lingkungan
tempat akun itu tidak seharusnya ada. Sebagai skrip, ia dijalankan kalau memang
diinginkan.

Kata sandinya DULU ada di berkas ini apa adanya, dengan catatan "kalau
repositori ini nanti jadi publik, pindahkan ke environment variable". Diperiksa
29 Agu 2026: repositorinya PUBLIC, jadi syarat itu sudah terpenuhi dan sandinya
dipindahkan.

Sekarang ia dibaca dari `SEED_AKUN_SANDI`. Kalau kosong, skrip ini BERHENTI
alih-alih memakai sandi bawaan - sandi bawaan di skrip pembuat akun admin adalah
sandi yang cepat atau lambat dipakai di produksi oleh orang yang tidak tahu ia
bawaan.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from app.core.akun import langganan_aktif, sidik_sandi
from app.core.database import SessionLocal
from app.models import Subscription, User

NAMA_PENGGUNA = os.environ.get("SEED_AKUN_NAMA", "KingIpunk")
EMAIL = os.environ.get("SEED_AKUN_EMAIL", "fijarsatria07@gmail.com")
NAMA_TAMPILAN = os.environ.get("SEED_AKUN_NAMA_TAMPILAN", "Fijar Satria")

def _dari_env(nama: str) -> str:
    """Environment variable dulu, lalu backend/.env.

    Membaca .env sendiri, bukan lewat pydantic-settings: sandi ini bukan
    pengaturan aplikasi dan tidak pantas ikut di objek settings yang dibawa ke
    mana-mana selama proses hidup.
    """
    nilai = os.environ.get(nama)
    if nilai:
        return nilai
    berkas = Path(__file__).resolve().parent / ".env"
    if berkas.exists():
        for baris in berkas.read_text(encoding="utf-8").splitlines():
            if baris.strip().startswith(nama + "="):
                return baris.split("=", 1)[1].strip()
    return ""


#: TIDAK punya nilai bawaan, dan itu disengaja. Lihat docstring di kepala berkas.
SANDI = _dari_env("SEED_AKUN_SANDI")
if not SANDI:
    raise SystemExit(
        "SEED_AKUN_SANDI belum diisi.\n"
        "  Windows PowerShell :  $env:SEED_AKUN_SANDI = '...'\n"
        "  bash               :  SEED_AKUN_SANDI='...' python seed_akun.py\n"
        "  atau tambahkan SEED_AKUN_SANDI=... ke backend/.env\n"
        "\n"
        "Skrip ini membuat akun ADMIN berlangganan selamanya. Sandi bawaan di\n"
        "skrip semacam ini adalah sandi yang cepat atau lambat ikut ke produksi."
    )


def main() -> int:
    db = SessionLocal()
    try:
        user = db.execute(
            select(User).where(
                (User.nama_pengguna == NAMA_PENGGUNA) | (User.email == EMAIL)
            )
        ).scalar_one_or_none()

        if user is None:
            user = User(
                nama_pengguna=NAMA_PENGGUNA,
                email=EMAIL,
                sidik_sandi=sidik_sandi(SANDI),
                nama_tampilan=NAMA_TAMPILAN,
                peran="admin",
                aktif=True,
                saldo_token=0,
            )
            db.add(user)
            db.flush()
            print(f"akun dibuat: {NAMA_PENGGUNA} (id={user.id})")
        else:
            user.nama_pengguna = NAMA_PENGGUNA
            user.email = EMAIL
            user.sidik_sandi = sidik_sandi(SANDI)
            user.nama_tampilan = NAMA_TAMPILAN
            user.peran = "admin"
            user.aktif = True
            print(f"akun diperbarui: {NAMA_PENGGUNA} (id={user.id})")

        if langganan_aktif(db, user) is None:
            db.add(
                Subscription(
                    user_id=user.id,
                    paket="selamanya",
                    status="aktif",
                    selamanya=True,
                    harga_rp=0,
                    dimulai_pada=datetime.now(timezone.utc).replace(tzinfo=None),
                    berlaku_sampai=None,
                    metode_bayar="pemilik",
                    referensi_bayar="akun-pemilik",
                )
            )
            print("langganan selamanya dipasang")
        else:
            print("langganan aktif sudah ada, dibiarkan")

        db.commit()

        # Bukti, bukan asumsi: baca ulang dari basis data setelah commit.
        db.refresh(user)
        lang = langganan_aktif(db, user)
        print(
            f"hasil: {user.nama_pengguna} <{user.email}> "
            f"peran={user.peran} tingkat={'premium' if lang else 'gratis'} "
            f"selamanya={bool(lang and lang.selamanya)}"
        )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
