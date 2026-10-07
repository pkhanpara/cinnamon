"""Quote cache in front of a QuoteProvider (Finnhub free tier allows ~60 calls/minute)."""

import threading
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import QuoteCache
from app.providers import ProviderError, QuoteProvider

_fetch_lock = (
    threading.Lock()
)  # one refresh at a time per process, so concurrent page loads don't stampede


@dataclass(frozen=True)
class PricedQuote:
    price: Decimal
    prev_close: Decimal | None
    fetched_at: datetime
    stale: bool  # True when the provider failed and an expired cache row was served


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)  # SQLite drops tzinfo


def get_quotes(
    db: Session,
    symbols: list[str],
    provider: QuoteProvider | None,
    ttl_seconds: int,
    warnings: list[str],
) -> dict[str, PricedQuote]:
    """Fresh cache hits are served directly; the rest are fetched in one provider call.
    If the provider fails, expired cache rows are served flagged stale. Symbols with no
    quote at all are absent from the result."""
    now = datetime.now(UTC)
    cached = {
        r.symbol: r for r in db.scalars(select(QuoteCache).where(QuoteCache.symbol.in_(symbols)))
    }
    fresh_cutoff = now - timedelta(seconds=ttl_seconds)
    out: dict[str, PricedQuote] = {}
    missing: list[str] = []
    for s in symbols:
        row = cached.get(s)
        if row and _aware(row.fetched_at) >= fresh_cutoff:
            out[s] = PricedQuote(row.price, row.prev_close, _aware(row.fetched_at), False)
        else:
            missing.append(s)

    if missing and provider is not None:
        with _fetch_lock:
            try:
                fetched = provider.get_quotes(missing)
            except ProviderError as e:
                warnings.append(
                    f"Live prices unavailable ({e}); showing the last known or imported values."
                )
                fetched = {}
            for s, q in fetched.items():
                row = cached.get(s)
                if row:
                    row.price, row.prev_close = q.price, q.prev_close
                    row.quote_time, row.fetched_at = q.quote_time, now
                else:
                    db.add(
                        QuoteCache(
                            symbol=s,
                            price=q.price,
                            prev_close=q.prev_close,
                            quote_time=q.quote_time,
                            fetched_at=now,
                        )
                    )
                out[s] = PricedQuote(q.price, q.prev_close, now, False)
            db.commit()
        missing = [s for s in missing if s not in out]
    elif missing and provider is None:
        warnings.append("Live prices are off: FINNHUB_API_KEY is not set. Showing imported values.")

    for s in missing:  # provider failed or doesn't know the symbol: fall back to an expired row
        row = cached.get(s)
        if row:
            out[s] = PricedQuote(row.price, row.prev_close, _aware(row.fetched_at), True)
    return out
