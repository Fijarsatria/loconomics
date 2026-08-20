from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    mapid_maps_api_key: str = ""
    llm_api_key: str = ""


settings = Settings()
