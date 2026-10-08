"""Generic "positions snapshot" CSV: cinnamon's own layout, not any broker's native export.

Required columns: symbol, quantity, cost_basis
Optional columns: name, market_value, price_used, as_of (ISO 8601; naive values are taken as UTC)
Headers are case-insensitive. Numbers may contain "$" and "," (stripped); "(1.5)" means -1.5.
One row per symbol.
"""

import csv
import io
from datetime import UTC, datetime

from app.connectors._csv import MAX_ROWS, SYMBOL_RE, decode, is_blank, parse_decimal
from app.connectors.base import ParsedPosition, ParseResult, RowIssue

REQUIRED = ("symbol", "quantity", "cost_basis")


class SnapshotConnector:
    slug = "snapshot"
    label = "Positions snapshot (CSV)"
    description = "symbol, quantity, cost_basis; optional name, market_value, price_used, as_of"
    platforms: frozenset[str] = frozenset()

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
        reader.fieldnames = [(h or "").strip().lower() for h in reader.fieldnames]
        missing = [c for c in REQUIRED if c not in reader.fieldnames]
        if missing:
            result.errors.append(RowIssue(0, f"Missing required column(s): {', '.join(missing)}"))
            return result

        seen: dict[str, int] = {}
        for raw in reader:
            line = reader.line_num
            if is_blank(raw.values()):
                continue  # blank line
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

        symbol = get("symbol").upper()
        if not SYMBOL_RE.match(symbol):
            raise ValueError(f"Invalid symbol: {get('symbol')!r}")

        if not get("quantity"):
            raise ValueError("quantity is required")
        quantity = parse_decimal(get("quantity"), "quantity")
        if quantity <= 0:
            raise ValueError("quantity must be greater than 0")

        if not get("cost_basis"):
            raise ValueError("cost_basis is required")
        cost_basis = parse_decimal(get("cost_basis"), "cost_basis")
        if cost_basis < 0:
            raise ValueError("cost_basis cannot be negative")

        market_value = price = as_of = None
        if get("market_value"):
            market_value = parse_decimal(get("market_value"), "market_value")
            if market_value < 0:
                raise ValueError("market_value cannot be negative")
        if get("price_used"):
            price = parse_decimal(get("price_used"), "price_used")
            if price <= 0:
                raise ValueError("price_used must be greater than 0")
        if get("as_of"):
            try:
                as_of = datetime.fromisoformat(get("as_of"))
            except ValueError:
                raise ValueError(f"as_of is not an ISO 8601 date/time: {get('as_of')!r}") from None
            if as_of.tzinfo is None:
                as_of = as_of.replace(tzinfo=UTC)

        name = get("name")[:200] or None
        return ParsedPosition(symbol, name, quantity, cost_basis, market_value, price, as_of)
