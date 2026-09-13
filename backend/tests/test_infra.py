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



def test_kunci_basemap_tidak_pernah_masuk_git():
    """Kunci basemap boleh hidup di peramban; ia tidak boleh hidup di git.

    Keduanya pernyataan yang berbeda, dan yang kedua yang bisa dijaga di sini.
    Kunci itu sampai ke peramban lewat `VITE_MAPID_BASEMAP_KEY` yang diisi
    GitHub Actions dari sebuah secret; berkas gaya di `public/basemap/` tetap
    bersih, dan yang membubuhkannya `transformRequest` MapLibre saat permintaan
    berangkat.

    Yang paling mudah merusaknya: seseorang menjalankan `gaya-basemap.mjs`
    versi lama, atau menempelkan kunci ke `.env.example` "supaya gampang".
    Repositori ini PUBLIK, dan kunci di dalam git dipanen crawler dalam hitungan
    jam - jauh sebelum ada yang membukanya di peramban.
    """
    import re

    akar = Path(__file__).resolve().parents[2]
    heks = re.compile(r"[0-9a-f]{20,40}")

    contoh = (akar / "frontend" / ".env.example").read_text(encoding="utf-8")
    baris = [b for b in contoh.splitlines() if b.startswith("VITE_MAPID_BASEMAP_KEY=")]
    assert baris, ".env.example wajib MENYEBUTKAN variabelnya, supaya tidak dicari-cari"
    assert baris[0].strip() == "VITE_MAPID_BASEMAP_KEY=", (
        f"nilainya harus kosong di .env.example, terbaca: {baris[0]!r}"
    )

    for gaya in sorted((akar / "frontend" / "public" / "basemap").glob("*.json")):
        isi = gaya.read_text(encoding="utf-8")
        assert "key=" not in isi, (
            f"{gaya.name} memuat 'key=' - berkas gaya yang di-commit wajib bersih; "
            "kuncinya dibubuhkan transformRequest saat permintaan berangkat"
        )

    # Dan tidak ada kunci yang menyelinap ke sumber frontend.
    for berkas in (akar / "frontend" / "src").rglob("*.ts*"):
        isi = berkas.read_text(encoding="utf-8")
        for m in re.finditer(r"key=([0-9a-f]{20,40})", isi):
            raise AssertionError(f"{berkas.name}: kunci tertulis di sumber - {m.group(1)[:6]}...")
        _ = heks


def test_backdrop_filter_berawalan_lebih_dulu():
    """`-webkit-backdrop-filter` wajib ditulis SEBELUM `backdrop-filter`.

    Lightning CSS - pemampat CSS Tailwind v4 - menganggap keduanya satu
    properti dan menyimpan yang ditulis belakangan. Urutan terbalik keluar di
    build produksi sebagai `-webkit-backdrop-filter` saja, yang tidak dikenal
    Chrome: seluruh panel kaca peta kehilangan buramnya dan label basemap
    terbaca tajam menembus bilah atas. Dev server tidak memampatkan CSS, jadi
    tidak pernah memperlihatkannya - ditemukan 11 Sep 2026 lewat
    `getComputedStyle` di `vite preview`, sesudah hidup di terbitan publik.

    Diperiksa di SUMBER, bukan di `dist/`: `dist/` tidak di-commit, dan uji yang
    menuntut build dulu adalah uji yang dilewati.
    """
    import re

    akar = Path(__file__).resolve().parents[2]
    salah = []
    for berkas in (akar / "frontend" / "src").rglob("*.css"):
        baris = berkas.read_text(encoding="utf-8").splitlines()
        for i in range(len(baris) - 1):
            if re.match(r"\s*backdrop-filter\s*:", baris[i]) and re.match(
                r"\s*-webkit-backdrop-filter\s*:", baris[i + 1]
            ):
                salah.append(f"{berkas.name}:{i + 1}")
    cek(
        "-webkit-backdrop-filter ditulis sebelum backdrop-filter",
        not salah,
        f"- urutan terbalik di {', '.join(salah)}",
    )


