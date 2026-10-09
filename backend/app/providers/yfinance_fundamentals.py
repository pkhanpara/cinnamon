"""Institutional ownership, sector and splits from Yahoo Finance via `yfinance` (ADR 0012).

Finnhub's ownership endpoint is premium (HTTP 403 on the free key, checked 2026-10-08), so this is the
only free source. Like `yfinance_history`, failures surface as ProviderError, never as a crash.
"""

import math
from decimal import Decimal

from app.providers.base import Ownership, ProviderError, Split


def _text(value: object, limit: int = 100) -> str | None:
    if not isinstance(value, str):
        return None
    return " ".join(value.split())[:limit] or None


def _fraction(value: object) -> Decimal | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or math.isnan(value):
        return None
    d = Decimal(str(value))
    return d if Decimal(0) <= d <= Decimal("1.5") else None  # Yahoo sometimes reports a bit over 1


class YFinanceOwnership:
    def _ticker(self, symbol: str):
        import yfinance as yf  # heavy import (pandas): only when needed

        return yf.Ticker(symbol.replace(".", "-"))  # Yahoo writes class shares as BRK-B

    def get_ownership(self, symbol: str) -> Ownership | None:
        try:
            info = self._ticker(symbol).info
        except Exception as e:  # yfinance raises many unrelated types
            raise ProviderError(f"Yahoo Finance request failed: {type(e).__name__}") from e
        if not isinstance(info, dict) or not info.get("quoteType"):
            return None
        return Ownership(
            institutional_pct=_fraction(info.get("heldPercentInstitutions")),
            sector=_text(info.get("sector")),
            industry=_text(info.get("industry")),
            quote_type=_text(info.get("quoteType"), 20),
            name=_text(info.get("longName") or info.get("shortName"), 200),
        )

    def get_splits(self, symbol: str) -> list[Split]:
        try:
            series = self._ticker(symbol).splits
        except Exception as e:
            raise ProviderError(f"Yahoo Finance request failed: {type(e).__name__}") from e
        splits: list[Split] = []
        for ts, ratio in series.items():
            if isinstance(ratio, int | float) and not math.isnan(ratio) and ratio > 0:
                splits.append(Split(date=ts.date(), ratio=Decimal(str(round(float(ratio), 4)))))
        return sorted(splits, key=lambda s: s.date)
