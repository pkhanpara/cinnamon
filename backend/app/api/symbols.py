import re
from dataclasses import asdict
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import select

from app import holdings as agg
from app.api.deps import CurrentUser, DbDep
from app.cache import company_cache, history_cache
from app.config import get_settings
from app.models import Account, Position
from app.providers import (
    get_company_provider,
    get_history_provider,
    get_quote_provider,
)
from app.providers.base import (
    CompanyDataProvider,
    HistoryProvider,
    HistoryRange,
    Metrics,
    ProviderError,
    QuoteProvider,
)
from app.providers.yfinance_history import INTRADAY
from app.quotes import get_quotes
from app.ratelimit import SlidingWindowLimiter
from app.schemas import (
    BarOut,
    HistoryOut,
    HoldingOut,
    NewsListOut,
    NewsOut,
    SearchHitOut,
    SymbolOverview,
    SymbolProfile,
    SymbolQuote,
    SymbolStats,
)

router = APIRouter(prefix="/symbols", tags=["symbols"])

SYMBOL_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,14}$"
_SYMBOL_RE = re.compile(SYMBOL_PATTERN)

PROFILE_TTL = 6 * 3600
METRICS_TTL = 3600
NEWS_TTL = 30 * 60
# A refresh never refetches news younger than this many seconds (any user's fetch counts).
NEWS_REFRESH_MIN_AGE = 60
SEARCH_TTL = 300
NEWS_DAYS = 14
NEWS_LIMIT = 20
_HISTORY_TTL = {
    HistoryRange.D1: 60,
    HistoryRange.D5: 300,
    HistoryRange.M1: 900,
    HistoryRange.M6: 900,
    HistoryRange.YTD: 900,
    HistoryRange.Y1: 900,
    HistoryRange.ALL: 3600,
}

CompanyDep = Annotated[CompanyDataProvider | None, Depends(get_company_provider)]
QuoteDep = Annotated[QuoteProvider | None, Depends(get_quote_provider)]
HistoryDep = Annotated[HistoryProvider, Depends(get_history_provider)]


def symbol_param(symbol: Annotated[str, Path(pattern=SYMBOL_PATTERN)]) -> str:
    return symbol.upper()


SymbolDep = Annotated[str, Depends(symbol_param)]


def _unavailable(what: str, e: ProviderError) -> HTTPException:
    return HTTPException(status.HTTP_502_BAD_GATEWAY, f"{what} is unavailable right now ({e}).")


def _whole(millions: Decimal | None, factor: Decimal) -> Decimal | None:
    """Finnhub reports millions with float noise; show whole dollars/shares."""
    return (
        None
        if millions is None
        else (millions * factor).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    )


def _pct(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


@router.get("/search")
def search(
    q: Annotated[str, Query(min_length=1, max_length=40)], _: CurrentUser, company: CompanyDep
) -> list[SearchHitOut]:
    query = " ".join(q.split())
    if not query:
        return []
    if company is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Symbol search needs FINNHUB_API_KEY to be set."
        )
    try:
        hits = company_cache.get_or_set(
            ("search", query.lower()), SEARCH_TTL, lambda: company.search(query)
        ).value
    except ProviderError as e:
        raise _unavailable("Symbol search", e) from e
    return [SearchHitOut(symbol=h.symbol, description=h.description, type=h.type) for h in hits]


@router.get("/{symbol}")
def overview(
    symbol: SymbolDep,
    user: CurrentUser,
    db: DbDep,
    quote_provider: QuoteDep,
    company: CompanyDep,
) -> SymbolOverview:
    warnings: list[str] = []
    quotes = get_quotes(db, [symbol], quote_provider, get_settings().quote_ttl_seconds, warnings)
    quote = quotes.get(symbol)

    profile = stats = None
    if company is None:
        warnings.append("Company details are off: FINNHUB_API_KEY is not set.")
    else:
        try:
            profile = company_cache.get_or_set(
                ("profile", symbol), PROFILE_TTL, lambda: company.get_profile(symbol)
            ).value
            stats = company_cache.get_or_set(
                ("metrics", symbol), METRICS_TTL, lambda: company.get_metrics(symbol)
            ).value
        except ProviderError as e:
            warnings.append(f"Company details unavailable ({e}).")

    positions = [
        (p, a)
        for p, a in db.execute(
            select(Position, Account)
            .join(Account, Account.id == Position.account_id)
            .where(Account.user_id == user.id, Position.symbol == symbol)
        )
    ]
    rows, _ = agg.build(positions, quotes)
    position = HoldingOut.model_validate(asdict(rows[0])) if rows else None

    if quote is None and profile is None and position is None:
        if quote_provider is None and company is None:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Looking up symbols you don't hold needs FINNHUB_API_KEY to be set.",
            )
        if warnings:  # a provider failed, so "unknown" would be a guess
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, f"Could not look up {symbol} right now. {warnings[0]}"
            )
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown symbol {symbol}")

    if stats and quote and stats.week52_low and stats.week52_high:
        lo, hi = stats.week52_low, stats.week52_high
        if not (lo * Decimal("0.8") <= quote.price <= hi * Decimal("1.2")):
            # Seen live: Finnhub returns Class A prices (~$700,000) as BRK.B's 52-week range.
            warnings.append(
                "The 52-week range from Finnhub doesn't match the current price, so it is hidden."
            )
            stats = Metrics(None, None, stats.avg_volume_10d_millions, stats.avg_volume_3m_millions)

    out_quote = None
    if quote is not None:
        live_prev = None if quote.stale else quote.prev_close
        out_quote = SymbolQuote(
            price=quote.price,
            prev_close=quote.prev_close,
            change=None if live_prev is None else quote.price - live_prev,
            change_pct=None if live_prev is None else _pct((quote.price / live_prev - 1) * 100),
            as_of=quote.fetched_at,
            stale=quote.stale,
        )
    million = Decimal(1_000_000)
    return SymbolOverview(
        symbol=symbol,
        name=(profile.name if profile else None) or (position.name if position else None),
        quote=out_quote,
        profile=SymbolProfile(
            name=profile.name,
            exchange=profile.exchange,
            industry=profile.industry,
            country=profile.country,
            currency=profile.currency,
            web_url=profile.web_url,
            market_cap=_whole(profile.market_cap_millions, million),
        )
        if profile
        else None,
        stats=SymbolStats(
            week52_high=stats.week52_high,
            week52_low=stats.week52_low,
            avg_volume_10d=_whole(stats.avg_volume_10d_millions, million),
            avg_volume_3m=_whole(stats.avg_volume_3m_millions, million),
        )
        if stats
        else None,
        position=position,
        warnings=warnings,
    )


