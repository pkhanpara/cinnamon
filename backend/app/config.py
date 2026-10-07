from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    database_url: str = "sqlite:///./data/cinnamon.db"
    finnhub_api_key: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
