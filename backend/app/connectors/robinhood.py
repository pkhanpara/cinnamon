"""Robinhood positions, typed in from the app (ADR 0013).

Robinhood has no holdings export (ADR 0011): its CSVs are the 1099 tax CSV (realized sales, dividends and
interest for one tax year) and the Account activity report (transactions over a date range). This connector
reads a small hand-made file with the numbers each position's screen in the Robinhood app shows:

Required columns: Symbol, Shares, Average cost
Optional columns: Name, Market value, As of (ISO 8601; naive values are taken as UTC)
Headers are case-insensitive. Numbers may contain "$" and ",". One row per symbol.

Cost basis is shares x average cost, rounded to cents; the app shows the average cost rounded to cents, so the
basis can be off by up to half a cent per share. The two Robinhood exports are recognized and refused with a
message saying why, instead of a missing-column error.
"""

import csv
import io
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal

from app.connectors._csv import MAX_ROWS, SYMBOL_RE, decode, is_blank, parse_decimal
from app.connectors.base import ParsedPosition, ParseResult, RowIssue

SYMBOL, NAME, SHARES, AVG_COST = "symbol", "name", "shares", "average cost"
MARKET_VALUE, AS_OF = "market value", "as of"
REQUIRED = (SYMBOL, SHARES, AVG_COST)
CENTS, PRICE_PLACES = Decimal("0.01"), Decimal("0.0001")

TAX_CSV_HINT = (
    "This is Robinhood's 1099 tax CSV: one tax year of realized sales, dividends and interest, "
    "with no current holdings. Fill in the Robinhood positions template instead "
    "(Symbol, Shares, Average cost from each position in the app)."
)
ACTIVITY_HINT = (
    "This is a Robinhood Account activity report. Turning transactions into positions is not "
    "supported yet; fill in the Robinhood positions template instead "
    "(Symbol, Shares, Average cost from each position in the app)."
)


def _norm(header: str) -> str:
    return " ".join(header.split()).lower()


def _recognize(header: list[str]) -> str | None:
    """A hint when the header row belongs to one of Robinhood's own exports."""
    if header and header[0].upper().startswith("1099-"):
        return TAX_CSV_HINT
    if "activity date" in header and "trans code" in header:
        return ACTIVITY_HINT
    return None


class RobinhoodPositionsConnector:
    slug = "robinhood-positions"
    label = "Robinhood positions (from the app)"
    description = (
        "Symbol, Shares, Average cost as the Robinhood app shows them; optional Name, Market value, "
        "As of. Robinhood's 1099 and activity CSVs have no holdings."
    )
    platforms: frozenset[str] = frozenset({"robinhood"})

    def parse(self, data: bytes) -> ParseResult:
        result = ParseResult()
        text = decode(data)
        if text is None:
            result.errors.append(RowIssue(0, "File is not valid UTF-8 text"))
            return result

        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            result.errors.append(RowIssue(0, "File is empty"))
            return result
        reader.fieldnames = [_norm(h or "") for h in reader.fieldnames]
        if hint := _recognize(reader.fieldnames):
            result.errors.append(RowIssue(0, hint))
            return result
        missing = [c for c in REQUIRED if c not in reader.fieldnames]
        if missing:
            result.errors.append(
                RowIssue(
                    0, f"Missing required column(s): {', '.join(m.capitalize() for m in missing)}"
                )
            )
            return result

        seen: dict[str, int] = {}
        for raw in reader:
            line = reader.line_num
            if is_blank(raw.values()):
                continue
            if len(seen) >= MAX_ROWS:
                result.errors.append(RowIssue(line, f"More than {MAX_ROWS} rows"))
                break
            try:
                pos = self._row(raw)
            except ValueError as e:
                result.errors.append(RowIssue(line, str(e)))
                continue
            if pos.symbol in seen:
                result.errors.append(
                    RowIssue(
                        line, f"Duplicate symbol {pos.symbol} (first on line {seen[pos.symbol]})"
                    )
                )
                continue
            seen[pos.symbol] = line
            result.positions.append(pos)

        if not result.positions and not result.errors:
            result.errors.append(RowIssue(0, "File has no data rows"))
        return result

    @staticmethod
    def _row(raw: dict[str, str | None]) -> ParsedPosition:
        def get(key: str) -> str:
            return (raw.get(key) or "").strip()

        symbol = get(SYMBOL).upper()
        if not SYMBOL_RE.match(symbol):
            raise ValueError(f"Invalid symbol: {get(SYMBOL)!r}")

        if not get(SHARES):
            raise ValueError("Shares is required")
        shares = parse_decimal(get(SHARES), "Shares")
        if shares <= 0:
            raise ValueError("Shares must be greater than 0")

        if not get(AVG_COST):
            raise ValueError("Average cost is required")
        avg_cost = parse_decimal(get(AVG_COST), "Average cost")
        if avg_cost < 0:
            raise ValueError("Average cost cannot be negative")
        cost_basis = (shares * avg_cost).quantize(CENTS, ROUND_HALF_UP)

        market_value = price = as_of = None
        if get(MARKET_VALUE):
            market_value = parse_decimal(get(MARKET_VALUE), "Market value")
            if market_value < 0:
                raise ValueError("Market value cannot be negative")
            if market_value:
                price = (market_value / shares).quantize(PRICE_PLACES, ROUND_HALF_UP)
        if get(AS_OF):
            try:
                as_of = datetime.fromisoformat(get(AS_OF))
            except ValueError:
                raise ValueError(f"As of is not an ISO 8601 date/time: {get(AS_OF)!r}") from None
            if as_of.tzinfo is None:
                as_of = as_of.replace(tzinfo=UTC)

        name = get(NAME)[:200] or None
        return ParsedPosition(symbol, name, shares, cost_basis, market_value, price, as_of)
