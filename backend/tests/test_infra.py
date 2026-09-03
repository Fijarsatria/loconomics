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


# ---------------------------------------------------------------------------
# Berkas deployment
# ---------------------------------------------------------------------------
#
# Kenapa berkas deployment diuji di sini, bersama galat dan cache: ia sekeluarga
# dengan keduanya. Salah di sini tidak memunculkan pesan apa pun di mesin
# siapa pun - ia baru muncul di layanan yang belum pernah jalan, di hari yang
# tidak bisa dipilih.
#
# Ketiga uji di bawah menutup tiga kerusakan yang benar-benar ada di render.yaml
# sebelum ini, dan ketiganya lolos dari 497 asersi yang sudah ada karena
# semuanya berjalan dengan `.env` lokal - satu-satunya lingkungan yang bentuknya
# kebetulan benar.

AKAR = Path(__file__).resolve().parents[2]


def _render_yaml() -> str:
    """String kosong kalau berkasnya tidak ada.

    Render bukan lagi target utama - tim ini pindah ke Azure karena Render
    menuntut kartu. `render.yaml` dipertahankan sebagai jalan cadangan yang
    sudah benar dan teruji, tetapi ia BOLEH dibuang suatu saat, dan kalau itu
    terjadi berkas uji ini harus melaporkannya sebagai uji yang dilewati -
    bukan meledak dengan `FileNotFoundError` yang menyeret seluruh 51 asersi
    lain ikut mati.
    """
    berkas = AKAR / "render.yaml"
    return berkas.read_text(encoding="utf-8") if berkas.exists() else ""


def _nilai_render(kunci: str) -> str | None:
    """Nilai `value:` sebuah envVar di render.yaml. None kalau bukan literal."""
    import re

    m = re.search(rf'key: {kunci}\s*\n\s*value: "?([^"\n]+)"?', _render_yaml())
    return m.group(1).strip() if m else None


def test_cors_menerima_daftar_dipisah_koma():
    """Bentuk yang DIDOKUMENTASIKAN di config.py, dan yang dipakai render.yaml.

    Sebelum diperbaiki, `list[str]` diurai sebagai JSON oleh pydantic-settings,
    jadi nilai berkoma melempar SettingsError saat IMPOR - server tidak pernah
    naik. Gejalanya bukan CORS yang salah melainkan layanan yang mati total.
    """
    import os

    from app.core.config import Settings

    lama = os.environ.get("CORS_ORIGINS")
    try:
        os.environ["CORS_ORIGINS"] = "https://a.contoh,http://localhost:5173"
        s = Settings()
        cek("koma -> dua asal", s.cors_origins == ["https://a.contoh", "http://localhost:5173"],
            f"- dapat {s.cors_origins!r}")

        # Bentuk yang dipakai .env lokal. Kalau ini pecah, seluruh mesin
        # pengembang ikut pecah - dan itu cara paling cepat membuat perbaikan
        # hari ini dibatalkan besok.
        os.environ["CORS_ORIGINS"] = '["https://b.contoh"]'
        cek("larik JSON tetap diterima", Settings().cors_origins == ["https://b.contoh"])
    finally:
        if lama is None:
            os.environ.pop("CORS_ORIGINS", None)
        else:
            os.environ["CORS_ORIGINS"] = lama


def test_render_yaml_corsnya_benar_benar_terurai():
    """Nilai yang BENAR-BENAR tertulis di render.yaml, bukan contoh karangan."""
    import os

    from app.core.config import Settings

    nilai = _nilai_render("CORS_ORIGINS")
    cek("render.yaml menyetel CORS_ORIGINS", bool(nilai))
    if not nilai:
        return

    lama = os.environ.get("CORS_ORIGINS")
    try:
        os.environ["CORS_ORIGINS"] = nilai
        asal = Settings().cors_origins
        cek("nilainya terurai jadi daftar", len(asal) > 0, f"- dapat {asal!r}")
        # Asal TIDAK memuat jalur. `https://x.github.io/loconomics/` adalah
        # kesalahan yang tampak benar: itu URL situsnya, bukan asalnya, dan
        # peramban tidak akan pernah mencocokkannya.
        cek("tidak ada yang membawa jalur",
            all(a.count("/") == 2 for a in asal),
            f"- {[a for a in asal if a.count('/') != 2]}")
    finally:
        if lama is None:
            os.environ.pop("CORS_ORIGINS", None)
        else:
            os.environ["CORS_ORIGINS"] = lama


def test_render_yaml_menyebut_asal_yang_benar_benar_diterbitkan():
    """Diturunkan dari `git remote`, bukan diketik ulang.

    Uji kesamaan menjaga dua berkas tetap sama; uji ini menjaga render.yaml
    tetap COCOK dengan tempat frontend sungguhan terbit. Sebelum diperbaiki ia
    menunjuk `loconomics.pages.dev` - domain Cloudflare yang tidak pernah jadi
    dipakai, sementara terbitannya GitHub Pages. Keduanya "terlihat benar", dan
    yang membantah cuma kenyataan di luar repo.
    """
    import re
    import subprocess

    try:
        url = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=AKAR, capture_output=True, text=True, timeout=10,
        ).stdout.strip()
    except Exception:
        url = ""

    m = re.search(r"github\.com[:/]([^/]+)/", url)
    if not m:
        cek("asal terbitan cocok (dilewati - remote github tidak terbaca)", True)
        return

    # GitHub Pages menyajikan di <pemilik>.github.io, seluruhnya huruf kecil.
    harapan = f"https://{m.group(1).lower()}.github.io"
    nilai = _nilai_render("CORS_ORIGINS") or ""
    cek(f"render.yaml memuat {harapan}", harapan in nilai, f"- isinya {nilai!r}")


