"""Investing-principles scorecard and peer ("sector") comparison for a symbol (ADR 0012)."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import select

from app import fundamentals as F
from app import principles as P
from app.api.deps import CurrentUser, DbDep
from app.api.symbols import HistoryDep, SymbolDep
from app.cache import company_cache, history_cache
from app.fundamentals_store import get_core, get_cores
from app.models import PrincipleCheck
from app.providers import get_fundamentals_provider, get_ownership_provider
from app.providers.base import (
    FundamentalsProvider,
    HistoryRange,
    OwnershipProvider,
    ProviderError,
)
from app.schemas import (
    BuybackYearOut,
    CashYearOut,
    CheckIn,
    CheckOut,
    EvidenceOut,
    InsiderTradeOut,
    PeerOut,
    PeersOut,
    PeerStatOut,
    PrincipleOut,
    ScorecardOut,
    SplitOut,
)

router = APIRouter(prefix="/principles", tags=["principles"])

FundamentalsDep = Annotated[FundamentalsProvider | None, Depends(get_fundamentals_provider)]
OwnershipDep = Annotated[OwnershipProvider, Depends(get_ownership_provider)]

HISTORY_TTL = 3600  # same as the ticker page's "All" range, so they share one cache entry
INSIDER_TTL = 6 * 3600
SPLITS_TTL = 24 * 3600
PEERS_TTL = 24 * 3600
MAX_PEERS = 10

NO_KEY = "The investing-principles scorecard needs FINNHUB_API_KEY to be set."


def _require(fundamentals: FundamentalsProvider | None) -> FundamentalsProvider:
    if fundamentals is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, NO_KEY)
    return fundamentals


def _unavailable(e: ProviderError) -> HTTPException:
    return HTTPException(
        status.HTTP_502_BAD_GATEWAY, f"Company fundamentals are unavailable right now ({e})."
    )


def _checks(db, user_id: int, symbol: str) -> dict[str, PrincipleCheck]:
    rows = db.scalars(
        select(PrincipleCheck).where(
            PrincipleCheck.user_id == user_id, PrincipleCheck.symbol == symbol
        )
    )
    return {r.key: r for r in rows}


def _check_out(row: PrincipleCheck | None) -> CheckOut | None:
    if row is None:
        return None
    updated = row.updated_at if row.updated_at.tzinfo else row.updated_at.replace(tzinfo=UTC)
    return CheckOut(verdict=row.verdict, note=row.note, updated_at=updated)


def _principles(results: list[F.Result], checks: dict[str, PrincipleCheck]) -> list[PrincipleOut]:
    by_key = {r.key: r for r in results}
    out: list[PrincipleOut] = []
    for p in P.PRINCIPLES:
        r = by_key.get(p.key)
        out.append(
            PrincipleOut(
                key=p.key,
                label=p.label,
                description=p.description,
                kind=p.kind.value,
                rule=p.rule,
                unit=p.unit.value if p.unit else None,
                better=p.better.value if p.better else None,
                value=r.value if r else None,
                status=r.status if r else "manual",
                note=r.note if r else "",
                years=r.years if r else None,
                check=_check_out(checks.get(p.key)),
            )
        )
    return out


@router.get("/{symbol}")
def scorecard(
    symbol: SymbolDep,
    user: CurrentUser,
    db: DbDep,
    fundamentals: FundamentalsDep,
    ownership: OwnershipDep,
    history: HistoryDep,
    evidence: Annotated[bool, Query()] = True,
) -> ScorecardOut:
    """Computed principles, the user's own verdicts, and (with `evidence`) the supporting numbers.
    `evidence=false` skips the insider-trade and split lookups (watchlist rows don't show them)."""
    fp = _require(fundamentals)
    try:
        cached = get_core(db, symbol, fp, ownership)
    except ProviderError as e:
        raise _unavailable(e) from e
    core = cached.data
    warnings = list(core.warnings)
    if cached.stale:
        warnings.append("Showing the last fundamentals we have; the refresh failed.")
    checks = _checks(db, user.id, symbol)
    base = {
        "symbol": symbol,
        "name": core.name,
        "sector": core.sector,
        "industry": core.industry,
        "as_of": cached.fetched_at,
        "stale": cached.stale,
    }
    if core.is_fund:
        return ScorecardOut(
            **base,
            applicable=False,
            principles=[],
            evidence=None,
            warnings=["The investing principles are about companies; this looks like a fund."],
        )

    bars = None
    try:
        bars = history_cache.get_or_set(
            (symbol, HistoryRange.ALL),
            HISTORY_TTL,
            lambda: history.get_history(symbol, HistoryRange.ALL),
        ).value
    except ProviderError as e:
        warnings.append(f"Price history unavailable, so buyback timing is not checked ({e}).")
    results = F.score(core, bars)

    ev = None
    if evidence:
        trades = []
        try:
            all_trades = company_cache.get_or_set(
                ("insider", symbol), INSIDER_TTL, lambda: fp.get_insider_transactions(symbol)
            ).value
            trades = F.recent_open_market(all_trades, datetime.now(UTC).date())
        except ProviderError as e:
            warnings.append(f"Insider trades unavailable ({e}).")
            all_trades = None
        splits = []
        try:
            splits = company_cache.get_or_set(
                ("splits", symbol), SPLITS_TTL, lambda: ownership.get_splits(symbol)
            ).value
        except ProviderError as e:
            warnings.append(f"Stock splits unavailable ({e}).")
        ev = EvidenceOut(
            insider_trades=[
                InsiderTradeOut.model_validate(t, from_attributes=True) for t in trades
            ],
            insider_net_value=None if all_trades is None else F.net_insider_value(trades),
            buybacks=[
                BuybackYearOut.model_validate(b, from_attributes=True)
                for b in (F.buyback_years(core, bars) if bars else [])
            ],
            years=[
                CashYearOut(
                    year=y.year,
                    net_income=y.net_income,
                    owner_earnings=y.owner_earnings,
                    cfo=y.cfo,
                    cff=y.cff,
                    acquisitions=y.acquisitions,
                    buybacks=y.buybacks,
                    rnd=y.rnd,
                    revenue=y.revenue,
                )
                for y in core.years[:10]
            ],
            splits=[SplitOut(date=s.date, ratio=s.ratio) for s in reversed(splits)],
        )
    return ScorecardOut(
        **base,
        applicable=True,
        principles=_principles(results, checks),
        evidence=ev,
        warnings=warnings,
    )


@router.get("/{symbol}/peers")
def peers(
    symbol: SymbolDep,
    _: CurrentUser,
    db: DbDep,
    fundamentals: FundamentalsDep,
    ownership: OwnershipDep,
) -> PeersOut:
    """Mean and median of each computed principle over Finnhub's peer group (same sub-industry).
    Slow the first time (about 3 upstream calls per peer), then served from the DB for a day."""
    fp = _require(fundamentals)
    try:
        peer_symbols = company_cache.get_or_set(
            ("peers", symbol), PEERS_TTL, lambda: fp.get_peers(symbol)
        ).value[:MAX_PEERS]
    except ProviderError as e:
        raise _unavailable(e) from e
    cores, failed = get_cores(db, peer_symbols, fp, ownership)
    companies = {s: c for s, c in cores.items() if not c.data.is_fund}
    scored = {s: F.score(c.data) for s, c in companies.items()}
    return PeersOut(
        symbol=symbol,
        peers=[
            PeerOut(symbol=s, name=companies[s].data.name) for s in peer_symbols if s in companies
        ],
        failed=failed,
        stats=[
            PeerStatOut(key=st.key, mean=st.mean, median=st.median, n=st.n)
            for st in F.peer_stats(scored)
        ],
        stale=any(c.stale for c in companies.values()),
    )


def _principle_key(key: Annotated[str, Path(max_length=40)]) -> str:
    if key not in P.BY_KEY:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown principle {key}")
    return key


KeyDep = Annotated[str, Depends(_principle_key)]


@router.put("/{symbol}/checks/{key}")
def set_check(
    symbol: SymbolDep, key: KeyDep, body: CheckIn, user: CurrentUser, db: DbDep
) -> CheckOut:
    row = db.get(PrincipleCheck, (user.id, symbol, key))
    now = datetime.now(UTC)
    if row is None:
        row = PrincipleCheck(user_id=user.id, symbol=symbol, key=key)
        db.add(row)
    row.verdict, row.note, row.updated_at = body.verdict, body.note.strip(), now
    db.commit()
    return CheckOut(verdict=row.verdict, note=row.note, updated_at=now)


@router.delete("/{symbol}/checks/{key}", status_code=status.HTTP_204_NO_CONTENT)
def clear_check(symbol: SymbolDep, key: KeyDep, user: CurrentUser, db: DbDep) -> None:
    row = db.get(PrincipleCheck, (user.id, symbol, key))
    if row is not None:
        db.delete(row)
        db.commit()
