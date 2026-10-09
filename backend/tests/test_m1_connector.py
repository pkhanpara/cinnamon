"""M1 open tax lots connector. All data here is fabricated."""

from decimal import Decimal
from pathlib import Path

import pytest

from app import connectors
from app.connectors.m1 import M1TaxLotsConnector

SAMPLE = Path(__file__).resolve().parents[2] / "seed" / "sample" / "m1_open_tax_lots.csv"
parse = M1TaxLotsConnector().parse

# The real export's layout: two single-cell disclaimer lines, then the header on line 3.
PREAMBLE = '"**This data is being provided for general and reference purposes only."\n" Note."\n'
HEADER = (
    "Symbol,Cusip,Acquisition Date,Quantity,Cost Basis,Short/Long Term Holding,"
    "Unrealized Gain/Loss,Close Date,Short Term Realized Gain/Loss,Long Term Realized Gain/Loss,"
    "Wash Sale Indicator,Disallowed Wash Sale Amount,M1 Tax Lot Id\n"
)


def lot(symbol="VTI", qty="1", cost="100.00", ugl="10.00", close="", lot_id="1"):
    return f"{symbol},922908769,2025-01-02,{qty},{cost},Long,{ugl},{close},,,false,,{lot_id}\n"


def m1(*lots: str) -> bytes:
    return (PREAMBLE + HEADER + "".join(lots)).encode()


def msgs(result):
    return [(e.row, e.message) for e in result.errors]


def test_parses_committed_sample_file():
    r = parse(SAMPLE.read_bytes())
    assert r.errors == []
    got = {p.symbol: (p.quantity, p.cost_basis, p.market_value, p.price) for p in r.positions}
    # Same per-symbol totals as the snapshot-format seed/sample/m1_positions.csv.
    assert got == {
        "VTI": (Decimal(30), Decimal(7000), Decimal(8100), Decimal(270)),
        "SCHD": (Decimal(80), Decimal(6000), Decimal(6400), Decimal(80)),
        "ORCL": (Decimal(10), Decimal(1400), Decimal(1700), Decimal(170)),
    }
    assert [p.symbol for p in r.positions] == ["VTI", "SCHD", "ORCL"]  # first-appearance order
    assert all(p.name is None and p.as_of is None for p in r.positions)


def test_lots_aggregate_per_symbol_exactly():
    r = parse(m1(lot(qty="0.1", cost="0.10", ugl="0.01"), lot(qty="0.2", cost="0.20", ugl="0.02")))
    (p,) = r.positions
    assert p.quantity == Decimal("0.3") and p.cost_basis == Decimal("0.30")  # no float drift
    assert p.market_value == Decimal("0.33") and p.price == Decimal("1.1000")


def test_fractional_quantities_and_price_rounding():
    (p,) = parse(m1(lot(qty="0.12345", cost="10.00", ugl="0.00"))).positions
    assert p.quantity == Decimal("0.12345")
    assert p.price == Decimal("81.0045")  # 10 / 0.12345, rounded to 4 places


def test_market_value_from_cost_plus_ugl_including_losses():
    (p,) = parse(m1(lot(cost="100.00", ugl="25.50"), lot(cost="50.00", ugl="-12.34"))).positions
    assert p.cost_basis == Decimal("150.00") and p.market_value == Decimal("163.16")


def test_market_value_none_when_any_lot_lacks_ugl():
    (p,) = parse(m1(lot(ugl="5.00"), lot(ugl=""))).positions
    assert p.cost_basis == Decimal("200.00")
    assert p.market_value is None and p.price is None


def test_unrealized_column_is_optional():
    r = parse(b"Symbol,Quantity,Cost Basis\nVTI,2,500\n")
    assert r.errors == [] and r.positions[0].market_value is None


def test_parenthesised_and_formatted_numbers():
    (p,) = parse(m1(lot(qty='"1,000"', cost='"$1,000.00"', ugl="(100.00)"))).positions
    assert p.quantity == Decimal(1000) and p.market_value == Decimal("900.00")


def test_closed_lots_file_rejected_with_hint():
    r = parse(m1(lot(), lot(close="2026-01-05")))
    assert r.positions == []
    assert msgs(r) == [(0, "This looks like the Closed tax lots file; download Open tax lots")]


