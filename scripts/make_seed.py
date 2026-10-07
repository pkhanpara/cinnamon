#!/usr/bin/env python3
"""Generate seed CSVs (positions-snapshot layout) from seed/private/holdings.json.

Share quantity is NOT in the source PDF, so it is derived as
market_value / live Finnhub price. The price used and timestamp are written to
each row so the approximation is auditable. Output goes to git-ignored
seed/private/; never commit it (real portfolio data).

Account split is arbitrary test data: ETFs -> m1, everything else -> robinhood.
Usage: python3 scripts/make_seed.py   (needs FINNHUB_API_KEY in .env)
"""
import csv
import json
import os
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ETFS = {"VOO", "VTV", "VXUS"}
FIELDS = ["symbol", "name", "quantity", "cost_basis", "market_value", "price_used", "as_of"]


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


def main() -> None:
    key = load_key()
    data = json.loads((ROOT / "seed/private/holdings.json").read_text())
    as_of = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = {"robinhood": [], "m1": []}
    for h in data["holdings"]:
        price = quote(h["symbol"], key)
        time.sleep(0.1)  # stay well under the 60 calls/min free tier
        rows["m1" if h["symbol"] in ETFS else "robinhood"].append({
            "symbol": h["symbol"], "name": h["name"],
            "quantity": round(h["market_value"] / price, 4),
            "cost_basis": h["cost_basis"], "market_value": h["market_value"],
            "price_used": price, "as_of": as_of,
        })
    for platform, items in rows.items():
        out = ROOT / f"seed/private/{platform}_positions.csv"
        with out.open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=FIELDS)
            w.writeheader()
            w.writerows(items)
        print(f"{out.relative_to(ROOT)}: {len(items)} rows")


if __name__ == "__main__":
    main()
