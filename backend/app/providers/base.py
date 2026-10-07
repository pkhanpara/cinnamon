"""Market-data provider interfaces. Providers fetch; they never touch the database."""

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Protocol


class ProviderError(Exception):
    """The provider could not answer at all (network, auth, rate limit)."""


@dataclass(frozen=True)
class Quote:
    symbol: str
    price: Decimal
    prev_close: Decimal | None
    quote_time: datetime | None  # time of the last trade, if the provider says


class QuoteProvider(Protocol):
    def get_quotes(self, symbols: list[str]) -> dict[str, Quote]:
        """Quotes for the symbols it knows. Unknown symbols are simply absent from the result.

        Raises ProviderError only when nothing useful could be fetched (e.g. auth failure, 429).
        """
        ...


class HistoryRange(StrEnum):
    D1 = "1d"
    D5 = "5d"
    M1 = "1m"
    M6 = "6m"
    YTD = "ytd"
    Y1 = "1y"
    ALL = "all"


@dataclass(frozen=True)
class Bar:
    time: datetime  # bar start, UTC
    session_date: date  # trading date in the exchange's own time zone (for daily/weekly bars)
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int


class HistoryProvider(Protocol):
    def get_history(self, symbol: str, range_: HistoryRange) -> list[Bar]:
        """Oldest first. An unknown symbol yields an empty list; ProviderError means "could not ask"."""
        ...


@dataclass(frozen=True)
class Profile:
    name: str | None
    exchange: str | None
    industry: str | None
    country: str | None
    currency: str | None
    web_url: str | None  # http(s) only
    market_cap_millions: Decimal | None  # USD millions, as Finnhub reports it


@dataclass(frozen=True)
class Metrics:
    week52_high: Decimal | None
    week52_low: Decimal | None
    avg_volume_10d_millions: Decimal | None  # millions of shares
    avg_volume_3m_millions: Decimal | None


@dataclass(frozen=True)
class NewsItem:
    headline: str
    summary: str
    source: str
    url: str
    published_at: datetime


@dataclass(frozen=True)
class SearchHit:
    symbol: str
    description: str
    type: str


class CompanyDataProvider(Protocol):
    def get_profile(self, symbol: str) -> Profile | None:
        """None when the provider has no profile (it has none for ETFs)."""
        ...

    def get_metrics(self, symbol: str) -> Metrics | None: ...

    def get_news(self, symbol: str, days: int, limit: int) -> list[NewsItem]: ...

    def search(self, query: str) -> list[SearchHit]: ...
