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
)
from app.core.database import SessionLocal  # noqa: E402
from app.models import HexFeature, Subscription, User  # noqa: E402

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

            # --- Sistem token sudah DIHAPUS (13 Sep 2026) --------------------
            import app.core.akun as _inti_akun
            import app.api.akun as _api_akun

            cek("token: fungsi pembuka satu heksagon sudah tidak ada",
                not hasattr(_inti_akun, "sudah_terbuka"))
            cek("token: endpoint beli/buka sudah tidak terdaftar",
                not any(getattr(r, "path", "").startswith(("/akun/token", "/akun/buka", "/akun/terbuka"))
                        for r in _api_akun.router.routes))
            cek("token: katalog tidak lagi menjual token",
                "token" not in _api_akun.katalog() and "biaya_token" not in _api_akun.katalog())

            # Satu-satunya jalan masuk yang tersisa: langganan.
            langganan_uji = Subscription(user_id=u.id, paket="bulanan", status="aktif",
                                         selamanya=True, metode_bayar="uji")
            db.add(langganan_uji)
            db.flush()

            # --- Ketiga laporan PDF ---------------------------------------
            #
            # Dijalankan SESUDAH langganan aktif, karena ketiganya berbayar dan
            # penjaganya memang harus dilewati lewat pintu yang sah.
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

            # PERAKITNYA yang dipanggil, bukan endpointnya: yang ingin diuji di
            # sini perakitan PDF-nya, bukan lagi penjaganya.
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
            cek("premium: variabel terisi 43", len(dibuka.variabel) == 43)
            cek("premium: terkunci kosong", dibuka.terkunci == [])
            # Dan yang dibuka BENAR-BENAR terbuka. Uji yang cuma memastikan
            # tamu ditahan akan tetap hijau kalau perkiraannya tidak pernah
            # dikirim ke siapa pun - yaitu kalau fiturnya mati total.
            cek("premium: perkiraan ikut terbuka", len(dibuka.perkiraan) > 0)
            cek("premium: tiap perkiraan membawa mutunya",
                all(p.keterangan and p.kolom for p in dibuka.perkiraan))
            cek("premium: nilai indeks ikut terbuka", dibuka.indeks.ipt is not None)
            cek("premium: tingkat 'premium'", dibuka.tingkat_akun == "premium")

            # --- Simulasi dipersempit ke satu blok -------------------------
            from sqlalchemy import text as _teks

            from app.core.galat import TidakDitemukan

            h3_sim = db.execute(_teks(
                "select b.h3_induk from blok_heksagon b join hex_features h on h.h3_index=b.h3_induk "
                "where h.belanja_per_jam is not null group by b.h3_induk "
                "having max(b.skor_blok) - min(b.skor_blok) > 10 limit 1"
            )).scalar()
            if h3_sim is None:
                print("  ! tidak ada heksagon berdata belanja dengan blok berbeda, uji blok dilewati")
            else:
                from app.api.hex import blok_heksagon as _blok

                bb = _blok(h3_sim, db).blok
                dasar = simulasi_heksagon(h3_sim, db, pengguna=u)
                atas = simulasi_heksagon(h3_sim, db, pengguna=u, h3_blok=bb[0].h3_blok)
                bawah = simulasi_heksagon(h3_sim, db, pengguna=u, h3_blok=bb[-1].h3_blok)
                cek("blok: simulasi heksagon polos tidak membawa blok", dasar.blok is None)
                cek("blok: simulasi blok menyebut bloknya", atas.blok is not None and atas.blok.h3_blok == bb[0].h3_blok)
                cek("blok: faktor dalam batas 0,6-1,4",
                    all(0.6 <= x.blok.faktor_permintaan <= 1.4 for x in (atas, bawah)))
                cek("blok: blok terbaik >= blok terlemah",
                    atas.blok.faktor_permintaan >= bawah.blok.faktor_permintaan)
                if dasar.hasil.omzet_bulanan:
                    rasio = atas.hasil.omzet_bulanan / dasar.hasil.omzet_bulanan
                    cek("blok: omzet blok = omzet heksagon x faktornya",
                        abs(rasio - atas.blok.faktor_permintaan) < 0.01)
                cek("blok: rumus faktornya ikut dikirim", "faktor_permintaan" in atas.rumus)
                try:
                    simulasi_heksagon(h3_sim, db, pengguna=u, h3_blok="8a0000000000000")
                    cek("blok: blok dari heksagon lain ditolak", False, "- justru dilayani")
                except TidakDitemukan:
                    cek("blok: blok dari heksagon lain ditolak", True)

            # --- Titik favorit di dalam heksagon ------------------------------
            from app.api.akun import daftar_pantauan, hapus_pantauan, namai_pantauan, tambah_pantauan
            from app.core.galat import KesalahanAPI as _Galat
            from app.schemas import PermintaanNamaPantau, PermintaanPantau

            lat_d, lon_d = db.execute(_teks(
                "select ST_Y(ST_PointOnSurface(geom)), ST_X(ST_PointOnSurface(geom)) "
                "from hex_features where h3_index = :h"
            ), {"h": h3}).one()
            simpan = tambah_pantauan(
                PermintaanPantau(h3_index=h3, lat=lat_d, lon=lon_d, nama="Ruko uji"), u, db
            )
            cek("pin: titik di dalam heksagon diterima", simpan.titik_sendiri is True)
            cek("pin: titiknya yang disimpan, bukan titik tengah",
                abs(simpan.lat - lat_d) < 1e-9 and abs(simpan.lon - lon_d) < 1e-9)
            cek("pin: nama ikut tersimpan", simpan.nama == "Ruko uji")
            try:
                tambah_pantauan(PermintaanPantau(h3_index=h3, lat=lat_d + 0.05, lon=lon_d), u, db)
                cek("pin: titik di LUAR heksagon ditolak", False)
            except _Galat:
                db.rollback()
                cek("pin: titik di LUAR heksagon ditolak", True)
            namai_pantauan(h3, PermintaanNamaPantau(nama="  Pojok Kendal  "), u, db)
            daftar = {b.h3_index: b for b in daftar_pantauan(u, db)}
            cek("pin: nama bisa diganti (dan dirapikan)", daftar[h3].nama == "Pojok Kendal")
            cek("pin: daftar memakai titik sendiri", daftar[h3].titik_sendiri)
            namai_pantauan(h3, PermintaanNamaPantau(nama=""), u, db)
            cek("pin: nama kosong kembali ke kode lokasi",
                {b.h3_index: b for b in daftar_pantauan(u, db)}[h3].nama is None)
            hapus_pantauan(h3, u, db)
            cek("pin: bisa dihapus", h3 not in {b.h3_index for b in daftar_pantauan(u, db)})

            import app.api.akun as _api_akun2
            from app.core.akun import wajib_premium as _wp

            def _pakai_premium(jalur, metode):
                for r in _api_akun2.router.routes:
                    if getattr(r, "path", "") == jalur and metode in getattr(r, "methods", set()):
                        return any(d.call is _wp for d in _semua_dep(r.dependant))
                return False

            def _semua_dep(dep):
                for d in dep.dependencies:
                    yield d
                    yield from _semua_dep(d)

            cek("pin: menyimpan lokasi menuntut PREMIUM, bukan sekadar akun",
                _pakai_premium("/akun/pantauan", "POST"))
            cek("pin: daftar simpanan menuntut PREMIUM", _pakai_premium("/akun/pantauan", "GET"))
            cek("pin: menghapus TETAP boleh untuk akun apa pun",
                not _pakai_premium("/akun/pantauan/{h3_index}", "DELETE"))

            # Langganan uji dicabut lagi: bagian sesudah ini menguji akun GRATIS.
            db.delete(langganan_uji)
            db.flush()

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
