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

from sqlalchemy.orm import Session

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

    Dipakai `Session` SUNGGUHAN, bukan `object()`. Versi sebelumnya memakai
    `object()` dan lolos karena kebetulan: objek sementara itu dibebaskan tepat
    setelah panggilan, jadi yang kedua sering mendarat di alamat yang sama dan
    `repr()`-nya kebetulan cocok. Uji yang lolos karena daur ulang alamat memori
    tidak menguji apa pun - dan begitu penyaringnya berpindah dari posisi ke
    tipe, `object()` berhenti dikenali sebagai sesi sama sekali.
    """
    cache.bersihkan()
    hitung = {"n": 0}

    @cache.ber_cache("uji2")
    def mahal(db, kawasan: str):
        hitung["n"] += 1
        return kawasan

    mahal(Session(), "Bekasi")
    mahal(Session(), "Bekasi")  # sesi berbeda, hasil harus sama
    cek("sesi berbeda tetap kena cache (posisional)", hitung["n"] == 1, f"- {hitung['n']}x")

    hitung["n"] = 0
    mahal(db=Session(), kawasan="Bekasi")
    mahal(db=Session(), kawasan="Bekasi")  # FastAPI memanggil pakai kata-kunci
    cek("sesi berbeda tetap kena cache (kata-kunci)", hitung["n"] == 1, f"- {hitung['n']}x")


def test_cache_argumen_pertama_bukan_sesi():
    """Sesi disaring menurut TIPE, bukan menurut posisi.

    Bug sungguhan yang pernah hidup di sini: kunci cache membuang `args[0]` apa
    adanya, dengan alasan argumen posisional pertama "selalu" sesi basis data.
    `simpul_terdekat(h3_index, db)` membantahnya - h3 duduk di posisi itu, jadi
    dua heksagon berbeda berbagi satu kunci dan yang kedua menerima rute milik
    yang pertama.

    Yang membuatnya berbahaya: lewat HTTP semuanya benar, karena FastAPI
    memanggil endpoint dengan kata-kunci sehingga `args` kosong. Yang salah cuma
    pemanggilan langsung dari kode - alat AI, skrip, dan uji.
    """
    cache.bersihkan()
    hitung = {"n": 0}

    @cache.ber_cache("uji-posisi")
    def mahal(h3_index: str, db):
        hitung["n"] += 1
        return h3_index

    a = mahal("898c1079dd7ffff", Session())
    b = mahal("898c107834bffff", Session())
    cek("argumen pertama non-sesi ikut jadi kunci", hitung["n"] == 2, f"- dijalankan {hitung['n']}x")
    cek("jawabannya milik heksagon yang diminta", a != b and b == "898c107834bffff", f"- {a} / {b}")

    hitung["n"] = 0
    mahal("898c1079dd7ffff", Session())
    cek("pengulangan tetap kena cache", hitung["n"] == 0, f"- dijalankan {hitung['n']}x")


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


def meta_app():
    """Aplikasi minimal berisi router meta saja."""
    from fastapi import FastAPI

    from app.api import meta

    app = FastAPI()
    app.include_router(meta.router)
    return app
# --- Proksi basemap ---------------------------------------------------------
#
# Yang dijaga di sini bukan "apakah petanya muncul", melainkan kebalikannya:
# apakah kunci MAPID benar-benar TIDAK ikut keluar. Kunci itu membuka data misi
# mentah - diukur 29 Agu 2026, 200 dengan 100 baris per halaman - jadi
# kebocorannya berkonsekuensi diskualifikasi, dan regresinya tidak akan
# memunculkan satu pun galat.


def test_buang_kunci_semua_bentuk_url():
    from app.api.meta import _buang_kunci

    kasus = [
        ("a.pbf?key=RAHASIA", "a.pbf"),
        ("a.pbf?key=RAHASIA&v=2", "a.pbf?v=2"),
        ("a.pbf?v=2&key=RAHASIA", "a.pbf?v=2"),
        ("a.pbf?key=RAHASIA&v=2&w=3", "a.pbf?v=2&w=3"),
    ]
    for masuk, harap in kasus:
        keluar = _buang_kunci(masuk, "RAHASIA")
        cek(f"{masuk} -> {harap}", keluar == harap, f"- dapat {keluar}")


def test_buang_kunci_menolak_sisa():
    """Lebih baik gagal keras daripada meneruskan badan yang masih memuat kunci."""
    from app.api.meta import _buang_kunci

    try:
        _buang_kunci("kunci-di-tempat-tak-terduga=RAHASIA", "RAHASIA")
        cek("sisa kunci ditolak", False, "- tidak melempar apa pun")
    except RuntimeError:
        cek("sisa kunci ditolak", True)


def test_gaya_basemap_hanya_daftar_putih():
    """Tanpa daftar putih, endpoint ini jadi proksi terbuka (SSRF)."""
    from app.api import meta

    c = TestClient(meta_app())
    for jahat in ("tidak-ada", "..%2F..%2Fetc%2Fpasswd", "http:%2F%2Fevil.test"):
        r = c.get(f"/meta/basemap/{jahat}/style.json")
        cek(f"{jahat[:24]} ditolak", r.status_code == 404, f"- {r.status_code}")
    cek("daftar putih berisi empat gaya", len(meta.GAYA_BASEMAP) == 4,
        f"- {len(meta.GAYA_BASEMAP)}")
    cek("satellite tidak ada di daftar putih", "satellite" not in meta.GAYA_BASEMAP)


def test_gaya_basemap_tidak_pernah_membawa_kunci():
    """Uji terpenting di berkas ini. Menyentuh jaringan; dilewati kalau mati."""
    from app.core.config import settings

    if not settings.mapid_maps_api_key:
        cek("kunci basemap tidak bocor (dilewati - kunci kosong)", True)
        return

    c = TestClient(meta_app())
    for gaya in ("light", "dark"):
        r = c.get(f"/meta/basemap/{gaya}/style.json")
        if r.status_code != 200:
            cek(f"{gaya} (dilewati - hulu {r.status_code})", True)
            continue
        cek(f"{gaya}: kunci tidak ada di badan",
            settings.mapid_maps_api_key not in r.text)
        cek(f"{gaya}: masih JSON gaya yang sah",
            "sources" in r.json() and "layers" in r.json())


if __name__ == "__main__":
    for nama, fn in sorted(globals().items()):
        if nama.startswith("test_"):
            fn()
    cache.bersihkan()
    batas.lupakan()
    print(f"\n{lolos} lolos, {gagal} gagal")
    raise SystemExit(1 if gagal else 0)
