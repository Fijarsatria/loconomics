"""Konfigurasi aplikasi. Seluruh rahasia dibaca dari .env, tidak pernah dari kode."""

import json
from pathlib import Path
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Jangkar ke LOKASI BERKAS, bukan ke direktori kerja. `env_file=".env"` polos
# cuma bekerja kalau prosesnya kebetulan dijalankan dari backend/ - dan
# pipeline/rute_ors.py meminjam Settings ini dari direktori sebelah, lalu gagal
# dengan pesan "database_url field required" yang tidak menyinggung .env sama
# sekali.
BERKAS_ENV = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BERKAS_ENV, extra="ignore")

    # Supabase - pakai connection string mode "Transaction pooler"
    database_url: str

    # Basemap MAPID MAPS - dipakai proksi gaya di `api/meta.py`, SISI SERVER.
    # JANGAN pernah dipindah ke frontend: briefing MAPID menyebutnya "cuma
    # penghitung pemakaian", tetapi terbukti 26 Agu 2026 kunci Map Services
    # yang sama MEMBUKA data misi (lihat docs/aturan-lomba.md aturan keras 2),
    # dan di lingkungan ini nilainya memang sama dengan MAPID_DATA_API_KEY.
    # Kunci yang hidup di peramban adalah VITE_MAPID_BASEMAP_KEY, kunci lain.
    mapid_maps_api_key: str = ""

    # Kunci basemap KHUSUS PERAMBAN (kunci yang sama dengan VITE_MAPID_BASEMAP_KEY,
    # BUKAN mapid_maps_api_key di atas). Diserahkan lewat /meta/kunci-basemap
    # untuk terbitan yang dibangun tanpa kunci - Cloudflare Pages, yang
    # pengaturannya di luar repo. Kelasnya sama dengan yang sudah ada di bundel
    # GitHub Pages: dijaga pembatasan domain MAPID, bukan kerahasiaan.
    mapid_basemap_key_peramban: str = ""

    # Akses data misi MAPID (Properti Go / Struk Go / Menu Go / Activities).
    # WAJIB backend-to-backend lewat header x-api-key. Tidak boleh ke frontend.
    mapid_data_api_key: str = ""

    # Provider LLM untuk AI Consultant. MAPID tidak menyediakan token AI.
    # WAJIB backend saja - jangan pernah diteruskan ke frontend dalam bentuk apa pun.
    llm_api_key: str = ""
    # Kunci CADANGAN, dipisah koma, dicoba berurutan saat kunci utama kena
    # batas. Hanya berguna kalau tiap kunci dibuat di PROYEK Google yang
    # berbeda: jatah gratis Gemini dihitung per proyek, bukan per kunci -
    # terukur 13 Sep 2026, kunci kedua dari akun yang sama ikut habis bersama.
    llm_api_key_cadangan: str = ""
    llm_provider: str = "anthropic"
    llm_model: str = "claude-opus-5"

    # Plafon biaya AI per hari. Bukan kehati-hatian berlebihan: satu useEffect
    # tanpa dependensi yang benar di frontend sudah cukup untuk memanggil
    # /ai/tanya berulang kali tanpa ada yang menyadarinya sampai tagihan datang.
    llm_plafon_harian_usd: float = 2.0

    # OpenRouteService - routing jalan kaki heksagon -> simpul transportasi.
    # BACKEND SAJA, dan alasannya lebih tajam daripada kunci lain di berkas ini:
    # kuota gratisnya 2.000 permintaan per HARI untuk seluruh akun, jadi kunci
    # yang bocor ke bundel frontend bukan cuma masalah keamanan - satu orang
    # iseng bisa menghabiskan kuota sehari dalam beberapa menit.
    #
    # Yang memakainya cuma pipeline/rute_ors.py, offline. Backend TIDAK pernah
    # memanggil ORS saat melayani permintaan; ia hanya membaca tabel hex_routes.
    ors_api_key: str = ""
    # Kunci ORS KEDUA, khusus profil mobil (`rute_ors.py --mobil`). Terpisah
    # supaya rute mobil tidak menghabiskan jatah harian yang dipakai rute
    # jalan kaki - keduanya berkuota 2.000 permintaan per hari per akun.
    ors_api_key_mobil: str = ""

    # Diisi dari .env sebagai daftar dipisah koma saat deploy, mis.
    # CORS_ORIGINS=https://fijarsatria.github.io,http://localhost:5173
    # 4173 = `vite preview`, yaitu build PRODUKSI yang dijalankan lokal. Ia ada
    # di sini karena menguji build produksi sebelum deploy itu alur yang sah -
    # dan tanpa port ini setiap permintaan dari sana gagal CORS, yang terbaca
    # sebagai "build produksinya rusak" padahal cuma daftarnya yang kurang.
    #
    # `NoDecode` mematikan penguraian JSON bawaan pydantic-settings, dan itu
    # perbaikan sebuah bug yang sudah menunggu di deployment yang belum pernah
    # jalan. Sebuah field `list[str]` diperlakukan sebagai tipe kompleks, jadi
    # nilainya dari environment diurai sebagai JSON - dan daftar dipisah koma
    # yang dijanjikan komentar DUA BARIS DI ATAS bukan JSON yang sah. Akibatnya
    # bukan CORS yang salah melainkan `SettingsError` saat IMPOR: server tidak
    # pernah naik sama sekali.
    #
    # Kenapa tidak pernah ketahuan: `.env` lokal kebetulan ditulis sebagai larik
    # JSON, jadi seluruh uji, seluruh `npm run dev`, dan seluruh smoke test
    # berjalan di atas satu-satunya bentuk yang diterima. Bentuk yang
    # DIDOKUMENTASIKAN tidak pernah sekali pun dieksekusi.
    #
    # Sekarang keduanya diterima, dan itu bukan kelonggaran: yang mengisi kolom
    # ini berikutnya adalah orang yang mengetik di dasbor Render sambil membaca
    # komentar di atas, bukan orang yang ingat bahwa tanda kutip di dalamnya
    # bermakna.
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:4173",
    ]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _urai_asal(cls, v: object) -> object:
        """Terima larik JSON ATAU daftar dipisah koma. Bawaan di kode tetap list."""
        if not isinstance(v, str):
            return v
        teks = v.strip()
        if teks.startswith("["):
            return json.loads(teks)
        return [bagian.strip() for bagian in teks.split(",") if bagian.strip()]

    # Kunci penandatangan tiket sesi. Backend-only tanpa kecuali - siapa pun
    # yang memilikinya bisa menempa tiket untuk akun mana pun, termasuk akun
    # pemilik. Di pengembangan boleh kosong; app/core/akun.py menurunkan kunci
    # sementara dan menolak melakukannya begitu lingkungannya produksi.
    auth_secret: str = ""

    # "produksi" mengetatkan beberapa hal: /docs disembunyikan dan galat tak
    # terduga tidak pernah membawa pesan aslinya.
    lingkungan: str = "pengembangan"

    @property
    def produksi(self) -> bool:
        return self.lingkungan.lower().startswith("prod")


settings = Settings()
