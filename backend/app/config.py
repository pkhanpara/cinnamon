from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    database_url: str = "sqlite:///./data/cinnamon.db"
    # Run `alembic upgrade head` on startup. Tests turn this off (they use in-memory DBs).
    auto_migrate: bool = True
    finnhub_api_key: str = ""
    finnhub_base_url: str = "https://finnhub.io/api/v1"
    quote_ttl_seconds: int = 60
    # Optional OpenAI-compatible chat endpoint for the ticker page's news summary and chat (ADR 0008).
    # Feature is off unless both the base URL and the model are set.
    llm_base_url: str = ""
    llm_model: str = ""
    llm_api_key: str = ""
    llm_timeout_seconds: float = 60
    # Send chat_template_kwargs.enable_thinking=false (llama.cpp servers): thinking models such as
    # llama-swap's dt-default otherwise spend their output on reasoning we don't show. On by default;
    # set false for hosted APIs (OpenAI) that reject unknown request fields.
    llm_disable_thinking: bool = True
    # Cap on the answer length. Generous because it is a ceiling, not a target; hosted APIs have lower
    # model limits (OpenAI rejects values above the model's), so lower it there.
    llm_max_tokens: int = 96_000
    llm_max_news_items: int = 15
    session_cookie_name: str = "cinnamon_session"
    session_days: int = 30
    # Seeded on a brand-new database only, and must be changed at first sign-in (ADR 0004).
    default_admin_username: str = "admin"
    default_admin_password: str = "$admin123456"
    # Set true when served over HTTPS; false allows plain-HTTP LAN use.
    cookie_secure: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
