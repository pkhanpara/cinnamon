"""DB-backed cache of `fundamentals.CoreData` per symbol (ADR 0012), shaped like `quotes.py`.

A symbol costs two Finnhub calls (ratios + 10-Ks) and one Yahoo call (ownership). Rows are fresh for a
day, or an hour when a source failed; if a refresh fails, the old row is served flagged stale. Network
fetches for several symbols run in threads, but only the calling thread touches the DB session.
"""

import json
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.fundamentals import CoreData, core_from
from app.models import FundamentalsCache
from app.providers.base import FundamentalsProvider, OwnershipProvider, ProviderError

TTL_COMPLETE = timedelta(hours=24)
TTL_PARTIAL = timedelta(hours=1)
FETCH_WORKERS = 4

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(symbol: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(symbol, threading.Lock())


@dataclass(frozen=True)
class CachedCore:
    data: CoreData
    fetched_at: datetime
    stale: bool


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)  # SQLite drops tzinfo


def fetch_core(
    symbol: str, fundamentals: FundamentalsProvider, ownership: OwnershipProvider
) -> tuple[CoreData, bool]:
    """Network only. Finnhub failures raise ProviderError; a Yahoo failure only marks the data partial."""
    fin = fundamentals.get_basic_financials(symbol)
    reports = fundamentals.get_reported_annual(symbol)
    warnings: list[str] = []
    try:
        own = ownership.get_ownership(symbol)
    except ProviderError as e:
        own = None
        warnings.append(f"Institutional ownership and sector unavailable ({e}).")
    return core_from(symbol, fin, reports, own, warnings), not warnings


def _fresh(row: FundamentalsCache | None, now: datetime) -> bool:
    if row is None:
        return False
    ttl = TTL_COMPLETE if row.complete else TTL_PARTIAL
    return _aware(row.fetched_at) >= now - ttl


def _cached(row: FundamentalsCache, stale: bool) -> CachedCore:
    return CachedCore(CoreData.from_json(json.loads(row.payload)), _aware(row.fetched_at), stale)


def _store(db: Session, data: CoreData, complete: bool) -> CachedCore:
    now = datetime.now(UTC)
    payload = json.dumps(data.to_json())
    row = db.get(FundamentalsCache, data.symbol)  # another request may have inserted it meanwhile
    if row is None:
        db.add(
            FundamentalsCache(
                symbol=data.symbol, payload=payload, complete=complete, fetched_at=now
            )
        )
    else:
        row.payload, row.complete, row.fetched_at = payload, complete, now
    try:
        db.commit()
    except IntegrityError:  # lost an insert race: the other writer's row is just as good
        db.rollback()
    return CachedCore(data, now, False)


def get_core(
    db: Session,
    symbol: str,
    fundamentals: FundamentalsProvider,
    ownership: OwnershipProvider,
) -> CachedCore:
    """Fresh row, else fetch (once per symbol at a time), else the old row flagged stale.
    Raises ProviderError only when nothing was ever cached."""
    with _lock_for(symbol):
        row = db.get(FundamentalsCache, symbol)
        if _fresh(row, datetime.now(UTC)):
            return _cached(row, False)
        try:
            data, complete = fetch_core(symbol, fundamentals, ownership)
        except ProviderError:
            if row is not None:
                return _cached(row, True)
            raise
        return _store(db, data, complete)


def get_cores(
    db: Session,
    symbols: list[str],
    fundamentals: FundamentalsProvider,
    ownership: OwnershipProvider,
    fetch: Callable[..., tuple[CoreData, bool]] = fetch_core,
) -> tuple[dict[str, CachedCore], list[str]]:
    """Many symbols (a peer group). Returns what could be had and the symbols that failed."""
    now = datetime.now(UTC)
    rows = {
        r.symbol: r
        for r in db.scalars(select(FundamentalsCache).where(FundamentalsCache.symbol.in_(symbols)))
    }
    out = {s: _cached(rows[s], False) for s in symbols if _fresh(rows.get(s), now)}
    missing = [s for s in symbols if s not in out]

    def one(symbol: str) -> tuple[CoreData, bool] | ProviderError:
        with _lock_for(symbol):  # don't race a concurrent get_core for the same symbol
            try:
                return fetch(symbol, fundamentals, ownership)
            except ProviderError as e:
                return e

    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
        results = list(pool.map(one, missing))
    failed: list[str] = []
    for symbol, result in zip(missing, results, strict=True):
        if isinstance(result, ProviderError):
            if symbol in rows:
                out[symbol] = _cached(rows[symbol], True)
            else:
                failed.append(symbol)
        else:
            out[symbol] = _store(db, *result)
    return out, failed
