"""Robinhood Account activity report (web: Account > Reports and statements > Reports), ADR 0013.

Layout of the real export (2026-10): header
    Activity Date, Process Date, Settle Date, Instrument, Description, Trans Code, Quantity, Price, Amount
then one row per transaction, newest first. Descriptions span lines ("Name\\nCUSIP: ..."); the file ends
with a blank line and a disclaimer row whose only text is in a 10th cell. Amounts look like "$1,234.56" or
"($1,234.56)" for money going out.

The report is replayed oldest first into positions with the average-cost method (what the Robinhood app
shows): a buy adds its shares and the cash it cost; a sell or transfer out removes shares at the current
average cost. Only the date range the user picked is in the file, so it must start at account opening;
selling more than is held is reported as a symptom of missing history.

- Shares transferred in (ACATI) carry no cost. Such a symbol needs the user's average cost (from the app)
  and is listed in `needs_average_cost`; its cost basis is then shares x that average cost.
- Options (BTO, STC, STO, BTC, OEXP) are skipped. Assignments and exercises (OASGN, OEXCS) move shares and
  are refused, as is any other unknown code that has an instrument and a quantity.
- Rows without an instrument or quantity (dividends, interest, fees, cash transfers) do not move shares.
"""

import csv
import io
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal

from app.connectors._csv import MAX_ROWS, SYMBOL_RE, decode, is_blank, parse_decimal
from app.connectors.base import ParsedPosition, ParseResult, RowIssue
from app.connectors.robinhood import _norm

DATE, INSTRUMENT, DESCRIPTION = "activity date", "instrument", "description"
CODE, QUANTITY, PRICE, AMOUNT = "trans code", "quantity", "price", "amount"
REQUIRED = (DATE, INSTRUMENT, CODE, QUANTITY, AMOUNT)
CENTS = Decimal("0.01")

BUY, SELL, TRANSFER_IN, TRANSFER_OUT, SPLIT = "BUY", "SELL", "ACATI", "ACATO", "SPL"
OPTION_CODES = frozenset({"BTO", "STC", "STO", "BTC", "OEXP"})
SHARE_MOVING_OPTION_CODES = frozenset({"OASGN", "OEXCS"})

NOT_ACTIVITY = (
    "Not a Robinhood Account activity report: expected the columns Activity Date, Instrument, "
    "Trans Code, Quantity and Amount"
)


@dataclass
class _Holding:
    name: str | None = None
    quantity: Decimal = Decimal(0)
    cost: Decimal = Decimal(0)
    transferred: bool = False  # some shares arrived without a cost
    error: RowIssue | None = None

    def remove(self, qty: Decimal) -> None:
        if qty > self.quantity:
            raise ValueError(
                f"removes {qty} share(s) but only {self.quantity} are held; the report must start "
                "when the account was opened"
            )
        self.cost -= (self.cost * qty / self.quantity) if self.quantity else Decimal(0)
        self.quantity -= qty


@dataclass
class _Row:
    line: int
    date: datetime
    symbol: str
    name: str | None
    code: str
    quantity: Decimal
    amount: Decimal | None
    price: Decimal | None


