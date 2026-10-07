from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    database_url: str = "sqlite:///./data/cinnamon.db"
    finnhub_api_key: str = ""
    finnhub_base_url: str = "https://finnhub.io/api/v1"
    quote_ttl_seconds: int = 60
    session_cookie_name: str = "cinnamon_session"
    session_days: int = 30
    # Set true when served over HTTPS; false allows plain-HTTP LAN use.
    cookie_secure: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
