"""Portfolio value over time (ADR 0009).

We store only the current snapshot per account, so this is a *back-cast*: today's quantities x
historical closes. It ignores past buys, sells, cash and dividends, and says so in `basis`.
"""

from bisect import bisect_right
from collections.abc import Hashable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, time
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select

from app import holdings as agg
from app.api.deps import CurrentUser, DbDep
from app.api.holdings import _parse_ids
from app.api.symbols import _HISTORY_TTL
from app.cache import history_cache
from app.config import get_settings
from app.models import Account, Position
from app.providers import (
    ProviderError,
    QuoteProvider,
    get_history_provider,
    get_quote_provider,
)
from app.providers.base import Bar, HistoryProvider, HistoryRange
from app.providers.yfinance_history import INTRADAY
from app.quotes import get_quotes

router = APIRouter(prefix="/portfolio", tags=["portfolio"])

BASIS = "backcast"
BENCHMARK = "SPY"
MAX_SYMBOLS = 25  # yfinance is unofficial and rate-limited: bound the fan-out per request
FETCH_WORKERS = 5
_CENT = Decimal("0.01")

HistoryDep = Annotated[HistoryProvider, Depends(get_history_provider)]
QuoteDep = Annotated[QuoteProvider | None, Depends(get_quote_provider)]


class PointOut(BaseModel):
    t: int  # UTC epoch seconds (midnight UTC of the session date for daily ranges)
    d: date
    value: Decimal
    spy_value: Decimal | None = None  # SPY rebased to the portfolio's first value


class SpyComparison(BaseModel):
    change_pct: Decimal | None
    difference_pp: Decimal | None  # portfolio change % minus SPY change %, in percentage points


class PortfolioHistoryOut(BaseModel):
    basis: Literal["backcast"] = BASIS
    range: str
    intraday: bool
    points: list[PointOut]
    start_value: Decimal | None
    end_value: Decimal | None
    change: Decimal | None
    change_pct: Decimal | None
    spy: SpyComparison | None
    symbols: list[str]  # the symbols the chart is built from
    covered_value_pct: Decimal | None  # share of today's value those symbols represent
    warnings: list[str]
    stale: bool
    as_of: datetime | None


def _key(bar: Bar, intraday: bool) -> Hashable:
    return int(bar.time.timestamp()) if intraday else bar.session_date


def _epoch(key: Hashable) -> int:
    if isinstance(key, date):
        return int(datetime.combine(key, time.min, tzinfo=UTC).timestamp())
    return int(key)  # type: ignore[arg-type]


def _day(key: Hashable) -> date:
    return key if isinstance(key, date) else datetime.fromtimestamp(int(key), UTC).date()  # type: ignore[arg-type]


def _pct(change: Decimal, base: Decimal) -> Decimal | None:
    return (change / base * 100).quantize(_CENT) if base != 0 else None


class Series:
    """Closes keyed by bar, readable at any later key by carrying the last close forward."""

    def __init__(self, bars: list[Bar], intraday: bool) -> None:
        pairs = sorted({_key(b, intraday): b.close for b in bars}.items())
        self.keys = [k for k, _ in pairs]
        self.closes = [c for _, c in pairs]

    def at(self, key: Hashable) -> Decimal | None:
        i = bisect_right(self.keys, key) - 1  # type: ignore[arg-type]
        return self.closes[i] if i >= 0 else None


def back_cast(
    quantities: dict[str, Decimal], series: dict[str, Series]
) -> tuple[list[tuple[Hashable, Decimal]], str | None]:
    """Sum quantity x close over the union of bar keys, from the first key at which every symbol
    has a price (so a recent listing shortens the chart instead of faking a jump). Returns the
    points and the symbol that limited the start, if any."""
    if not series:
        return [], None
    starts = {s: ser.keys[0] for s, ser in series.items()}
    limiter = max(starts, key=lambda s: starts[s])
    start = starts[limiter]
    keys = sorted({k for ser in series.values() for k in ser.keys if k >= start})
    points = []
    for k in keys:
        total = sum((quantities[s] * ser.at(k) for s, ser in series.items()), Decimal(0))  # type: ignore[operator]
        points.append((k, total.quantize(_CENT)))
    earliest = min(starts.values())
    return points, (limiter if start > earliest else None)


