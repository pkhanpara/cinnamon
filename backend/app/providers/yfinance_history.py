"""Price history from Yahoo Finance via the unofficial `yfinance` package.

Unofficial means it can break or get rate-limited without notice: that is why it sits behind the
HistoryProvider interface and why failures surface as ProviderError, never as a crash.
Finnhub's own candle endpoint is paywalled on the free tier (HTTP 403, checked 2026-10-07).
"""

import logging
import math
from datetime import UTC, date
from decimal import Decimal

from app.providers.base import Bar, HistoryRange, ProviderError

# yfinance logs "possibly delisted" at ERROR for every unknown symbol; we report that ourselves.
logging.getLogger("yfinance").setLevel(logging.CRITICAL)

# range -> (yfinance period, interval). 1d fetches 5 days and keeps the last session, so weekends,
# holidays and pre-market hours still show the most recent trading day instead of an empty chart.
_PLAN: dict[HistoryRange, tuple[str, str]] = {
    HistoryRange.D1: ("5d", "5m"),
    HistoryRange.D5: ("5d", "15m"),
    HistoryRange.M1: ("1mo", "1d"),
    HistoryRange.M6: ("6mo", "1d"),
    HistoryRange.YTD: ("ytd", "1d"),
    HistoryRange.Y1: ("1y", "1d"),
    HistoryRange.ALL: ("max", "1wk"),
}

INTRADAY = {HistoryRange.D1, HistoryRange.D5}


def _missing(x: object) -> bool:
    return x is None or (isinstance(x, float) and math.isnan(x))


def _dec(x: float) -> Decimal:
    return Decimal(str(round(float(x), 4)))


class YFinanceHistory:
    def get_history(self, symbol: str, range_: HistoryRange) -> list[Bar]:
        import yfinance as yf  # heavy import (pandas): only when history is actually requested

        period, interval = _PLAN[range_]
        # Yahoo writes class shares with a dash (BRK-B); brokers often use a dot (BRK.B).
        yahoo_symbol = symbol.replace(".", "-")
        try:
            df = yf.Ticker(yahoo_symbol).history(
                period=period, interval=interval, auto_adjust=False, timeout=10
            )
        except Exception as e:  # yfinance raises many unrelated types
            raise ProviderError(f"Yahoo Finance request failed: {type(e).__name__}") from e

        bars: list[Bar] = []
        for ts, row in df.iterrows():
            close = row.get("Close")
            if _missing(close):
                continue
            volume = row.get("Volume")
            ts_utc = ts.tz_convert(UTC) if ts.tzinfo else ts.tz_localize(UTC)
            session: date = ts.date()  # tz-aware index: this is the exchange-local date
            bars.append(
                Bar(
                    time=ts_utc.to_pydatetime(),
                    session_date=session,
                    open=_dec(row["Open"]),
                    high=_dec(row["High"]),
                    low=_dec(row["Low"]),
                    close=_dec(close),
                    volume=0 if _missing(volume) else int(volume),
                )
            )
        if range_ is HistoryRange.D1 and bars:
            last = bars[-1].session_date
            bars = [b for b in bars if b.session_date == last]
        return bars
