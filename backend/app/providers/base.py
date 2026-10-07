"""Market-data provider interfaces. Providers fetch; they never touch the database."""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
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
