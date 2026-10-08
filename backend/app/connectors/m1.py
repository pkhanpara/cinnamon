"""M1 Finance "Open tax lots" CSV (web: Invest > Holdings > Download > Open tax lots).

Layout of the real export (2026-10): a couple of single-cell disclaimer lines, then the header
    Symbol, Cusip, Acquisition Date, Quantity, Cost Basis, Short/Long Term Holding,
    Unrealized Gain/Loss, Close Date, Short Term Realized Gain/Loss, Long Term Realized Gain/Loss,
    Wash Sale Indicator, Disallowed Wash Sale Amount, M1 Tax Lot Id
and one row per tax lot. Lots are summed per symbol; market value is cost basis + unrealized
gain/loss. The file carries no date (M1 says it reflects the prior trading day close), so as_of is
left empty. The Closed tax lots export has the same header with Close Date filled in; it is refused.
"""

import csv
import io
from dataclasses import dataclass
from decimal import Decimal

from app.connectors._csv import MAX_ROWS, SYMBOL_RE, decode, is_blank, parse_decimal
from app.connectors.base import ParsedPosition, ParseResult, RowIssue

HEADER_SCAN_LINES = 10
SYMBOL, QUANTITY, COST_BASIS = "symbol", "quantity", "cost basis"
UNREALIZED, CLOSE_DATE = "unrealized gain/loss", "close date"
REQUIRED = (SYMBOL, QUANTITY, COST_BASIS)
PRICE_PLACES = Decimal("0.0001")


def _norm(header: str) -> str:
    return " ".join(header.split()).lower()


@dataclass
class _Holding:
    quantity: Decimal = Decimal(0)
    cost_basis: Decimal = Decimal(0)
    market_value: Decimal | None = Decimal(0)  # None once any lot lacks an unrealized gain/loss


class M1TaxLotsConnector:
    slug = "m1-tax-lots"
    label = "M1 Finance holdings (open tax lots CSV)"
    description = (
        "M1 web: Invest > Holdings > Download > Open tax lots. Lots are summed per symbol; "
        "market value = cost basis + unrealized gain/loss."
    )
    platforms: frozenset[str] = frozenset({"m1"})

    def parse(self, data: bytes) -> ParseResult:
        result = ParseResult()
        text = decode(data)
        if text is None:
            result.errors.append(RowIssue(0, "File is not valid UTF-8 text"))
            return result

        reader = csv.reader(io.StringIO(text))
        header = None
        for record in reader:
            cells = [_norm(c) for c in record]
            if all(c in cells for c in REQUIRED):
                header = cells
                break
            if reader.line_num >= HEADER_SCAN_LINES:
                break
        if header is None:
            if not text.strip():
                msg = "File is empty"
            else:
                msg = "Not an M1 Open tax lots export (no Symbol, Quantity and Cost Basis header)"
            result.errors.append(RowIssue(0, msg))
            return result

        holdings: dict[str, _Holding] = {}  # insertion order = first appearance in the file
        bad: set[str] = set()
        lots = 0
        for record in reader:
            line = reader.line_num
            if is_blank(record):
                continue
            if lots >= MAX_ROWS:
                result.errors.append(RowIssue(line, f"More than {MAX_ROWS} rows"))
                break
            lots += 1
            raw = dict(zip(header, (c.strip() for c in record), strict=False))
            if raw.get(CLOSE_DATE):
                result.positions.clear()
                result.errors = [
                    RowIssue(0, "This looks like the Closed tax lots file; download Open tax lots")
                ]
                return result
            symbol = (raw.get(SYMBOL) or "").upper()
            if not SYMBOL_RE.match(symbol):
                result.errors.append(RowIssue(line, f"Invalid symbol: {raw.get(SYMBOL, '')!r}"))
                continue
            try:
                self._add_lot(holdings.setdefault(symbol, _Holding()), raw)
            except ValueError as e:
                result.errors.append(RowIssue(line, f"{symbol}: {e}"))
                bad.add(symbol)

        for symbol, h in holdings.items():
            if symbol in bad:
                continue  # a partly-read holding would understate the position
            price = None
            if h.market_value is not None:
                price = (h.market_value / h.quantity).quantize(PRICE_PLACES)
            result.positions.append(
                ParsedPosition(symbol, None, h.quantity, h.cost_basis, h.market_value, price)
            )

        if not result.positions and not result.errors:
            result.errors.append(RowIssue(0, "File has no data rows"))
        return result

    @staticmethod
    def _add_lot(h: _Holding, raw: dict[str, str]) -> None:
        if not raw.get(QUANTITY):
            raise ValueError("Quantity is required")
        quantity = parse_decimal(raw[QUANTITY], "Quantity")
        if quantity <= 0:
            raise ValueError("Quantity must be greater than 0")

        if not raw.get(COST_BASIS):
            raise ValueError("Cost Basis is required")
        cost_basis = parse_decimal(raw[COST_BASIS], "Cost Basis")
        if cost_basis < 0:
            raise ValueError("Cost Basis cannot be negative")

        value = None
        if raw.get(UNREALIZED):
            value = cost_basis + parse_decimal(raw[UNREALIZED], "Unrealized Gain/Loss")
            if value < 0:
                raise ValueError("Cost Basis + Unrealized Gain/Loss is negative")

        h.quantity += quantity
        h.cost_basis += cost_basis
        h.market_value = None if value is None or h.market_value is None else h.market_value + value
