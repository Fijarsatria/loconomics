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
    # WAJIB backend saja.
    llm_api_key: str = ""
    llm_provider: str = ""

    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:5174"]


settings = Settings()
