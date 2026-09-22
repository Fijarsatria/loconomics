"""Konfigurasi aplikasi. Seluruh rahasia dibaca dari .env, tidak pernah dari kode."""

import json
from pathlib import Path
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BERKAS_ENV = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BERKAS_ENV, extra="ignore")

    # Supabase - pakai connection string mode "Transaction pooler"
    database_url: str

    mapid_maps_api_key: str = ""

    mapid_basemap_key_peramban: str = ""

    # Akses data misi MAPID (Properti Go / Struk Go / Menu Go / Activities).
    # WAJIB backend-to-backend lewat header x-api-key. Tidak boleh ke frontend.
    mapid_data_api_key: str = ""

    # Provider LLM untuk AI Consultant. MAPID tidak menyediakan token AI.
    # WAJIB backend saja - jangan pernah diteruskan ke frontend dalam bentuk apa pun.
    llm_api_key: str = ""
    llm_api_key_cadangan: str = ""
    llm_provider: str = "anthropic"
    llm_model: str = "claude-opus-5"
    # Untuk penyedia yang kompatibel OpenAI (DashScope/Qwen/DeepSeek).
    llm_base_url: str = ""

    # Plafon biaya AI per hari. Bukan kehati-hatian berlebihan: satu useEffect
    # tanpa dependensi yang benar di frontend sudah cukup untuk memanggil
    # /ai/tanya berulang kali tanpa ada yang menyadarinya sampai tagihan datang.
    llm_plafon_harian_usd: float = 2.0

    ors_api_key: str = ""
    # Kunci ORS KEDUA, khusus profil mobil (`rute_ors.py --mobil`). Terpisah
    # supaya rute mobil tidak menghabiskan jatah harian yang dipakai rute
    # jalan kaki - keduanya berkuota 2.000 permintaan per hari per akun.
    ors_api_key_mobil: str = ""

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

    auth_secret: str = ""

    # "produksi" mengetatkan beberapa hal: /docs disembunyikan dan galat tak
    # terduga tidak pernah membawa pesan aslinya.
    lingkungan: str = "pengembangan"

    @property
    def produksi(self) -> bool:
        return self.lingkungan.lower().startswith("prod")


settings = Settings()
