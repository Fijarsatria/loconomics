"""Uji lapisan infrastruktur: galat, cache, pembatas.

    cd backend && python tests/test_infra.py

Tanpa basis data. Sesi diganti tiruan, jadi berkas ini aman dijalankan kapan saja.

Yang diuji di sini bukan fitur produk melainkan hal-hal yang menentukan apakah
backend selamat di produksi: apakah galat bocor ke pengguna, apakah cache
benar-benar kena, apakah pembatas benar-benar membatasi. Ketiganya tipe kesalahan
yang tidak pernah memunculkan pesan error - semuanya tetap "berjalan", hanya
saja salah.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.core import batas, cache, galat

lolos = gagal = 0


def cek(nama: str, syarat: bool, catatan: str = "") -> None:
    global lolos, gagal
    if syarat:
        print(f"  PASS  {nama}")
        lolos += 1
    else:
        print(f"  FAIL  {nama} {catatan}")
        gagal += 1


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------


def test_cache_kena_ulang():
    cache.bersihkan()
    hitung = {"n": 0}

    @cache.ber_cache("uji")
    def mahal(db, kawasan: str):
        hitung["n"] += 1
        return f"hasil-{kawasan}"

    mahal("sesi-a", "Manggarai")
    mahal("sesi-a", "Manggarai")
    cek("panggilan kedua diambil dari cache", hitung["n"] == 1, f"- dijalankan {hitung['n']}x")


def test_cache_abaikan_sesi():
    """Sesi basis data berbeda tiap permintaan.

    Kalau ikut jadi kunci, cache tidak pernah kena - dan gejalanya paling sulit
    disadari karena semuanya tetap benar, hanya tidak pernah lebih cepat.
    """
    cache.bersihkan()
    hitung = {"n": 0}

    @cache.ber_cache("uji2")
    def mahal(db, kawasan: str):
        hitung["n"] += 1
        return kawasan

    mahal(object(), "Bekasi")
    mahal(object(), "Bekasi")  # sesi berbeda, hasil harus sama
    cek("sesi berbeda tetap kena cache (posisional)", hitung["n"] == 1)

    hitung["n"] = 0
    mahal(db=object(), kawasan="Bekasi")
    mahal(db=object(), kawasan="Bekasi")  # FastAPI memanggil pakai kata-kunci
    cek("sesi berbeda tetap kena cache (kata-kunci)", hitung["n"] == 1, f"- {hitung['n']}x")


def test_cache_argumen_beda_kunci_beda():
    cache.bersihkan()
    hitung = {"n": 0}

    @cache.ber_cache("uji3")
    def mahal(db, kawasan: str):
        hitung["n"] += 1
        return kawasan

    mahal(None, "Manggarai")
    mahal(None, "Bekasi")
    cek("argumen berbeda tidak tertukar", hitung["n"] == 2)


def test_cache_bersihkan_berawalan():
    cache.bersihkan()
    cache.simpan("a|x", 1)
    cache.simpan("a|y", 2)
    cache.simpan("b|z", 3)
    dibuang = cache.bersihkan("a")
    ketemu_b, _ = cache.ambil("b|z")
    cek("hanya awalan yang diminta yang dibuang", dibuang == 2 and ketemu_b)


def test_cache_none_bukan_penanda_kosong():
    """Sebagian query memang sah mengembalikan None. Kalau None dipakai sebagai
    penanda 'tidak ada di cache', query itu tidak akan pernah ter-cache."""
    cache.bersihkan()
    cache.simpan("k", None)
    ketemu, nilai = cache.ambil("k")
    cek("None tersimpan sebagai nilai sah", ketemu is True and nilai is None)


def test_cache_kedaluwarsa():
    cache.bersihkan()
    cache.simpan("pendek", "x", ttl=-1)  # sudah lewat
    ketemu, _ = cache.ambil("pendek")
    cek("entri kedaluwarsa tidak dipakai", ketemu is False)


# ---------------------------------------------------------------------------
# Pembatas laju
# ---------------------------------------------------------------------------


def test_laju_membatasi():
    batas.lupakan()
    for _ in range(batas.MAKS_PERMINTAAN):
        batas.periksa_laju("1.2.3.4")
    try:
        batas.periksa_laju("1.2.3.4")
        cek("permintaan ke-11 ditolak", False, "- tidak ditolak")
    except galat.TerlaluBanyakPermintaan as e:
        cek("permintaan ke-11 ditolak", True)
        cek("pesan menyebut lama tunggu", "tunggu_detik" in e.detail)


def test_laju_terpisah_per_pemanggil():
    batas.lupakan()
    for _ in range(batas.MAKS_PERMINTAAN):
        batas.periksa_laju("1.1.1.1")
    try:
        batas.periksa_laju("2.2.2.2")
        cek("pemanggil lain tidak ikut kena", True)
    except galat.TerlaluBanyakPermintaan:
        cek("pemanggil lain tidak ikut kena", False, "- ikut terblokir")


# ---------------------------------------------------------------------------
# Plafon biaya
# ---------------------------------------------------------------------------


class DbBiaya:
    def __init__(self, total):
        self.total = total

    def execute(self, *a, **kw):
        class Hasil:
            def __init__(self, t):
                self.t = t

            def scalar_one(self):
                return self.t

        return Hasil(self.total)


def test_anggaran_menahan():
    try:
        batas.periksa_anggaran(DbBiaya(5.0), plafon=2.0)
        cek("plafon terlampaui ditolak", False, "- tidak ditolak")
    except galat.AnggaranHabis as e:
        cek("plafon terlampaui ditolak", True)
        cek("detail menyebut angka", e.detail["terpakai_usd"] == 5.0)


def test_anggaran_meloloskan():
    try:
        terpakai = batas.periksa_anggaran(DbBiaya(0.5), plafon=2.0)
        cek("di bawah plafon lolos", terpakai == 0.5)
    except galat.AnggaranHabis:
        cek("di bawah plafon lolos", False, "- ikut ditolak")


# ---------------------------------------------------------------------------
# Amplop galat
# ---------------------------------------------------------------------------


def _aplikasi_uji() -> TestClient:
    app = FastAPI()
    galat.pasang(app)

    @app.get("/ok")
    def ok():
        return {"a": 1}

    @app.get("/kawasan-salah")
    def kawasan_salah():
        raise galat.KawasanTidakDikenal("Kawasan 'Mangarai' tidak dikenal.", {"x": 1})

    @app.get("/db-mati")
    def db_mati():
        raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    @app.get("/meledak")
    def meledak():
        raise RuntimeError("password=Rahasia123 di connection string")

    return TestClient(app, raise_server_exceptions=False)


def test_galat_beramplop():
    c = _aplikasi_uji()
    r = c.get("/kawasan-salah")
    isi = r.json()
    cek("status dari kelas galat", r.status_code == 422, f"- {r.status_code}")
    cek("berbentuk amplop", "galat" in isi)
    cek("membawa kode yang bisa dibaca program", isi["galat"]["kode"] == "KAWASAN_TIDAK_DIKENAL")
    cek("membawa detail", isi["galat"].get("detail") == {"x": 1})


def test_request_id_selalu_ada():
    c = _aplikasi_uji()
    r = c.get("/ok")
    cek("respons sukses membawa request id", galat.HEADER_REQUEST_ID in r.headers)
    r2 = c.get("/meledak")
    cek(
        "respons galat membawa request id yang sama di badan dan header",
        r2.json()["galat"]["request_id"] == r2.headers[galat.HEADER_REQUEST_ID],
    )


def test_galat_internal_tidak_bocor():
    """Pesan asli bisa memuat nama tabel, jalur berkas, bahkan potongan sandi."""
    c = _aplikasi_uji()
    r = c.get("/meledak")
    badan = r.text
    cek("status 500", r.status_code == 500)
    cek("sandi TIDAK bocor ke pengguna", "Rahasia123" not in badan, "- BOCOR!")
    cek("kode galat generik", r.json()["galat"]["kode"] == "GALAT_INTERNAL")


def test_db_mati_pesannya_bisa_ditindaklanjuti():
    c = _aplikasi_uji()
    r = c.get("/db-mati")
    isi = r.json()["galat"]
    cek("status 503", r.status_code == 503, f"- {r.status_code}")
    cek("menyebut Supabase free tier", "free tier" in isi["pesan"].lower())


def test_request_id_dari_pemanggil_dihormati():
    c = _aplikasi_uji()
    r = c.get("/ok", headers={galat.HEADER_REQUEST_ID: "abc123"})
    cek("id dari pemanggil diteruskan", r.headers[galat.HEADER_REQUEST_ID] == "abc123")


if __name__ == "__main__":
    for nama, fn in sorted(globals().items()):
        if nama.startswith("test_"):
            fn()
    cache.bersihkan()
    batas.lupakan()
    print(f"\n{lolos} lolos, {gagal} gagal")
    raise SystemExit(1 if gagal else 0)