@router.get("/{symbol}/history")
def history(
    symbol: SymbolDep,
    _: CurrentUser,
    provider: HistoryDep,
    range_: Annotated[HistoryRange, Query(alias="range")] = HistoryRange.M1,
) -> HistoryOut:
    try:
        cached = history_cache.get_or_set(
            (symbol, range_), _HISTORY_TTL[range_], lambda: provider.get_history(symbol, range_)
        )
    except ProviderError as e:
        raise _unavailable("Price history", e) from e
    if not cached.value:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No price history for {symbol}")
    return HistoryOut(
        symbol=symbol,
        range=range_.value,
        intraday=range_ in INTRADAY,
        bars=[
            BarOut(
                t=int(b.time.timestamp()),
                d=b.session_date,
                o=b.open,
                h=b.high,
                l=b.low,
                c=b.close,
                v=b.volume,
            )
            for b in cached.value
        ],
        stale=cached.stale,
        as_of=datetime.fromtimestamp(cached.fetched_at, UTC),
    )


def _news_out(cached) -> NewsListOut:
    return NewsListOut(
        items=[
            NewsOut(
                headline=n.headline,
                summary=n.summary,
                source=n.source,
                url=n.url,
                published_at=n.published_at,
            )
            for n in cached.value
        ],
        stale=cached.stale,
        as_of=datetime.fromtimestamp(cached.fetched_at, UTC),
    )


@router.get("/{symbol}/news")
def news(symbol: SymbolDep, _: CurrentUser, company: CompanyDep) -> NewsListOut:
    if company is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "News needs FINNHUB_API_KEY to be set."
        )
    try:
        cached = company_cache.get_or_set(
            ("news", symbol), NEWS_TTL, lambda: company.get_news(symbol, NEWS_DAYS, NEWS_LIMIT)
        )
    except ProviderError as e:
        raise _unavailable("News", e) from e
    return _news_out(cached)


# Refresh budget (Finnhub allows 60 calls/min for everyone): one upstream call per user and symbol
# per minute, ten per user per minute across symbols. Only calls that reach Finnhub are counted.
_refresh_per_symbol = SlidingWindowLimiter(limit=1, window=60)
_refresh_per_user = SlidingWindowLimiter(limit=10, window=60)


def reset_news_refresh_limits() -> None:
    _refresh_per_symbol.clear()
    _refresh_per_user.clear()


@router.post("/{symbol}/news/refresh")
def refresh_news(symbol: SymbolDep, user: CurrentUser, company: CompanyDep) -> NewsListOut:
    """Refetch news now, bypassing the 30-minute cache. If the refetch fails the previous items are
    returned flagged stale; if the news is younger than a minute no upstream call is made."""
    if company is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "News needs FINNHUB_API_KEY to be set."
        )
    sym_key = (user.id, symbol)
    wait = max(_refresh_per_symbol.retry_after(sym_key), _refresh_per_user.retry_after(user.id))
    if wait:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many news refreshes. Try again in {wait} s.",
            headers={"Retry-After": str(wait)},
        )
    fetched = False

    def fetch():
        nonlocal fetched
        fetched = True
        return company.get_news(symbol, NEWS_DAYS, NEWS_LIMIT)

    try:
        # Using the minimum age as the TTL gives the refresh its age floor, single-flight and
        # stale-on-error behaviour from the same cache entry that GET /news serves.
        cached = company_cache.get_or_set(("news", symbol), NEWS_REFRESH_MIN_AGE, fetch)
    except ProviderError as e:
        raise _unavailable("News", e) from e
    finally:
        if fetched:  # failures count too: the upstream call was spent
            _refresh_per_symbol.hit(sym_key)
            _refresh_per_user.hit(user.id)
    return _news_out(cached)