class RobinhoodActivityConnector:
    slug = "robinhood-activity"
    label = "Robinhood account activity report"
    description = (
        "Robinhood's Account activity report CSV (Account > Reports and statements > Reports), "
        "covering the whole time since the account was opened. Average cost; options are skipped."
    )
    platforms: frozenset[str] = frozenset({"robinhood"})
    accepts_average_costs = True

    def parse(self, data: bytes, average_costs: Mapping[str, Decimal] | None = None) -> ParseResult:
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
        if not all(c in reader.fieldnames for c in REQUIRED):
            result.errors.append(RowIssue(0, NOT_ACTIVITY))
            return result

        rows: list[_Row] = []
        count = 0
        end = reader.line_num  # descriptions span lines: report where each record starts
        for raw in reader:
            line, end = end + 1, reader.line_num
            if is_blank(raw.values()) or not (raw.get(DATE) or "").strip():
                continue  # blank line or the trailing disclaimer
            count += 1
            if count > MAX_ROWS:
                result.errors.append(RowIssue(line, f"More than {MAX_ROWS} rows"))
                return result
            try:
                row = self._row(raw, line)
            except ValueError as e:
                result.errors.append(RowIssue(line, str(e)))
                continue
            if row is not None:
                rows.append(row)
        if not count and not result.errors:
            result.errors.append(RowIssue(0, "File has no data rows"))
            return result

        # Newest first in the file; replay oldest first, keeping the file's order within a day.
        rows.reverse()
        rows.sort(key=lambda r: r.date)
        holdings: dict[str, _Holding] = {}
        for row in rows:
            h = holdings.setdefault(row.symbol, _Holding())
            if h.error:
                continue
            h.name = row.name or h.name
            try:
                self._apply(h, row)
            except ValueError as e:
                h.error = RowIssue(row.line, f"{row.symbol}: {e}")

        self._finish(holdings, average_costs or {}, result)
        return result

    @staticmethod
    def _row(raw: dict[str, str | None], line: int) -> _Row | None:
        """A share-moving row, or None for rows that don't change holdings (cash, options)."""

        def get(key: str) -> str:
            return (raw.get(key) or "").strip()

        code, instrument = get(CODE).upper(), get(INSTRUMENT).upper()
        if not instrument or not get(QUANTITY) or code in OPTION_CODES:
            return None
        if code in SHARE_MOVING_OPTION_CODES:
            raise ValueError(f"{instrument}: option assignment/exercise ({code}) is not supported")
        if code not in (BUY, SELL, TRANSFER_IN, TRANSFER_OUT, SPLIT):
            raise ValueError(f"{instrument}: unsupported transaction code {get(CODE)!r}")
        if not SYMBOL_RE.match(instrument):
            raise ValueError(f"Invalid symbol: {get(INSTRUMENT)!r}")
        try:
            date = datetime.strptime(get(DATE), "%m/%d/%Y").replace(tzinfo=UTC)
        except ValueError:
            raise ValueError(f"Activity Date is not M/D/YYYY: {get(DATE)!r}") from None
        quantity = parse_decimal(get(QUANTITY), "Quantity")
        if quantity <= 0:
            raise ValueError("Quantity must be greater than 0")
        amount = parse_decimal(get(AMOUNT), "Amount") if get(AMOUNT) else None
        price = parse_decimal(get(PRICE), "Price") if get(PRICE) else None
        if code == BUY and amount is None and price is None:
            raise ValueError(f"{instrument}: a buy needs an Amount or a Price")
        name = get(DESCRIPTION).splitlines()[0].strip()[:200] if get(DESCRIPTION) else None
        return _Row(line, date, instrument, name or None, code, quantity, amount, price)

    @staticmethod
    def _apply(h: _Holding, row: _Row) -> None:
        if row.code == BUY:
            # Amount is the cash that left the account (negative); fall back to price x shares.
            cost = -row.amount if row.amount is not None else row.price * row.quantity
            h.quantity += row.quantity
            h.cost += cost
        elif row.code in (SELL, TRANSFER_OUT):
            h.remove(row.quantity)
        elif row.code == TRANSFER_IN:
            h.quantity += row.quantity
            h.transferred = True
        elif row.code == SPLIT:
            h.quantity += row.quantity  # new shares from a forward split; the cost is unchanged

    @staticmethod
    def _finish(
        holdings: dict[str, _Holding], average_costs: Mapping[str, Decimal], result: ParseResult
    ) -> None:
        open_symbols = {s for s, h in holdings.items() if h.quantity > 0 and not h.error}
        needs = sorted(s for s in open_symbols if holdings[s].transferred)
        result.needs_average_cost = needs
        for symbol in sorted(average_costs):
            if symbol not in needs:
                result.errors.append(
                    RowIssue(0, f"{symbol}: no average cost is needed (no transferred shares held)")
                )

        for symbol in sorted(holdings):
            h = holdings[symbol]
            if h.error:
                result.errors.append(h.error)
                continue
            if h.quantity <= 0:
                continue  # fully sold
            if h.transferred:
                avg = average_costs.get(symbol)
                if avg is None:
                    result.errors.append(
                        RowIssue(
                            0,
                            f"{symbol}: shares were transferred in without a cost. Enter the "
                            "average cost the Robinhood app shows for it.",
                        )
                    )
                    continue
                cost = h.quantity * avg
            else:
                cost = h.cost
            result.positions.append(
                ParsedPosition(
                    symbol,
                    h.name,
                    h.quantity,
                    cost.quantize(CENTS, ROUND_HALF_UP),
                    None,
                    None,
                    None,
                )
            )
        result.errors.sort(key=lambda e: e.row)
