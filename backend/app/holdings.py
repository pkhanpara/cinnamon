"""Aggregate positions across accounts into holdings. Pure functions: no I/O, all Decimal math.

Value rules per position (first match wins):
  live/stale quote -> quantity x price      (source "live" / "stale")
  imported value   -> the file's market_value (source "file")
  neither          -> no value              (source "none")
Money is rounded to cents per account line, so merged rows and the summary always equal the
sum of what is displayed. Everything is assumed to be USD.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from app.models import Account, Position
from app.quotes import PricedQuote

CENT = Decimal("0.01")
PCT = Decimal("0.0001")


def _cents(x: Decimal) -> Decimal:
    return x.quantize(CENT, rounding=ROUND_HALF_UP)


def _pct(x: Decimal) -> Decimal:
    return x.quantize(PCT, rounding=ROUND_HALF_UP)


@dataclass
class Line:
    account_id: int
    account_nickname: str
    platform: str
    quantity: Decimal
    cost_basis: Decimal
    value: Decimal | None
    source: str  # live | stale | file | none


@dataclass
class Row:
    symbol: str
    name: str | None
    quantity: Decimal
    cost_basis: Decimal
    price: Decimal | None
    source: str
    value: Decimal | None
    gain: Decimal | None
    gain_pct: Decimal | None
    weight_pct: Decimal | None = None
    day_change: Decimal | None = None
    day_change_pct: Decimal | None = None
    lines: list[Line] = field(default_factory=list)


@dataclass
class Summary:
    total_value: Decimal
    total_cost_basis: Decimal
    gain: Decimal
    gain_pct: Decimal | None
    day_change: Decimal | None
    day_change_pct: Decimal | None
    live_count: int
    stale_count: int
    file_count: int
    unpriced_count: int


def _line(account: Account, pos: Position, quote: PricedQuote | None) -> Line:
    if quote is not None:
        value, source = _cents(pos.quantity * quote.price), "stale" if quote.stale else "live"
    elif pos.market_value is not None:
        value, source = _cents(pos.market_value), "file"
    else:
        value, source = None, "none"
    return Line(
        account.id, account.nickname, account.platform, pos.quantity, pos.cost_basis, value, source
    )


def build(
    positions: Sequence[tuple[Position, Account]], quotes: dict[str, PricedQuote]
) -> tuple[list[Row], Summary]:
    by_symbol: dict[str, list[tuple[Position, Account]]] = {}
    for pos, acct in positions:
        by_symbol.setdefault(pos.symbol, []).append((pos, acct))

    rows: list[Row] = []
    for symbol, items in by_symbol.items():
        quote = quotes.get(symbol)
        lines = [_line(a, p, quote) for p, a in items]
        lines.sort(key=lambda ln: (ln.account_nickname.lower(), ln.account_id))
        qty = sum((ln.quantity for ln in lines), Decimal(0))
        cost = sum((ln.cost_basis for ln in lines), Decimal(0))
        complete = all(ln.value is not None for ln in lines)  # a partial value would mislead
        value = sum((ln.value for ln in lines), Decimal(0)) if complete else None
        source = lines[0].source if complete else "none"
        price = (
            quote.price if quote else (_cents(value / qty) if value is not None and qty else None)
        )
        row = Row(
            symbol=symbol,
            name=next((p.name for p, _ in items if p.name), None),
            quantity=qty,
            cost_basis=cost,
            price=price,
            source=source,
            value=value,
            gain=None if value is None else value - cost,
            gain_pct=_pct((value - cost) / cost * 100) if value is not None and cost else None,
            lines=lines,
        )
        if source == "live" and quote and quote.prev_close:
            row.day_change = _cents(qty * (quote.price - quote.prev_close))
            row.day_change_pct = _pct((quote.price / quote.prev_close - 1) * 100)
        rows.append(row)

    valued = [r for r in rows if r.value is not None]
    total_value = sum((r.value for r in valued), Decimal(0))
    for r in valued:
        r.weight_pct = _pct(r.value / total_value * 100) if total_value else None
    rows.sort(key=lambda r: (r.value is None, -(r.value or 0), r.symbol))

    # Gain only counts rows that have a value, otherwise missing prices would read as huge losses.
    cost_valued = sum((r.cost_basis for r in valued), Decimal(0))
    gain = total_value - cost_valued
    movers = [r for r in rows if r.day_change is not None]
    prev_value = sum((r.value - r.day_change for r in movers), Decimal(0))
    day_change = sum((r.day_change for r in movers), Decimal(0)) if movers else None
    summary = Summary(
        total_value=total_value,
        total_cost_basis=sum((r.cost_basis for r in rows), Decimal(0)),
        gain=gain,
        gain_pct=_pct(gain / cost_valued * 100) if cost_valued else None,
        day_change=day_change,
        day_change_pct=_pct(day_change / prev_value * 100)
        if day_change is not None and prev_value
        else None,
        live_count=sum(r.source == "live" for r in rows),
        stale_count=sum(r.source == "stale" for r in rows),
        file_count=sum(r.source == "file" for r in rows),
        unpriced_count=sum(r.source == "none" for r in rows),
    )
    return rows, summary
