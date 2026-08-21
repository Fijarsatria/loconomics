"""Konfigurasi aplikasi. Seluruh rahasia dibaca dari .env, tidak pernah dari kode."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Supabase - pakai connection string mode "Transaction pooler"
    database_url: str

    # Basemap MAPID MAPS. Aman berada di frontend juga: menurut briefing MAPID,
    # kunci ini hanya penghitung pemakaian dan belum punya pembatasan domain.
    mapid_maps_api_key: str = ""

    # Akses data misi MAPID (Properti Go / Struk Go / Menu Go / Activities).
    # WAJIB backend-to-backend lewat header x-api-key. Tidak boleh ke frontend.
    mapid_data_api_key: str = ""

    # Provider LLM untuk AI Consultant. MAPID tidak menyediakan token AI.
    # WAJIB backend saja - jangan pernah diteruskan ke frontend dalam bentuk apa pun.
    llm_api_key: str = ""
    llm_provider: str = "anthropic"
    llm_model: str = "claude-opus-5"

    # Plafon biaya AI per hari. Bukan kehati-hatian berlebihan: satu useEffect
    # tanpa dependensi yang benar di frontend sudah cukup untuk memanggil
    # /ai/tanya berulang kali tanpa ada yang menyadarinya sampai tagihan datang.
    llm_plafon_harian_usd: float = 2.0

    # Diisi dari .env sebagai daftar dipisah koma saat deploy, mis.
    # CORS_ORIGINS=https://loconomics.mapid.io,https://loconomics.pages.dev
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:5174"]

    # "produksi" mengetatkan beberapa hal: /docs disembunyikan dan galat tak
    # terduga tidak pernah membawa pesan aslinya.
    lingkungan: str = "pengembangan"

    @property
    def produksi(self) -> bool:
        return self.lingkungan.lower().startswith("prod")


settings = Settings()