def test_tiket_bentuk_rusak_bukan_500():
    """`Authorization: Bearer a.b.c` harus DITOLAK, bukan meledak.

    `_nyah_b64` melempar `binascii.Error` untuk base64 yang panjangnya tidak
    sah, dan sebelumnya itu tidak ditangkap - jadi satu header sembarang
    menjawab 500 walaupun docstring `baca_tiket` menjanjikan None untuk
    "bentuk rusak". Akibatnya bukan cuma kode status yang keliru: tiap 500
    tercatat sebagai galat TAK TERDUGA berikut `request_id` di log server,
    jadi tiket usang di localStorage seseorang menyamar jadi kerusakan backend
    di tempat yang justru dibaca saat ada kerusakan sungguhan.

    Ditemukan bukan lewat uji melainkan saat menyiapkan pemeriksaan pasca-deploy
    - probe yang seharusnya membedakan AUTH_SECRET ada/tidak menjawab 500 di
    KEDUA keadaan, dan itu yang membongkarnya.
    """
    from app.core import akun

    for rusak in ("a.b.c", "x.y.z", "..", "a.b.!!!!"):
        try:
            hasil = akun.baca_tiket(rusak)
            cek(f"tiket rusak {rusak!r} -> None", hasil is None, f"- dapat {hasil!r}")
        except Exception as e:
            cek(f"tiket rusak {rusak!r} -> None", False, f"- justru melempar {type(e).__name__}")


def test_render_yaml_membawa_auth_secret():
    """Tanpa ini, daftar/masuk menjawab 500 di produksi - dan HANYA itu.

    `_kunci()` dipanggil saat MELAYANI, bukan saat impor, jadi server naik,
    health check hijau, dan peta tergambar. Yang mati cuma pintu masuknya.
    """
    teks = _render_yaml()
    cek("AUTH_SECRET ada di render.yaml", "key: AUTH_SECRET" in teks)
    cek("nilainya dibangkitkan Render, bukan isian manual yang bisa terlupa",
        bool(__import__("re").search(r"key: AUTH_SECRET\s*\n\s*generateValue: true", teks)))


def test_produksi_menolak_menandatangani_tanpa_auth_secret():
    """Penjaganya sendiri, dipaku supaya tidak ada yang 'menyederhanakannya'."""
    from app.core import akun
    from app.core.config import Settings

    asli = akun.settings
    try:
        akun.settings = Settings(lingkungan="produksi", auth_secret="")
        try:
            akun.buat_tiket(1)
            cek("produksi tanpa AUTH_SECRET ditolak", False, "- justru berhasil")
        except RuntimeError:
            cek("produksi tanpa AUTH_SECRET ditolak", True)
    finally:
        akun.settings = asli


def _alur_azure() -> str:
    """Sama dengan `_render_yaml`: kosong kalau berkasnya tidak ada."""
    berkas = AKAR / ".github" / "workflows" / "backend-azure.yml"
    return berkas.read_text(encoding="utf-8") if berkas.exists() else ""


def test_setiap_setting_disebut_di_petunjuk_deploy():
    """Petunjuk deploy yang ditulis tangan selalu ketinggalan satu.

    Terjadi: daftar Application settings di kepala `backend-azure.yml` disalin
    dari `render.yaml` secara manual dan `ORS_API_KEY` tertinggal. Kebetulan
    tidak berakibat apa-apa - kunci itu memang cuma dipakai pipeline - tetapi
    yang tertinggal berikutnya belum tentu seberuntung itu, dan tidak ada satu
    pun uji yang bisa membedakan keduanya.

    Jadi yang dipaku bukan "kunci ini wajib disetel" melainkan "kunci ini wajib
    DISEBUT". Menyebutnya sebagai pengecualian berikut alasannya sama sahnya
    dengan mendaftarkannya - yang tidak boleh cuma satu: diam.
    """
    alur = _alur_azure()
    if not alur:
        cek("petunjuk deploy Azure ada", False, "- backend-azure.yml hilang")
        return

    from app.core.config import Settings

    kepala = alur.split("\nname:", 1)[0]
    hilang = [k.upper() for k in Settings.model_fields if k.upper() not in kepala]
    cek(
        "setiap field Settings disebut di petunjuk deploy",
        not hilang,
        f"- tidak disebut: {', '.join(hilang)}",
    )


def test_petunjuk_deploy_tidak_menyuruh_menyetel_ors():
    """Kunci ORS di satu tempat lagi = risiko tambahan tanpa kemampuan tambahan.

    Kuota gratisnya 2.000 permintaan per HARI untuk seluruh akun, dan backend
    tidak pernah memanggil openrouteservice saat melayani - `pipeline/rute_ors.py`
    yang memakainya, dijalankan manual dari mesin pengembang. Uji ini menjaga
    supaya ia tidak diam-diam masuk lagi saat ada yang 'melengkapi' daftarnya.
    """
    kepala = _alur_azure().split("\nname:", 1)[0]
    if not kepala:
        return
    cek(
        "ORS_API_KEY disebut sebagai pengecualian, bukan sebagai isian",
        "JANGAN disetel di Azure" in kepala,
        "- kalau ia sudah jadi isian biasa, hapus uji ini dengan sadar",
    )


if __name__ == "__main__":
    for nama, fn in sorted(globals().items()):
        if nama.startswith("test_"):
            fn()
    cache.bersihkan()
    batas.lupakan()
    print(f"\n{lolos} lolos, {gagal} gagal")
    raise SystemExit(1 if gagal else 0)