def test_header_keamanan_di_setiap_respons():
    """Header keamanan hilang gagalnya DIAM - tidak ada yang merah, dan tidak
    ada yang terlihat berubah di layar.

    Diukur 13 Sep 2026 di backend PUBLIK: nol dari keempatnya dikirim.
    Frontend sudah lama mengirimnya lewat `_headers` Cloudflare, dan itu yang
    membuat kekosongan di sisi API mudah terlewat - dua terbitan, satu
    diperiksa.
    """
    from fastapi import FastAPI

    from app.main import HEADER_KEAMANAN, app

    assert isinstance(app, FastAPI)
    c = TestClient(app)

    r = c.get("/health")
    for k, v in HEADER_KEAMANAN.items():
        cek(f"sukses membawa {k}", r.headers.get(k) == v, f"- {r.headers.get(k)!r}")

    # Respons GALAT juga. Ia yang paling sering dipakai menyelidiki sebuah API,
    # dan penangan galat membuat responsnya SENDIRI - dependensi tidak berjalan
    # di sana, middleware berjalan.
    rg = c.get("/hex/000000000000000")
    cek("respons galat ikut dijaga", rg.status_code >= 400)
    for k, v in HEADER_KEAMANAN.items():
        cek(f"galat membawa {k}", rg.headers.get(k) == v, f"- {rg.headers.get(k)!r}")

    cek("frame ditolak, bukan sekadar dibatasi", HEADER_KEAMANAN["X-Frame-Options"] == "DENY")
    cek("referrer tidak pernah dibocorkan", HEADER_KEAMANAN["Referrer-Policy"] == "no-referrer")


def test_hsts_hanya_di_produksi():
    """HSTS di localhost mengunci peramban pengembang ke https untuk host yang
    tidak menyajikannya, dan kuncian itu bertahan berbulan-bulan di profilnya.
    """
    from app.core.config import settings
    from app.main import app

    c = TestClient(app)
    r = c.get("/health")
    ada = "Strict-Transport-Security" in r.headers
    cek(
        "HSTS mengikuti mode produksi",
        ada == bool(settings.produksi),
        f"- produksi={settings.produksi} hsts={ada}",
    )


def test_csp_frontend_menyebut_tiap_asal_yang_dipakai():
    """`_headers` adalah berkas konfigurasi, dan berkas konfigurasi yang belum
    pernah dieksekusi adalah kode yang belum pernah dikompilasi (jebakan 10).

    Yang dijaga di sini bukan "CSP-nya ada" melainkan bahwa ia menyebut setiap
    asal yang benar-benar dihubungi aplikasi. Satu asal yang terlupa berarti
    satu bagian peta yang mati tanpa galat yang terlihat pemiliknya.
    """
    from pathlib import Path

    berkas = Path(__file__).resolve().parents[2] / "frontend" / "public" / "_headers"
    cek("_headers ada", berkas.exists())
    if not berkas.exists():
        return
    isi = berkas.read_text(encoding="utf-8")
    baris = [b for b in isi.splitlines() if b.strip().startswith("Content-Security-Policy:")]
    cek("CSP tertulis di _headers", len(baris) == 1, f"- {len(baris)} baris")
    csp = baris[0] if baris else ""
    for asal in (
        "https://basemap.mapid.io",      # ubin, glyph, gaya MAPID
        "https://maputnik.github.io",    # lembar ikon yang dirujuk gaya MAPID
        "https://api.maptiler.com",      # citra satelit, hulu MAPID
        "https://fonts.gstatic.com",     # tipografi
        "loconomics-api.azurewebsites.net",  # backend
    ):
        cek(f"CSP menyebut {asal}", asal in csp)
    for arahan in ("default-src 'self'", "object-src 'none'", "script-src 'self'", "worker-src"):
        cek(f"CSP memuat {arahan}", arahan in csp)
    cek("script-src TIDAK melonggarkan unsafe-inline",
        "script-src 'self';" in csp and "script-src 'self' 'unsafe-inline'" not in csp)


