#!/usr/bin/env python3
"""Generate seed CSVs (positions-snapshot layout) from seed/private/holdings.json.

Share quantity is NOT in the source PDF, so it is derived as
market_value / live Finnhub price. The price used and timestamp are written to
each row so the approximation is auditable. Output goes to git-ignored
seed/private/; never commit it (real portfolio data).

Account split is arbitrary test data. Symbols listed in SPLITS are divided across
accounts by fixed fractions (the last leg takes the rounding remainder, so each symbol's
quantity, cost basis and market value still sum to the PDF's). Every other symbol goes to
m1 if it is an ETF, else robinhood. Files for accounts that are no longer produced are
not deleted; remove them by hand.
Usage: python3 scripts/make_seed.py   (needs FINNHUB_API_KEY in .env)
"""
import csv
import json
import time
import urllib.request
from collections.abc import Callable
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ETFS = {"VOO", "VTV", "VXUS"}
ACCOUNTS = ("robinhood", "m1", "schwab")
FIELDS = ["symbol", "name", "quantity", "cost_basis", "market_value", "price_used", "as_of"]
CENT = Decimal("0.01")
QTY = Decimal("0.0001")


def _d(*fractions: str) -> list[Decimal]:
    return [Decimal(f) for f in fractions]


# symbol -> [(account, fraction)]; fractions must sum to exactly 1
SPLITS: dict[str, list[tuple[str, Decimal]]] = {
    "NVDA": list(zip(("robinhood", "m1"), _d("0.6", "0.4"))),
    "MSFT": list(zip(("robinhood", "m1", "schwab"), _d("0.5", "0.3", "0.2"))),
    "VOO": list(zip(("m1", "robinhood"), _d("0.5", "0.5"))),
    "AAPL": list(zip(("robinhood", "schwab"), _d("0.7", "0.3"))),
}


def load_key() -> str:
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("FINNHUB_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("FINNHUB_API_KEY missing from .env")


def quote(symbol: str, key: str) -> float:
    url = f"https://finnhub.io/api/v1/quote?symbol={symbol}&token={key}"
    with urllib.request.urlopen(url, timeout=15) as r:
        price = json.load(r).get("c")
    if not price:
        raise SystemExit(f"no price returned for {symbol}")
    return float(price)


def split_amount(total: Decimal, fractions: list[Decimal], places: Decimal) -> list[Decimal]:
    """Split total by fractions; the last part is the remainder so the parts sum exactly."""
    parts = [(total * f).quantize(places, rounding=ROUND_HALF_UP) for f in fractions[:-1]]
    parts.append(total - sum(parts, Decimal(0)))
    return parts


def check_splits(symbols: set[str], splits: dict[str, list[tuple[str, Decimal]]]) -> None:
    for symbol, legs in splits.items():
        if symbol not in symbols:
            raise ValueError(f"SPLITS names {symbol}, which is not in holdings.json")
        if len(legs) < 2:
            raise ValueError(f"{symbol}: a split needs at least two legs")
        if any(f <= 0 for _, f in legs) or sum(f for _, f in legs) != 1:
            raise ValueError(f"{symbol}: fractions must be > 0 and sum to exactly 1")
        accounts = [a for a, _ in legs]
        if len(set(accounts)) != len(accounts):
            raise ValueError(f"{symbol}: an account appears twice")
        if unknown := set(accounts) - set(ACCOUNTS):
            raise ValueError(f"{symbol}: unknown account(s) {sorted(unknown)}")


def build_rows(
    holdings: list[dict],
    price_of: Callable[[str], float],
    as_of: str,
    splits: dict[str, list[tuple[str, Decimal]]] = SPLITS,
) -> dict[str, list[dict]]:
    """Return account -> CSV rows. Pure apart from price_of; validates before returning."""
    check_splits({h["symbol"] for h in holdings}, splits)
    rows: dict[str, list[dict]] = {a: [] for a in ACCOUNTS}
    for h in holdings:
        symbol = h["symbol"]
        market_value = Decimal(str(h["market_value"]))
        cost_basis = Decimal(str(h["cost_basis"]))
        price = Decimal(str(price_of(symbol)))
        quantity = (market_value / price).quantize(QTY, rounding=ROUND_HALF_UP)
        legs = splits.get(symbol) or [("m1" if symbol in ETFS else "robinhood", Decimal(1))]
        fractions = [f for _, f in legs]
        qtys = split_amount(quantity, fractions, QTY)
        costs = split_amount(cost_basis, fractions, CENT)
        values = split_amount(market_value, fractions, CENT)
        for (account, _), q, c, v in zip(legs, qtys, costs, values):
            if q <= 0 or c < 0 or v < 0:
                raise ValueError(f"{symbol}/{account}: leg is not positive (q={q}, c={c}, v={v})")
            rows[account].append({
                "symbol": symbol, "name": h["name"], "quantity": q, "cost_basis": c,
                "market_value": v, "price_used": price, "as_of": as_of,
            })
    check_totals(holdings, rows)
    return rows


def check_totals(holdings: list[dict], rows: dict[str, list[dict]]) -> None:
    for account, items in rows.items():
        symbols = [r["symbol"] for r in items]
        if len(set(symbols)) != len(symbols):
            raise ValueError(f"{account}: duplicate symbol in one file")
    for h in holdings:
        legs = [r for items in rows.values() for r in items if r["symbol"] == h["symbol"]]
        for field in ("cost_basis", "market_value"):
            if sum(r[field] for r in legs) != Decimal(str(h[field])):
                raise ValueError(f"{h['symbol']}: {field} legs do not sum to holdings.json")


def main() -> None:
    key = load_key()
    data = json.loads((ROOT / "seed/private/holdings.json").read_text())
    as_of = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    def price_of(symbol: str) -> float:
        price = quote(symbol, key)
        time.sleep(0.1)  # stay well under the 60 calls/min free tier
        return price

    rows = build_rows(data["holdings"], price_of, as_of)  # nothing is written if this raises
    for platform, items in rows.items():
        out = ROOT / f"seed/private/{platform}_positions.csv"
        with out.open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=FIELDS)
            w.writeheader()
            w.writerows(items)
        total = sum(r["market_value"] for r in items)
        print(f"{out.relative_to(ROOT)}: {len(items)} rows, market_value {total}")
    print(f"grand total market_value: {sum(r['market_value'] for i in rows.values() for r in i)}")


if __name__ == "__main__":
    main()
