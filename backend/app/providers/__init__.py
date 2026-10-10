import logging
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
    SecFilingsProvider,
)
from app.providers.edgar import EdgarProvider, valid_user_agent
from app.providers.finnhub import FinnhubProvider
from app.providers.yfinance_fundamentals import YFinanceOwnership
from app.providers.yfinance_history import YFinanceHistory

log = logging.getLogger(__name__)


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


@lru_cache
def _edgar(user_agent: str) -> EdgarProvider | None:
    if not valid_user_agent(user_agent):
        log.warning("SEC_USER_AGENT must be printable ASCII with a contact email; EDGAR is off")
        return None
    return EdgarProvider(user_agent)  # one instance per process, so its throttle is process-wide


def get_edgar_provider() -> SecFilingsProvider | None:
    """SEC EDGAR company facts (ADR 0017). None unless SEC_USER_AGENT is set and valid."""
    user_agent = get_settings().sec_user_agent.strip()
    return _edgar(user_agent) if user_agent else None


__all__ = [
    "ProviderError",
    "Quote",
    "QuoteProvider",
    "get_company_provider",
    "get_edgar_provider",
    "get_fundamentals_provider",
    "get_history_provider",
    "get_ownership_provider",
    "get_quote_provider",
]