def test_produksi_menutup_seluruh_permukaan_docs():
    """/docs, /redoc DAN /openapi.json - ketiganya, atau tidak ada gunanya.

    Diukur pada terbitan yang hidup 13 Sep 2026: /docs dan /redoc menjawab 404
    sementara /openapi.json menjawab 200 dengan seluruh skemanya. Menempelkan
    skema itu ke editor.swagger.io memberi tombol "Try it out" yang sama persis
    ke API yang sama persis - jadi alasan yang ditulis di `main.py` untuk
    menyembunyikan /docs ("halaman itu mengundang orang mencoba POST /ai/tanya")
    tidak terpenuhi sama sekali.

    Dijalankan di PROSES TERPISAH karena `app` dibangun saat impor: mengubah
    `settings.lingkungan` sesudah `app.main` diimpor tidak mengubah apa pun,
    dan uji yang menambal setelah kejadian akan hijau untuk kode yang rusak.
    """
    import json
    import os
    import subprocess

    KODE = (
        "import json;from app.main import app;"
        "print(json.dumps({'docs': app.docs_url, 'redoc': app.redoc_url, "
        "'openapi': app.openapi_url}))"
    )

    def permukaan(lingkungan: str) -> dict[str, object] | None:
        lingk = {
            **os.environ,
            "LINGKUNGAN": lingkungan,
            # Panjang, supaya penjaga panjang kunci tidak ikut terpicu dan
            # membuat uji ini gagal karena hal yang bukan urusannya.
            "AUTH_SECRET": "u" * 64,
        }
        hasil = subprocess.run(
            [sys.executable, "-c", KODE],
            cwd=str(Path(__file__).resolve().parents[1]),
            capture_output=True, text=True, env=lingk, timeout=180,
        )
        if hasil.returncode != 0:
            cek(f"app bisa diimpor sebagai {lingkungan}", False,
                f"- {hasil.stderr.strip()[-200:]}")
            return None
        return json.loads(hasil.stdout.strip().splitlines()[-1])

    prod = permukaan("produksi")
    if prod is not None:
        for nama in ("docs", "redoc", "openapi"):
            cek(f"produksi menutup {nama}", prod[nama] is None, f"- justru {prod[nama]!r}")

    # Arah sebaliknya. Tanpa ini, tiga asersi di atas tetap hijau seandainya
    # ketiganya dimatikan di SEMUA lingkungan - dan yang hilang bukan keamanan
    # melainkan satu-satunya cara memeriksa API saat mengembangkannya.
    dev = permukaan("pengembangan")
    if dev is not None:
        for nama in ("docs", "redoc", "openapi"):
            cek(f"pengembangan tetap membuka {nama}", dev[nama] is not None,
                "- ikut tertutup")


def test_produksi_menolak_auth_secret_pendek():
    """Kunci pendek bisa dicari OFFLINE, dan tidak ada pembatas yang melihatnya.

    Tiket ditandatangani HMAC-SHA256. Penyerang cuma butuh satu tiket sah -
    setiap pengguna memegang satu di localStorage-nya - lalu menebak kuncinya di
    mesin sendiri tanpa menyentuh server kita sekali pun. Yang menemukannya bisa
    menempa tiket untuk akun mana pun, termasuk akun pemilik.

    Sebelum 13 Sep 2026 yang ditegakkan hanya "tidak kosong", jadi AUTH_SECRET
    bernilai `rahasia` lolos - dan lolosnya DIAM, karena semuanya tetap bekerja.
    """
    from app.core import akun
    from app.core.config import Settings

    asli = akun.settings
    try:
        akun.settings = Settings(lingkungan="produksi", auth_secret="p" * 8)
        try:
            akun.buat_tiket(1)
            cek("produksi menolak AUTH_SECRET pendek", False, "- justru berhasil")
        except RuntimeError as e:
            cek("produksi menolak AUTH_SECRET pendek", True)
            cek("pesannya menyebut panjang minimumnya",
                str(akun.PANJANG_MIN_KUNCI) in str(e), f"- {e}")

        # Yang cukup panjang harus tetap lolos, kalau tidak yang diuji di atas
        # cuma "produksi selalu menolak".
        akun.settings = Settings(
            lingkungan="produksi", auth_secret="q" * akun.PANJANG_MIN_KUNCI
        )
        tiket = akun.buat_tiket(7)
        cek("kunci sepanjang minimum diterima", akun.baca_tiket(tiket) == 7)
    finally:
        akun.settings = asli


