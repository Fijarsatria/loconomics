"""Uji akun, langganan, token, dan penjagaan fitur berbayar.

    cd backend && python tests/test_akun.py

Menyentuh basis data sungguhan di dalam satu transaksi yang DIROLLBACK di
akhir - pola yang sama dengan smoke_api.py. Tidak ada satu baris pun yang
tertinggal, termasuk akun uji.

Yang paling penting diuji di sini bukan "apakah bisa masuk", melainkan
kebalikannya: apakah yang berbayar benar-benar TIDAK keluar untuk yang belum
membayar. Uji yang cuma memastikan jalur bahagia berjalan akan tetap hijau
walaupun seluruh penjaganya dicabut.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.core import cache  # noqa: E402
from app.core.akun import (  # noqa: E402
    baca_tiket,
    buat_tiket,
    langganan_aktif,
    periksa_sandi,
    sidik_sandi,
    sudah_terbuka,
)
from app.core.database import SessionLocal  # noqa: E402
from app.models import HexFeature, PremiumUnlock, TokenLedger, User  # noqa: E402

def _dari_env(nama: str) -> str:
    """Environment variable dulu, lalu backend/.env. Kembar dari seed_akun.py.

    Sandi akun pemilik tidak boleh ditulis di berkas uji: repo ini publik, dan
    berkas uji sama terbacanya dengan berkas lain.
    """
    import os
    from pathlib import Path as _P

    nilai = os.environ.get(nama)
    if nilai:
        return nilai
    berkas = _P(__file__).resolve().parent.parent / ".env"
    if berkas.exists():
        for baris in berkas.read_text(encoding="utf-8").splitlines():
            if baris.strip().startswith(nama + "="):
                return baris.split("=", 1)[1].strip()
    return ""


lolos = 0
gagal: list[str] = []


def cek(nama: str, syarat: bool) -> None:
    global lolos
    if syarat:
        lolos += 1
    else:
        gagal.append(nama)
        print(f"  GAGAL: {nama}")


def main() -> int:
    cache.bersihkan()
    db = SessionLocal()
    trans = db.begin_nested() if db.in_transaction() else None
    db.begin() if trans is None and not db.in_transaction() else None

    try:
        # =================================================================
        # Kata sandi
        # =================================================================
        sidik = sidik_sandi("rahasia-yang-panjang")
        cek("sidik tidak menyimpan sandi apa adanya", "rahasia-yang-panjang" not in sidik)
        cek("sidik berawalan scrypt", sidik.startswith("scrypt$"))
        cek("sandi benar cocok", periksa_sandi("rahasia-yang-panjang", sidik))
        cek("sandi salah ditolak", not periksa_sandi("rahasia-yang-pendek", sidik))
        cek("sidik kosong ditolak", not periksa_sandi("apa pun", None))
        cek("sidik rusak ditolak", not periksa_sandi("apa pun", "bukan-format-yang-benar"))
        # Dua akun dengan sandi sama tidak boleh menghasilkan sidik sama.
        cek("garam per akun", sidik_sandi("sama") != sidik_sandi("sama"))

        # =================================================================
        # Tiket
        # =================================================================
        t = buat_tiket(4242)
        cek("tiket terbaca kembali", baca_tiket(t) == 4242)
        cek("tiket berbentuk tiga bagian", len(t.split(".")) == 3)
        # Satu karakter diubah di bagian isi -> tanda tangan tidak lagi cocok.
        kepala, isi, tanda = t.split(".")
        palsu = f"{kepala}.{isi[:-1]}{'A' if isi[-1] != 'A' else 'B'}.{tanda}"
        cek("tiket yang diutak-atik ditolak", baca_tiket(palsu) is None)
        cek("tiket sampah ditolak", baca_tiket("bukan.tiket.samasekali") is None)
        cek("tiket kosong ditolak", baca_tiket("") is None)

        # =================================================================
        # Akun uji + tingkat
        # =================================================================
        u = User(
            nama_pengguna="uji_akun_sementara",
            email="uji-akun-sementara@contoh.invalid",
            sidik_sandi=sidik_sandi("kata-sandi-uji"),
            nama_tampilan="Uji",
            peran="pengguna",
            saldo_token=0,
        )
        db.add(u)
        db.flush()

        cek("akun baru bukan premium", langganan_aktif(db, u) is None)
        cek("akun baru saldo token nol", u.saldo_token == 0)

        # =================================================================
        # Penjagaan detail heksagon - INI yang paling penting
        # =================================================================
        h3 = db.execute(select(HexFeature.h3_index).limit(1)).scalar_one_or_none()
        if h3 is None:
            print("  ! tidak ada heksagon di basis data, sebagian uji dilewati")
        else:
            from app.api.hex import detail_heksagon

            tamu = detail_heksagon(h3, db, pengguna=None)
            cek("tamu: variabel kosong", tamu.variabel == {})
            cek("tamu: faktor kosong", tamu.faktor == [])
            cek("tamu: tingkat 'tamu'", tamu.tingkat_akun == "tamu")
            cek("tamu: terkunci menyebut kelimanya",
                set(tamu.terkunci) == {"variabel", "faktor", "indeks", "kuadran", "perkiraan"})
            # PERKIRAAN ikut ditahan sejak 12 Sep 2026, dan penahanan itu
            # bukan soal nilai jualnya. Angka perkiraan menjawab pertanyaan
            # yang SAMA dengan 43 variabel - "berapa angkanya di sini" - dan
            # batas berbayar yang berbeda untuk pertanyaan yang sama tidak bisa
            # diterangkan ke siapa pun.
            cek("tamu: perkiraan kosong", tamu.perkiraan == [])
            # Yang GRATIS tetap harus utuh - kalau ini kosong, produknya rusak
            # bagi semua orang, bukan cuma bagi yang belum bayar.
            cek("tamu: skor tetap ada", tamu.skor is not None)
            cek("tamu: zoneguard tetap ada", tamu.zoneguard is not None)
            cek("tamu: risiko tetap ada", tamu.risiko is not None)
            cek("tamu: commuter clock tetap ada", len(tamu.commuter_clock) == 4)
            # Keempat indeks PINDAH ke sisi berbayar 11 Sep 2026. Yang ditahan
            # NILAINYA; keterangan mutunya (`cakupan` - berapa bahan tiap indeks
            # yang benar-benar terukur) tetap gratis, karena pengakuan bahwa
            # datanya tipis tidak boleh jadi barang dagangan.
            cek("tamu: nilai keempat indeks ditahan",
                tamu.indeks.ipt is None and tamu.indeks.iae is None
                and tamu.indeks.ikp is None and tamu.indeks.ibr is None)
            cek("tamu: cakupan indeks tetap ikut (keterangan mutu, bukan isi)",
                bool(tamu.indeks.cakupan))
            cek("tamu: penjelasan kuadran ditahan", tamu.kuadran_penjelasan is None)
            cek("tamu: cakupan prestise tetap ikut", tamu.cakupan_prestise is not None)
            cek("tamu: badge keyakinan tetap ikut", tamu.skor.keyakinan is not None)

            gratis = detail_heksagon(h3, db, pengguna=u)
            cek("gratis: variabel tetap kosong", gratis.variabel == {})
            cek("gratis: perkiraan tetap kosong", gratis.perkiraan == [])
            cek("gratis: tingkat 'gratis'", gratis.tingkat_akun == "gratis")

            # --- Token: buka satu heksagon --------------------------------
            cek("belum terbuka", not sudah_terbuka(db, u, h3))
            u.saldo_token = 5
            db.add(PremiumUnlock(user_id=u.id, h3_index=h3, jenis="detail"))
            db.flush()
            cek("terbuka sesudah dicatat", sudah_terbuka(db, u, h3))

            # --- Ketiga laporan PDF ---------------------------------------
            #
            # Dijalankan SESUDAH token dibelanjakan, karena ketiganya berbayar
            # dan penjaganya memang harus dilewati lewat pintu yang sah.
            #
            # Yang diperiksa BUKAN "PDF-nya bagus" - itu tidak bisa diuji di
            # sini - melainkan tiga hal yang gagalnya diam: berkasnya memang
            # PDF (bukan halaman galat yang kebetulan 200), ia memuat gambar
            # (markah dan diagram), dan putusan simulasinya dirakit.
            from app.api.akun import (
                _putusan_simulasi,
                _rakit_pdf,
                _rakit_pdf_simulasi,
            )
            from app.api.hex import simulasi_heksagon
            from app.core.laporan import MARKAH

            cek("markah produk ada di repo", MARKAH.exists())

            from app.api.bersama import ambil_hex
            from app.models import LocationScore

            hx_uji = ambil_hex(db, h3)
            skor_uji = db.execute(
                select(LocationScore).where(LocationScore.h3_index == h3)
            ).scalars().first()

            # PERAKITNYA yang dipanggil, bukan endpointnya. `laporan_pdf`
            # memotong token, dan potongan itu menambah baris buku besar yang
            # membuat asersi saldo di bawah gagal - uji ini menangkapnya sendiri
            # pada percobaan pertama. Yang ingin diuji di sini perakitan
            # PDF-nya, bukan lagi penjaganya (yang sudah diuji di atas).
            from app.api.bersama import badge, peringatan_risiko, persentil_churn, zoneguard

            p75_l, p90_l = persentil_churn(db, hx_uji.kawasan)
            isi_kelayakan = _rakit_pdf(
                hx_uji, skor_uji, zoneguard(hx_uji),
                peringatan_risiko(hx_uji, p75_l, p90_l), badge(hx_uji), u,
            )
            cek("Laporan Kelayakan berbentuk PDF", isi_kelayakan[:5] == b"%PDF-")
            # `/Subtype /Image`, BUKAN `/Image`. Yang kedua muncul di PDF tanpa
            # satu pun gambar tertanam - diukur 13 Sep 2026: berkas tanpa markah
            # tetap memuat "/Image" tiga kali, jadi asersi itu hijau untuk
            # laporan yang logonya hilang. Yang menandai gambar SUNGGUHAN cuma
            # objek XObject bertipe Image.
            cek("Laporan Kelayakan menanam markah produk",
                isi_kelayakan.count(b"/Subtype /Image") >= 1)

            sim = simulasi_heksagon(h3, db, pengguna=u)
            isi_sim = _rakit_pdf_simulasi(sim, u)
            cek("Laporan Simulasi berbentuk PDF", isi_sim[:5] == b"%PDF-")
            cek("Laporan Simulasi menanam markah produk",
                isi_sim.count(b"/Subtype /Image") >= 1)
            judul_sim, _, nada_sim = _putusan_simulasi(sim)
            cek("putusan simulasi bernada sah", nada_sim in {"baik", "waspada", "bahaya"})
            cek("putusan simulasi berjudul", bool(judul_sim))

            dibuka = detail_heksagon(h3, db, pengguna=u)
            cek("token: variabel terisi 43", len(dibuka.variabel) == 43)
            cek("token: terkunci kosong", dibuka.terkunci == [])
            # Dan yang dibuka BENAR-BENAR terbuka. Uji yang cuma memastikan
            # tamu ditahan akan tetap hijau kalau perkiraannya tidak pernah
            # dikirim ke siapa pun - yaitu kalau fiturnya mati total.
            cek("token: perkiraan ikut terbuka", len(dibuka.perkiraan) > 0)
            cek("token: tiap perkiraan membawa mutunya",
                all(p.keterangan and p.kolom for p in dibuka.perkiraan))
            cek("token: nilai indeks ikut terbuka", dibuka.indeks.ipt is not None)
            cek("token: tingkat tetap 'gratis'", dibuka.tingkat_akun == "gratis")

            # Heksagon LAIN tetap terkunci - pembukaan tidak boleh menular.
            h3_lain = db.execute(
                select(HexFeature.h3_index).where(HexFeature.h3_index != h3).limit(1)
            ).scalar_one_or_none()
            if h3_lain:
                lain = detail_heksagon(h3_lain, db, pengguna=u)
                cek("pembukaan tidak menular ke heksagon lain", lain.variabel == {})

        # =================================================================
        # Buku besar token
        # =================================================================
        from app.api.akun import _catat_token

        u.saldo_token = 0
        _catat_token(db, u, 10, "beli", "uji")
        db.flush()
        cek("saldo naik", u.saldo_token == 10)
        _catat_token(db, u, -2, "laporan", "uji")
        db.flush()
        cek("saldo turun", u.saldo_token == 8)

        baris = db.execute(
            select(TokenLedger).where(TokenLedger.user_id == u.id)
        ).scalars().all()
        cek("dua mutasi tercatat", len(baris) == 2)
        cek("jumlah buku besar == saldo", sum(b.jumlah for b in baris) == u.saldo_token)
        cek("saldo_sesudah terakhir benar", baris[-1].saldo_sesudah == 8)

        # =================================================================
        # Penjaga premium melempar untuk akun gratis
        # =================================================================
        from app.core.akun import wajib_premium
        from app.core.galat import ButuhPremium

        try:
            wajib_premium(u, db)
            cek("wajib_premium menolak akun gratis", False)
        except ButuhPremium:
            cek("wajib_premium menolak akun gratis", True)

        # Akun pemilik yang sudah di-seed harus lolos penjaga yang sama.
        pemilik = db.execute(
            select(User).where(User.nama_pengguna == "KingIpunk")
        ).scalar_one_or_none()
        if pemilik is not None:
            lang = langganan_aktif(db, pemilik)
            cek("akun pemilik premium", lang is not None)
            cek("akun pemilik selamanya", bool(lang and lang.selamanya))
            cek("akun pemilik tanpa tanggal kedaluwarsa",
                bool(lang and lang.berlaku_sampai is None))
            cek("akun pemilik peran admin", pemilik.peran == "admin")
            # Sandinya dibaca dari environment, bukan ditulis di sini: repo ini
            # publik. Kalau tidak diisi, asersinya DILEWATI dan dikatakan -
            # bukan dianggap lolos.
            sandi_pemilik = _dari_env("SEED_AKUN_SANDI")
            if sandi_pemilik:
                cek("sandi pemilik cocok",
                    periksa_sandi(sandi_pemilik, pemilik.sidik_sandi))
            else:
                print("  ! SEED_AKUN_SANDI kosong, uji sandi pemilik dilewati")
            try:
                wajib_premium(pemilik, db)
                cek("wajib_premium meloloskan pemilik", True)
            except ButuhPremium:
                cek("wajib_premium meloloskan pemilik", False)
        else:
            print("  ! akun pemilik belum di-seed, uji terkait dilewati")

        return 0
    finally:
        db.rollback()
        db.close()
        # Cache dibersihkan di AWAL dan di AKHIR - lihat CLAUDE.md. Tanpa ini,
        # persentil churn yang dibaca uji ini bertahan sesudah rollback.
        cache.bersihkan()


if __name__ == "__main__":
    kode = main()
    print()
    if gagal:
        print(f"{lolos} lolos, {len(gagal)} GAGAL")
        for g in gagal:
            print(f"  - {g}")
        sys.exit(1)
    print(f"{lolos} asersi lolos, 0 gagal")
    sys.exit(kode)