def test_holdings_file_rejected_with_hint():
    holdings = SAMPLE.with_name("m1_holdings.csv").read_bytes()
    r = parse(holdings)
    assert r.positions == []
    assert msgs(r) == [
        (0, "This looks like the M1 Holdings file; choose the M1 Finance Holdings CSV format")
    ]


@pytest.mark.parametrize(
    "data",
    [
        b"symbol,quantity,cost_basis\nVTI,1,1\n",  # cinnamon's snapshot format
        b"1099-B,ACCOUNT NUMBER,TAX YEAR,SHARES,COST BASIS\n",  # a Robinhood 1099 CSV
        b"Symbol,Quantity\nVTI,1\n",
        (PREAMBLE * 5 + HEADER + lot()).encode(),  # header past the scan window
    ],
)
def test_not_an_m1_export(data):
    r = parse(data)
    assert r.positions == [] and r.errors[0].row == 0
    assert "Not an M1 Open tax lots export" in r.errors[0].message


def test_headers_case_and_space_insensitive_bom_and_crlf():
    data = "﻿SYMBOL , quantity,Cost  Basis,Unrealized gain/loss\r\nvti,1,10,1\r\n"
    r = parse(data.encode())
    assert r.errors == [] and r.positions[0].symbol == "VTI"
    assert r.positions[0].market_value == Decimal(11)


@pytest.mark.parametrize(
    ("row", "fragment"),
    [
        (lot(qty="0"), "VTI: Quantity must be greater than 0"),
        (lot(qty="-1"), "VTI: Quantity must be greater than 0"),
        (lot(qty="NaN"), "VTI: Quantity must be a finite number"),
        (lot(qty="abc"), "VTI: Quantity is not a number: 'abc'"),
        (lot(qty=""), "VTI: Quantity is required"),
        (lot(cost=""), "VTI: Cost Basis is required"),
        (lot(cost="-1"), "VTI: Cost Basis cannot be negative"),
        (lot(ugl="x"), "VTI: Unrealized Gain/Loss is not a number: 'x'"),
        (lot(cost="10", ugl="-11"), "VTI: Cost Basis + Unrealized Gain/Loss is negative"),
        (lot(symbol=""), "Invalid symbol: ''"),
        (lot(symbol="=CMD()"), "Invalid symbol: '=CMD()'"),
        (lot(symbol="K O"), "Invalid symbol: 'K O'"),
    ],
)
def test_bad_lot_rows_report_line_and_reason(row, fragment):
    r = parse(m1(row))
    assert r.positions == []
    assert msgs(r) == [(4, fragment)]  # line 4 = first data row after 2 disclaimers + header


def test_symbol_with_a_bad_lot_is_dropped_others_survive():
    r = parse(m1(lot("VTI"), lot("ORCL"), lot("VTI", qty="x"), lot("BRK.B")))
    assert [p.symbol for p in r.positions] == ["ORCL", "BRK.B"]
    assert msgs(r) == [(6, "VTI: Quantity is not a number: 'x'")]


def test_blank_lines_are_skipped_and_line_numbers_stay_physical():
    r = parse(m1(lot(), "\n", ",,,,\n", lot(qty="0")))
    assert len(r.errors) == 1 and r.errors[0].row == 7


@pytest.mark.parametrize(
    ("data", "fragment"),
    [
        (b"", "File is empty"),
        (b"\n\n", "File is empty"),
        (m1(), "File has no data rows"),
        (b"\xff\xfe\x00bad", "not valid UTF-8"),
    ],
)
def test_file_level_errors(data, fragment):
    r = parse(data)
    assert r.positions == [] and r.errors[0].row == 0 and fragment in r.errors[0].message


def test_row_limit_counts_lots():
    r = parse(m1(*(lot("VTI", lot_id=str(i)) for i in range(5001))))
    assert "More than 5000 rows" in r.errors[0].message
    assert r.positions[0].quantity == Decimal(5000)


def test_registered_for_m1_only():
    slugs = [c.slug for c in connectors.for_platform("m1")]
    assert slugs == ["m1-holdings", "m1-tax-lots", "snapshot"]
    assert [c.slug for c in connectors.for_platform("robinhood")] == [
        "robinhood-positions",
        "snapshot",
    ]
    assert connectors.get("m1-tax-lots") is not None
