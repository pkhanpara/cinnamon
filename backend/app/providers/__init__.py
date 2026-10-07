from app.config import get_settings
from app.providers.base import ProviderError, Quote, QuoteProvider
from app.providers.finnhub import FinnhubProvider


def get_quote_provider() -> QuoteProvider | None:
    """FastAPI dependency. None when no API key is configured (holdings then use file values)."""
    s = get_settings()
    return FinnhubProvider(s.finnhub_api_key, s.finnhub_base_url) if s.finnhub_api_key else None


__all__ = ["ProviderError", "Quote", "QuoteProvider", "get_quote_provider"]