@router.get("/history")
def portfolio_history(
    user: CurrentUser,
    db: DbDep,
    history_provider: HistoryDep,
    quote_provider: QuoteDep,
    range_: Annotated[HistoryRange, Query(alias="range")] = HistoryRange.M1,
    account_ids: Annotated[
        str | None,
        Query(description="Comma-separated account ids. Omit for all accounts; empty for none."),
    ] = None,
    compare: Annotated[Literal["spy"] | None, Query()] = None,
) -> PortfolioHistoryOut:
    mine = {a.id: a for a in db.scalars(select(Account).where(Account.user_id == user.id))}
    selected = sorted(mine) if account_ids is None else _parse_ids(account_ids)
    if any(i not in mine for i in selected):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")

    positions = (
        [
            (p, mine[p.account_id])
            for p in db.scalars(select(Position).where(Position.account_id.in_(selected)))
        ]
        if selected
        else []
    )
    intraday = range_ in INTRADAY
    warnings: list[str] = []

    def out(**kw) -> PortfolioHistoryOut:
        base = {
            "range": range_.value,
            "intraday": intraday,
            "points": [],
            "start_value": None,
            "end_value": None,
            "change": None,
            "change_pct": None,
            "spy": None,
            "symbols": [],
            "covered_value_pct": None,
            "warnings": warnings,
            "stale": False,
            "as_of": None,
        }
        return PortfolioHistoryOut(**{**base, **kw})

    if not positions:
        return out()

    symbols_all = sorted({p.symbol for p, _ in positions})
    # Quotes only rank symbols for the cap; their warnings belong to the holdings table, not here.
    quotes = get_quotes(db, symbols_all, quote_provider, get_settings().quote_ttl_seconds, [])
    rows, _ = agg.build(positions, quotes)
    quantities = {r.symbol: r.quantity for r in rows}
    values = {r.symbol: r.value for r in rows if r.value is not None}
    total_value = sum(values.values(), Decimal(0))

    # Largest holdings first; the cap drops the long tail, which is named in a warning.
    ranked = sorted(quantities, key=lambda s: (-(values.get(s) or Decimal(0)), s))
    chosen, skipped = ranked[:MAX_SYMBOLS], ranked[MAX_SYMBOLS:]
    if skipped:
        warnings.append(
            f"Chart covers the {MAX_SYMBOLS} largest holdings; left out: {', '.join(skipped)}."
        )

    fetched_at: list[float] = []
    stale = False

    def fetch(symbol: str) -> list[Bar]:
        nonlocal stale
        cached = history_cache.get_or_set(
            (symbol, range_),
            _HISTORY_TTL[range_],
            lambda: history_provider.get_history(symbol, range_),
        )
        stale = stale or cached.stale
        fetched_at.append(cached.fetched_at)
        return cached.value

    wanted = chosen + ([BENCHMARK] if compare == "spy" and BENCHMARK not in chosen else [])
    results: dict[str, list[Bar] | Exception] = {}
    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
        futures = {s: pool.submit(fetch, s) for s in wanted}
        for s, f in futures.items():
            try:
                results[s] = f.result()
            except ProviderError as e:
                results[s] = e

    series: dict[str, Series] = {}
    for s in chosen:
        r = results[s]
        if isinstance(r, Exception):
            warnings.append(f"Price history for {s} is unavailable; it is left out of the chart.")
        elif not r:
            warnings.append(f"No price history for {s}; it is left out of the chart.")
        else:
            series[s] = Series(r, intraday)

    if not series:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Price history is unavailable")

    points, limiter = back_cast({s: quantities[s] for s in series}, series)
    if limiter:
        warnings.append(f"Chart starts when {limiter} began trading; it has no earlier prices.")
    covered = sum((values.get(s, Decimal(0)) for s in series), Decimal(0))

    spy_cmp: SpyComparison | None = None
    spy_series: Series | None = None
    if compare == "spy":
        r = results.get(BENCHMARK)
        if r is None or isinstance(r, Exception) or not r:
            warnings.append("SPY history is unavailable; the comparison is hidden.")
        else:
            spy_series = Series(r, intraday)

    start = points[0][1]
    end = points[-1][1]
    spy_base = spy_series.at(points[0][0]) if spy_series else None
    # SPY may begin after the portfolio's first key (or have no bars at all for it): then no overlay.
    if spy_series and spy_base is None:
        warnings.append("SPY has no prices for the start of this range; the comparison is hidden.")
    spy_vals: list[Decimal | None] = []
    for k, _ in points:
        px = spy_series.at(k) if spy_series and spy_base else None
        spy_vals.append((start * px / spy_base).quantize(_CENT) if px and spy_base else None)

    change = end - start
    change_pct = _pct(change, start)
    if spy_base and spy_vals[-1] is not None:
        spy_pct = _pct(spy_vals[-1] - start, start)
        spy_cmp = SpyComparison(
            change_pct=spy_pct,
            difference_pp=change_pct - spy_pct
            if change_pct is not None and spy_pct is not None
            else None,
        )

    return out(
        points=[
            PointOut(t=_epoch(k), d=_day(k), value=v, spy_value=sv)
            for (k, v), sv in zip(points, spy_vals, strict=True)
        ],
        start_value=start,
        end_value=end,
        change=change,
        change_pct=change_pct,
        spy=spy_cmp,
        symbols=sorted(series),
        covered_value_pct=_pct(covered, total_value) if total_value else None,
        stale=stale,
        as_of=datetime.fromtimestamp(min(fetched_at), UTC) if fetched_at else None,
    )
