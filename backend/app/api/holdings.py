from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from app import holdings as agg
from app.api.deps import CurrentUser, DbDep
from app.config import get_settings
from app.models import Account, Position
from app.providers import QuoteProvider, get_quote_provider
from app.quotes import get_quotes
from app.schemas import HoldingOut, HoldingsOut, HoldingsSummary

router = APIRouter(prefix="/holdings", tags=["holdings"])


def _parse_ids(raw: str) -> list[int]:
    if raw.strip() == "":
        return []
    try:
        return list(dict.fromkeys(int(x) for x in raw.split(",")))
    except ValueError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "account_ids must be comma-separated integers"
        ) from None


@router.get("")
def get_holdings(
    user: CurrentUser,
    db: DbDep,
    provider: Annotated[QuoteProvider | None, Depends(get_quote_provider)],
    account_ids: Annotated[
        str | None,
        Query(description="Comma-separated account ids. Omit for all accounts; empty for none."),
    ] = None,
) -> HoldingsOut:
    mine = {a.id: a for a in db.scalars(select(Account).where(Account.user_id == user.id))}
    if account_ids is None:
        selected = sorted(mine)
    else:
        selected = _parse_ids(account_ids)
        if any(i not in mine for i in selected):  # 404, same as the other account endpoints
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")

    positions = (
        [
            (p, mine[p.account_id])
            for p in db.scalars(select(Position).where(Position.account_id.in_(selected)))
        ]
        if selected
        else []
    )

    warnings: list[str] = []
    symbols = sorted({p.symbol for p, _ in positions})
    quotes = (
        get_quotes(db, symbols, provider, get_settings().quote_ttl_seconds, warnings)
        if symbols
        else {}
    )
    rows, summary = agg.build(positions, quotes)

    if summary.unpriced_count:
        warnings.append(
            f"{summary.unpriced_count} holding(s) have no price and are left out of the totals."
        )
    fresh = [quotes[r.symbol].fetched_at for r in rows if r.source == "live"]
    return HoldingsOut(
        account_ids=selected,
        summary=HoldingsSummary(**asdict(summary)),
        holdings=[HoldingOut.model_validate(asdict(r)) for r in rows],
        warnings=warnings,
        prices_as_of=max(fresh) if fresh else None,
    )