def test_penjaga_berat_membatasi_per_akun():
    """Endpoint PDF dibatasi, dan ember-nya per AKUN - bukan per alamat IP.

    Yang dijaga di sini bukan uang melainkan jatah 60 menit CPU per hari milik
    Azure F1: satu PDF memakan 1-3 detik CPU karena ia menggambar belasan
    grafik, dan begitu jatah harian habis SELURUH aplikasi berhenti sampai
    tengah malam - untuk semua orang, termasuk juri.

    Per akun karena juri bisa membuka situs ini dari satu jaringan yang sama;
    batas per IP akan memblokir seorang juri karena juri di sebelahnya baru
    mengunduh PDF.
    """
    from fastapi import Depends
    from app.core import akun as inti_akun

    batas.lupakan()
    app = FastAPI()
    galat.pasang(app)

    @app.get("/berat", dependencies=[Depends(batas.penjaga_berat)])
    def berat() -> dict[str, bool]:
        return {"ok": True}

    klien = TestClient(app)
    kepala = {"Authorization": f"Bearer {inti_akun.buat_tiket(101)}"}
    kode = [klien.get("/berat", headers=kepala).status_code
            for _ in range(batas.MAKS_BERAT + 1)]
    cek(f"{batas.MAKS_BERAT} unduhan pertama lolos",
        kode[:batas.MAKS_BERAT] == [200] * batas.MAKS_BERAT, f"- {kode}")
    cek("unduhan berikutnya dijawab 429", kode[-1] == 429, f"- {kode[-1]}")

    # Akun LAIN dari alamat IP yang sama tidak ikut terblokir. TestClient selalu
    # memakai satu IP, jadi kalau ember-nya per IP baris ini menjawab 429.
    lain = {"Authorization": f"Bearer {inti_akun.buat_tiket(102)}"}
    cek("akun lain dari IP yang sama tidak ikut kena",
        klien.get("/berat", headers=lain).status_code == 200)

    # Tamu tetap dibatasi, hanya kuncinya beralih ke alamat IP.
    batas.lupakan()
    tanpa = [klien.get("/berat").status_code for _ in range(batas.MAKS_BERAT + 1)]
    cek("tamu ikut dibatasi lewat alamat IP", tanpa[-1] == 429, f"- {tanpa[-1]}")
    batas.lupakan()

    # Dan yang paling mudah hilang tanpa suara: apakah penjaganya benar-benar
    # TERPASANG di ketiga rute PDF. Tiga asersi di atas menguji penjaganya, dan
    # penjaga yang sempurna di rute yang tidak memakainya menjaga nol permintaan.
    from app.main import app as app_nyata

    terpasang = {
        r.path: any(
            d.call is batas.penjaga_berat for d in getattr(r, "dependant").dependencies
        )
        for r in app_nyata.routes
        if getattr(r, "path", "").startswith("/akun/laporan")
    }
    cek("ketiga rute PDF ditemukan", len(terpasang) == 3, f"- {sorted(terpasang)}")
    for jalur, ada in sorted(terpasang.items()):
        cek(f"{jalur} memakai penjaga_berat", ada)


def test_csp_meta_disuntikkan_saat_build_bukan_di_sumber():
    """CSP untuk terbitan yang tidak bisa mengirim header - dan HANYA di sana.

    `_headers` cuma dibaca Cloudflare; GitHub Pages mengabaikannya sepenuhnya
    (diukur 2 Sep 2026: nol dari empat headernya muncul). Jadi CSP yang sama
    disalin ke `<meta http-equiv>` - tetapi disuntikkan saat BUILD oleh plugin
    `csp-meta` di vite.config.ts, bukan ditulis di index.html.

    Bedanya bukan gaya. index.html juga dipakai `npm run dev`, dan CSP ini
    mengizinkan `connect-src` hanya ke backend PRODUKSI. Ditulis di sana, ia
    memblokir setiap panggilan ke `http://localhost:8000` dan mematikan seluruh
    pengembangan lokal. Sudah diukur di peramban sebelum dipindahkan: enam
    pelanggaran, peta tanpa satu pun heksagon, dan nol uji yang menangkapnya -
    karena tidak ada uji yang membuka peramban.

    Yang dijaga di sini tiga hal, dan yang ketiga yang paling mudah hilang:
    plugin-nya ada, ia MEMBACA `_headers` alih-alih menyalin kalimatnya, dan
    index.html tetap BERSIH.
    """
    akar_fe = Path(__file__).resolve().parents[2] / "frontend"
    konfig = akar_fe / "vite.config.ts"
    indeks = akar_fe / "index.html"
    cek("vite.config.ts ada", konfig.exists())
    cek("index.html ada", indeks.exists())
    if not (konfig.exists() and indeks.exists()):
        return

    teks = konfig.read_text(encoding="utf-8")
    cek("plugin csp-meta ada", "name: 'csp-meta'" in teks)
    cek("plugin dipasang di daftar plugins",
        "cspDariHeaders()" in teks.split("plugins:")[-1].split("]")[0])
    cek("hanya berlaku saat build", "apply: 'build'" in teks)
    cek("CSP dibaca dari _headers, bukan disalin", "'./public/_headers'" in teks)
    cek("frame-ancestors dibuang dari <meta>", "startsWith('frame-ancestors')" in teks)
    # Build harus GAGAL kalau baris CSP-nya hilang. Build yang diam-diam
    # menghilangkan penjagaan adalah build yang naik ke produksi.
    cek("build gagal kalau _headers kehilangan CSP-nya",
        "TEPAT SATU baris Content-Security-Policy" in teks)

    cek("index.html TIDAK memuat CSP - kalau memuat, `npm run dev` mati",
        "Content-Security-Policy" not in indeks.read_text(encoding="utf-8"))


