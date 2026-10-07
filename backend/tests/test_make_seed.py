import csv
import importlib.util
import io
from decimal import Decimal as D
from pathlib import Path

import pytest

from app.connectors.snapshot import SnapshotConnector

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "make_seed.py"
_spec = importlib.util.spec_from_file_location("make_seed", _SCRIPT)
ms = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ms)

AS_OF = "2026-01-01T00:00:00Z"
PRICES = {"NVDA": 125.0, "MSFT": 400.0, "VOO": 500.0, "AAPL": 190.0, "KO": 60.0, "VTV": 150.0}
# values chosen so that no 3-way or 60/40 split divides evenly into cents
HOLDINGS = [
    {"symbol": "NVDA", "name": "Nvidia", "cost_basis": 1000.01, "market_value": 12345.67},
    {"symbol": "MSFT", "name": "Microsoft", "cost_basis": 777.77, "market_value": 10000.01},
    {"symbol": "VOO", "name": "Vanguard S&P", "cost_basis": 5000.0, "market_value": 25000.03},
    {"symbol": "AAPL", "name": "Apple", "cost_basis": 100.05, "market_value": 3333.33},
    {"symbol": "KO", "name": "Coca-Cola", "cost_basis": 50.0, "market_value": 600.0},
    {"symbol": "VTV", "name": "Vanguard Value", "cost_basis": 70.0, "market_value": 1500.0},
]


def build(holdings=HOLDINGS, splits=None, price_of=None):
    return ms.build_rows(
        holdings,
        price_of or PRICES.__getitem__,
        AS_OF,
        ms.SPLITS if splits is None else splits,
    )


def legs(rows, symbol):
    return [(a, r) for a, items in rows.items() for r in items if r["symbol"] == symbol]


def test_split_symbols_sum_exactly_to_the_source():
    rows = build()
    for h in HOLDINGS:
        got = [r for _, r in legs(rows, h["symbol"])]
        assert sum(r["market_value"] for r in got) == D(str(h["market_value"]))
        assert sum(r["cost_basis"] for r in got) == D(str(h["cost_basis"]))
        total_qty = (D(str(h["market_value"])) / D(str(PRICES[h["symbol"]]))).quantize(ms.QTY)
        assert sum(r["quantity"] for r in got) == total_qty


def test_grand_total_and_row_count():
    rows = build()
    assert sum(r["market_value"] for i in rows.values() for r in i) == sum(
        D(str(h["market_value"])) for h in HOLDINGS
    )
    extra = sum(len(legs_) - 1 for legs_ in ms.SPLITS.values())
    assert sum(len(i) for i in rows.values()) == len(HOLDINGS) + extra


def test_split_symbols_span_the_configured_accounts():
    rows = build()
    for symbol, cfg in ms.SPLITS.items():
        assert {a for a, _ in legs(rows, symbol)} == {a for a, _ in cfg}
    assert len({a for a, _ in legs(rows, "MSFT")}) == 3


def test_unsplit_routing_is_unchanged():
    rows = build()
    assert [a for a, _ in legs(rows, "KO")] == ["robinhood"]
    assert [a for a, _ in legs(rows, "VTV")] == ["m1"]


def test_remainder_goes_to_the_last_leg_and_is_exact():
    third = [D(1) / 3, D(1) / 3, D(1) - 2 * (D(1) / 3)]
    parts = ms.split_amount(D("100.00"), third, ms.CENT)
    assert parts == [D("33.33"), D("33.33"), D("33.34")]
    assert sum(parts) == D("100.00")


def test_generated_csvs_round_trip_through_the_connector():
    for account, items in build().items():
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=ms.FIELDS)
        w.writeheader()
        w.writerows(items)
        result = SnapshotConnector().parse(buf.getvalue().encode())
        assert result.errors == [], account
        assert len(result.positions) == len(items)


def test_deterministic():
    assert build() == build()


def test_unknown_split_symbol_is_rejected():
    with pytest.raises(ValueError, match="not in holdings.json"):
        build(splits={"ZZZZ": [("m1", D("0.5")), ("robinhood", D("0.5"))]})


@pytest.mark.parametrize(
    "legs_",
    [
        [("m1", D("0.5")), ("robinhood", D("0.6"))],  # sums to 1.1
        [("m1", D(1)), ("robinhood", D(0))],  # zero fraction
        [("m1", D("0.5")), ("m1", D("0.5"))],  # same account twice
        [("m1", D(1))],  # not a split
        [("m1", D("0.5")), ("nowhere", D("0.5"))],  # unknown account
    ],
)
def test_bad_split_config_is_rejected(legs_):
    with pytest.raises(ValueError):
        build(splits={"NVDA": legs_})


def test_zero_quantity_leg_is_rejected():
    tiny = [{"symbol": "NVDA", "name": "Nvidia", "cost_basis": 1.0, "market_value": 0.01}]
    with pytest.raises(ValueError, match="not positive"):
        build(holdings=tiny, splits={"NVDA": [("m1", D("0.5")), ("robinhood", D("0.5"))]})


def test_split_rounds_half_up_in_decimal_not_float():
    # 0.35 * 0.5 = 0.175 exactly in Decimal (-> 0.18); the float 0.175 is just below it
    parts = ms.split_amount(D("0.35"), [D("0.5"), D("0.5")], ms.CENT)
    assert parts == [D("0.18"), D("0.17")]


def test_configured_overlap_covers_the_todo_requirements():
    assert {"NVDA", "MSFT", "VOO"} <= set(ms.SPLITS)
    assert 3 <= len(ms.SPLITS) <= 4
    assert max(len(v) for v in ms.SPLITS.values()) == 3  # at least one three-account symbol
