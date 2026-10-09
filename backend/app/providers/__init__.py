from functools import lru_cache

from app.config import get_settings
from app.providers.base import (
    CompanyDataProvider,
    FundamentalsProvider,
    HistoryProvider,
    OwnershipProvider,
    ProviderError,
    Quote,
    QuoteProvider,
)
from app.providers.finnhub import FinnhubProvider
from app.providers.yfinance_fundamentals import YFinanceOwnership
from app.providers.yfinance_history import YFinanceHistory


@lru_cache
def _finnhub(api_key: str, base_url: str) -> FinnhubProvider:
    return FinnhubProvider(api_key, base_url)  # one pooled HTTP client for the whole process


def get_quote_provider() -> QuoteProvider | None:
    """FastAPI dependency. None when no API key is configured (holdings then use file values)."""
    s = get_settings()
    return _finnhub(s.finnhub_api_key, s.finnhub_base_url) if s.finnhub_api_key else None


def get_company_provider() -> CompanyDataProvider | None:
    """Profile, key stats, news and symbol search (Finnhub). None without an API key."""
    s = get_settings()
    return _finnhub(s.finnhub_api_key, s.finnhub_base_url) if s.finnhub_api_key else None


def get_history_provider() -> HistoryProvider:
    return YFinanceHistory()


def get_fundamentals_provider() -> FundamentalsProvider | None:
    """Ratios, 10-K figures, peers and insider trades (Finnhub). None without an API key."""
    s = get_settings()
    return _finnhub(s.finnhub_api_key, s.finnhub_base_url) if s.finnhub_api_key else None


def get_ownership_provider() -> OwnershipProvider:
    return YFinanceOwnership()


__all__ = [
    "ProviderError",
    "Quote",
    "QuoteProvider",
    "get_company_provider",
    "get_fundamentals_provider",
    "get_history_provider",
    "get_ownership_provider",
    "get_quote_provider",
]