def test_build_rilis_memperingatkan_tanpa_kunci_basemap():
    """Terbitan publik tanpa kunci basemap = peta putih, dan nol galat.

    Diukur 13 Sep 2026 pada `loconomics.pages.dev` - justru URL yang dipakai
    juri: setiap permintaan ubin berangkat TANPA `?key=`, dan MAPID menolak
    permintaan tanpa kunci sejak 6 Sep. Yang terlihat di layar: label
    mengambang di atas putih, dan satu pita kecil "Ubin MAPID menolak".

    Sebabnya konfigurasi, bukan kode. `pages.yml` mengoper secret
    `MAPID_BASEMAP_KEY` ke build GitHub Pages; Cloudflare Pages membangun
    SENDIRI dari dasbornya, dan variabel itu tidak pernah diisi di sana. Satu
    repo, dua lingkungan build, dan hanya satu yang lengkap - keluarga yang sama
    dengan `_headers` yang berlaku di satu terbitan saja.

    Yang dijaga di sini penjaganya, bukan nilainya: nilai kunci tidak boleh
    masuk git sama sekali (lihat uji di atas).
    """
    akar_fe = Path(__file__).resolve().parents[2] / "frontend"
    konfig = akar_fe / "vite.config.ts"
    cek("vite.config.ts ada", konfig.exists())
    if not konfig.exists():
        return
    teks = konfig.read_text(encoding="utf-8")
    cek("plugin kunci-basemap-wajib ada", "name: 'kunci-basemap-wajib'" in teks)
    cek("ia berjalan saat build", "apply: 'build'" in teks)
    cek("ia membaca VITE_MAPID_BASEMAP_KEY", "VITE_MAPID_BASEMAP_KEY" in teks)
    # Yang membedakan build rilis dari build pengembang: backend yang dituju.
    # Tanpa pembeda ini, penjaganya akan menghentikan `vite build` siapa pun
    # yang tidak punya kuncinya - dan penjaga yang menghalangi pekerjaan biasa
    # adalah penjaga yang dicabut orang berikutnya.
    cek("build pengembang tidak ikut dihentikan",
        "api.startsWith('https://')" in teks)
    cek("pesannya menyebut tempat mengisinya", "Cloudflare Pages" in teks)
    # PERINGATAN, bukan galat (13 Sep 2026 sore). Galat membekukan build
    # Cloudflare sejak 557f949 - URL juri tertinggal seluruh perubahan hari itu,
    # padahal terbitan lama yang ditahannya sama-sama tanpa kunci.
    potong = teks[teks.index("name: 'kunci-basemap-wajib'"):]
    potong = potong[: potong.index("\n}\n")]
    cek("kekosongan kunci DIPERINGATKAN, tidak menghentikan build",
        "logger.warn" in potong and "throw" not in potong)

    alur = AKAR / ".github" / "workflows" / "pages.yml"
    if alur.exists():
        ta = alur.read_text(encoding="utf-8")
        cek("pages.yml mengoper kunci basemap ke build",
            "VITE_MAPID_BASEMAP_KEY:" in ta and "secrets.MAPID_BASEMAP_KEY" in ta)


def test_hambatan_per_menit_bukan_pemadaman_lima_belas_menit():
    """429 "coba lagi 2 detik" tidak boleh mematikan asisten seperempat jam.

    Balasan sungguhan dari terbitan hidup 13 Sep 2026:

        Quota exceeded for metric: generate_content_free_tier_requests,
        limit: 20, model: gemini-3-flash. Please retry in 1.93s

    Dua puluh permintaan per MENIT - bukan per hari - dan disuruh kembali dua
    detik lagi. Sebelum perbaikan ini, hambatan itu menandai penyedianya penuh
    selama `JENDELA_PENUH_DETIK` (15 menit) DAN membuat `/ai/status`
    mengabarkan "jatah hariannya habis": dua pernyataan yang keduanya salah,
    tentang keadaan yang sudah lewat sebelum kalimatnya selesai dibaca.

    Di depan juri yang mencoba fitur berbobot 20% rubrik, selisih antara dua
    detik dan lima belas menit adalah selisih antara jeda dan kegagalan.
    """
    import json as _json
    import time as _time

    from app.core import llm
    from app.core.llm_gemini import batas_harian, lama_menunggu

    PER_MENIT = _json.dumps(
        {
            "error": {
                "code": 429,
                "message": (
                    "You exceeded your current quota. * Quota exceeded for metric: "
                    "generativelanguage.googleapis.com/generate_content_free_tier_requests, "
                    "limit: 20, model: gemini-3-flash\nPlease retry in 1.930699981s."
                ),
                "status": "RESOURCE_EXHAUSTED",
                "details": [
                    {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "2s"}
                ],
            }
        }
    )
    PER_HARI = _json.dumps(
        {
            "error": {
                "code": 429,
                "message": (
                    "Quota exceeded for metric: generate_content_free_tier_requests_PerDay, "
                    "limit: 200, model: gemini-3-flash"
                ),
                "status": "RESOURCE_EXHAUSTED",
            }
        }
    )

    cek("retryDelay penyedianya terbaca", lama_menunggu(PER_MENIT) == 2.0,
        f"- dapat {lama_menunggu(PER_MENIT)!r}")
    cek("kalimatnya terbaca kalau details tidak ada",
        lama_menunggu("Please retry in 1.930699981s.") == 1.930699981)
    cek("balasan tanpa angka menjawab None", lama_menunggu("boom") is None)
    cek("hambatan per menit TIDAK dianggap harian", batas_harian(PER_MENIT) is False)
    cek("jatah harian dikenali sebagai harian", batas_harian(PER_HARI) is True)

    asli = llm._penuh_sampai
    try:
        # Hambatan dua detik -> jendela pendek, dibatasi lantai 30 detik.
        llm.tandai_penyedia_penuh(2.0)
        sisa = llm.sisa_penuh_detik()
        cek("hambatan 2 detik tidak jadi pemadaman 15 menit",
            sisa <= llm.JENDELA_PENUH_MINIMUM, f"- {sisa} detik")
        cek("tetap ditandai penuh, bukan diabaikan", llm.penyedia_penuh() is True)

        # Tanpa keterangan -> kembali ke jendela panjang yang lama.
        llm.tandai_penyedia_penuh(None)
        panjang = llm.sisa_penuh_detik()
        cek("tanpa keterangan tetap 15 menit",
            panjang > llm.JENDELA_PENUH_DETIK - 5, f"- {panjang} detik")

        # Kalimat untuk pengguna ikut berubah menurut lamanya.
        from app.api.ai import _kalimat_dibatasi

        pendek = _kalimat_dibatasi(20)
        lama_k = _kalimat_dibatasi(900)
        cek("kalimat pendek menyebut per menit, bukan harian",
            "per menit" in pendek and "hari" not in pendek, f"- {pendek}")
        cek("kalimat pendek menyebut berapa detik", "20 detik" in pendek, f"- {pendek}")
        cek("kalimat panjang menyebut berapa menit", "15 menit" in lama_k, f"- {lama_k}")
        cek("keduanya tetap menenangkan soal fitur lain",
            "tidak terpengaruh" in pendek and "tidak terpengaruh" in lama_k)
    finally:
        llm._penuh_sampai = asli
    assert _time  # dipakai lewat llm


def test_jendela_penuh_berlipat_sampai_jatahnya_memang_habis():
    """Jangan menebak sebabnya - COBA, lalu percaya hasilnya.

    Diukur 13 Sep 2026 pada ketiga model Gemini sekaligus: balasan 429-nya
    berbunyi `limit: 20` untuk satu model dan `limit: 500` untuk yang lain,
    keduanya dengan saran "Please retry in 1.93s". Kalimat yang sama persis
    untuk dua keadaan yang berbeda jauh - yang satu pulih dua detik kemudian,
    yang lain baru tengah malam waktu Pasifik - dan nama metriknya tidak
    membedakan keduanya.

    Jadi jendelanya tidak ditebak dari pesan melainkan dinaikkan dari
    PENGALAMAN: kegagalan pertama dianggap sesaat, dan tiap kegagalan berikutnya
    yang menyusul tak lama sesudah jendela sebelumnya habis melipatgandakannya
    sampai atap 15 menit. Hambatan sungguhan tidak pernah naik karena percobaan
    berikutnya berhasil; jatah yang benar-benar habis naik ke atapnya dalam
    beberapa percobaan, dan kalimat yang dibaca pengunjung ikut berubah.
    """
    import time as _time

    from app.core import llm

    asli = (llm._penuh_sampai, llm._jendela_terakhir, llm._gagal_terakhir_pada)
    try:
        llm.tandai_penyedia_pulih()
        urut = []
        for _ in range(7):
            llm.tandai_penyedia_penuh(2.0)
            urut.append(llm.sisa_penuh_detik())
            # Seolah percobaan berikutnya menyusul sesudah jendelanya habis.
            llm._gagal_terakhir_pada = _time.time() - 1
        cek("kegagalan pertama tetap pendek", urut[0] <= llm.JENDELA_PENUH_MINIMUM, f"- {urut[0]}")
        cek("jendelanya berlipat", urut[1] >= urut[0] * 2 - 1 and urut[2] >= urut[1] * 2 - 1,
            f"- {urut[:3]}")
        cek("berhenti di atap 15 menit", max(urut) <= llm.JENDELA_PENUH_DETIK, f"- {max(urut)}")
        cek("sampai di atapnya dalam tujuh kegagalan", urut[-1] >= llm.JENDELA_PENUH_DETIK - 2,
            f"- {urut[-1]}")

        # Satu jawaban yang berhasil membuktikan penyedianya sehat.
        llm.tandai_penyedia_pulih()
        llm.tandai_penyedia_penuh(2.0)
        cek("satu keberhasilan menyetel ulang pelipatgandaan",
            llm.sisa_penuh_detik() <= llm.JENDELA_PENUH_MINIMUM, f"- {llm.sisa_penuh_detik()}")

        # Kegagalan yang terpisah jauh bukan beruntun: ia mulai dari pendek lagi.
        llm.tandai_penyedia_penuh(2.0)
        llm._gagal_terakhir_pada = _time.time() - llm.JENDELA_BERUNTUN - 60
        llm.tandai_penyedia_penuh(2.0)
        cek("kegagalan yang terpisah jauh tidak ikut berlipat",
            llm.sisa_penuh_detik() <= llm.JENDELA_PENUH_MINIMUM, f"- {llm.sisa_penuh_detik()}")
    finally:
        llm._penuh_sampai, llm._jendela_terakhir, llm._gagal_terakhir_pada = asli


def test_kunci_gemini_cadangan_dipakai_saat_utama_habis():
    """Kunci utama kena jatah harian -> kunci cadangan menjawab, TANPA menunggu.

    Dan pada pertanyaan berikutnya kunci utama tidak diketuk lagi: "cepat" di
    sini berarti tidak membayar satu perjalanan ke Google untuk pintu yang
    sudah diketahui tertutup. Uji ini memalsukan `urlopen`, jadi tidak ada satu
    pun permintaan sungguhan yang berangkat.
    """
    import io as _io
    import json as _json
    import time as _time
    import urllib.error
    import urllib.request

    from app.core import llm, llm_gemini

    HARIAN = _json.dumps({"error": {"code": 429, "message": "quota", "details": [
        {"violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}
    ]}}).encode()
    BERHASIL = _json.dumps({"candidates": [{"content": {"parts": [{"text": "siap"}]},
                                            "finishReason": "STOP"}],
                            "usageMetadata": {"promptTokenCount": 3, "candidatesTokenCount": 1}}).encode()

    ketukan: list[str] = []

    class _Jawab:
        def __init__(self, isi):
            self._isi = isi
        def read(self):
            return self._isi
        def __enter__(self):
            return _io.BytesIO(self._isi)
        def __exit__(self, *a):
            return False

    def palsu(req, timeout=0):
        kunci = req.get_header("X-goog-api-key")
        ketukan.append(kunci)
        if kunci == "utama":
            raise urllib.error.HTTPError(req.full_url, 429, "quota", {}, _io.BytesIO(HARIAN))
        return _Jawab(BERHASIL)

    asli_open, asli_tidur = urllib.request.urlopen, _time.sleep
    tidur: list[float] = []
    urllib.request.urlopen = palsu
    _time.sleep = lambda d: tidur.append(d)
    llm_gemini.lupakan_jatah()
    try:
        k = llm_gemini.KlienGemini(["utama", "cadangan"])
        argumen = dict(model="gemini-3-flash-preview", max_tokens=50, system="s", tools=[],
                       messages=[{"role": "user", "content": "halo"}])
        b = k.messages.create(**argumen)
        teks = "".join(getattr(x, "text", "") for x in b.content)
        cek("kunci cadangan menjawab saat utama habis", teks == "siap", f"- {teks!r}")
        cek("urutan: utama dulu, lalu cadangan", ketukan[:2] == ["utama", "cadangan"], f"- {ketukan}")
        cek("tidak menunggu sebelum pindah kunci", not tidur, f"- tidur {tidur}")

        ketukan.clear()
        k.messages.create(**argumen)
        cek("pertanyaan berikutnya tidak mengetuk kunci yang habis",
            ketukan == ["cadangan"], f"- {ketukan}")
        cek("catatan memakai URUTAN kunci, bukan nilai kuncinya",
            all(isinstance(ik, int) for ik, _ in llm_gemini._dilewati_sampai))
        cek("jatah harian dikenali dari quotaId", llm_gemini.batas_harian(HARIAN.decode()))
    finally:
        urllib.request.urlopen, _time.sleep = asli_open, asli_tidur
        llm_gemini.lupakan_jatah()
        llm.tandai_penyedia_pulih()


def test_cors_mengizinkan_setiap_metode_yang_dipakai_frontend():
    """Metode yang dipanggil frontend lintas asal WAJIB ada di allow_methods.

    Diukur 13 Sep 2026: `lepasPantauan` memanggil DELETE, `allow_methods` cuma
    GET dan POST, jadi preflight-nya 400 di lokal DAN produksi - "Hapus dari
    simpanan" tidak pernah berhasil dari peramban, dan dialognya menelan
    galatnya diam-diam. Uji ini membaca metode yang BENAR-BENAR dipakai
    `frontend/src/lib/api.ts`, bukan daftar yang diketik ulang di sini.
    """
    import re as _re

    from fastapi.testclient import TestClient as _TC

    from app.main import app as _app

    api_ts = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
    dipakai = set(_re.findall(r"method:\s*'([A-Z]+)'", api_ts)) | {"GET"}
    cek("api.ts memakai lebih dari GET/POST", bool(dipakai - {"GET", "POST"}), f"- {sorted(dipakai)}")
    klien = _TC(_app)
    asal = _app.user_middleware  # noqa: F841 - dibaca lewat respons, bukan konfigurasi
    from app.core.config import settings as _s

    for metode in sorted(dipakai):
        r = klien.options(
            "/akun/pantauan/898c106a693ffff",
            headers={"Origin": _s.cors_origins[0], "Access-Control-Request-Method": metode},
        )
        cek(f"preflight {metode} diizinkan", r.status_code == 200, f"- {r.status_code}")


if __name__ == "__main__":
    for nama, fn in sorted(globals().items()):
        if nama.startswith("test_"):
            fn()
    cache.bersihkan()
    batas.lupakan()
    print(f"\n{lolos} lolos, {gagal} gagal")
    raise SystemExit(1 if gagal else 0)
