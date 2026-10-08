"""M1 Holdings connector. All data here is fabricated."""

from decimal import Decimal
from pathlib import Path

import pytest

from app import connectors
from app.connectors.m1 import M1HoldingsConnector

SAMPLE = Path(__file__).resolve().parents[2] / "seed" / "sample" / "m1_holdings.csv"
parse = M1HoldingsConnector().parse

HEADER = (
    "Symbol,Name,Quantity,Avg. Price,Cost Basis,Unrealized Gain ($),Unrealized Gain (%),Value\n"
)


def row(symbol="VTI", name="Vanguard", qty="1", cost="100.00", value="110.00"):
    return f"{symbol},{name},{qty},1.00,{cost},0,0,{value}\n"


def m1(*rows: str) -> bytes:
    return (HEADER + "".join(rows)).encode()


def msgs(result):
    return [(e.row, e.message) for e in result.errors]


def test_parses_committed_sample_file():
    r = parse(SAMPLE.read_bytes())
    assert r.errors == []
    got = {p.symbol: (p.quantity, p.cost_basis, p.market_value, p.price) for p in r.positions}
    # Same per-symbol totals as m1_positions.csv and m1_open_tax_lots.csv.
    assert got == {
        "VTI": (Decimal(30), Decimal(7000), Decimal(8100), Decimal(270)),
        "SCHD": (Decimal(80), Decimal(6000), Decimal(6400), Decimal(80)),
        "ORCL": (Decimal(10), Decimal(1400), Decimal(1700), Decimal(170)),
    }
    assert [p.symbol for p in r.positions] == ["VTI", "SCHD", "ORCL"]
    assert r.positions[0].name == "Vanguard Total Stock Market ETF"
    assert all(p.as_of is None for p in r.positions)


def test_thousands_separators_fractions_and_price_rounding():
    (p,) = parse(m1(row(qty="0.12345", cost='"1,000.00"', value='"$1,234.56"'))).positions
    assert p.quantity == Decimal("0.12345") and p.cost_basis == Decimal("1000.00")
    assert p.market_value == Decimal("1234.56")
    assert p.price == Decimal("10000.4860")  # 1234.56 / 0.12345, rounded to 4 places


def test_blank_name_is_none_and_long_name_truncated():
    r = parse(m1(row("VTI", name=""), row("ORCL", name="x" * 300)))
    assert r.positions[0].name is None and len(r.positions[1].name) == 200


def test_headers_case_and_space_insensitive_bom_and_crlf():
    data = "﻿SYMBOL , quantity,Cost  Basis,VALUE\r\nvti,2,10,30\r\n"
    r = parse(data.encode())
    assert r.errors == [] and r.positions[0].symbol == "VTI"
    assert r.positions[0].price == Decimal(15) and r.positions[0].name is None


def test_tax_lots_file_rejected_with_hint():
    lots = (SAMPLE.parent / "m1_open_tax_lots.csv").read_bytes()
    r = parse(lots)
    assert r.positions == []
    assert msgs(r) == [
        (0, "This looks like the Open tax lots file; choose the M1 open tax lots format")
    ]


@pytest.mark.parametrize(
    "data",
    [
        b"symbol,quantity,cost_basis\nVTI,1,1\n",  # cinnamon's snapshot format
        b"Symbol,Quantity,Cost Basis\nVTI,1,1\n",  # no Value column
        b"1099-B,ACCOUNT NUMBER,TAX YEAR,SHARES,COST BASIS\n",
    ],
)
def test_not_an_m1_holdings_export(data):
    r = parse(data)
    assert r.positions == [] and r.errors[0].row == 0
    assert "Not an M1 Holdings export" in r.errors[0].message


@pytest.mark.parametrize(
    ("line", "fragment"),
    [
        (row(qty="0"), "VTI: Quantity must be greater than 0"),
        (row(qty="abc"), "VTI: Quantity is not a number: 'abc'"),
        (row(qty=""), "VTI: Quantity is required"),
        (row(cost=""), "VTI: Cost Basis is required"),
        (row(cost="-1"), "VTI: Cost Basis cannot be negative"),
        (row(value=""), "VTI: Value is required"),
        (row(value="-1"), "VTI: Value cannot be negative"),
        (row(value="x"), "VTI: Value is not a number: 'x'"),
        (row(symbol=""), "Invalid symbol: ''"),
        (row(symbol="=CMD()"), "Invalid symbol: '=CMD()'"),
    ],
)
def test_bad_rows_report_line_and_reason(line, fragment):
    r = parse(m1(line))
    assert r.positions == []
    assert msgs(r) == [(2, fragment)]


def test_duplicate_symbol_is_an_error_first_row_kept():
    r = parse(m1(row("VTI"), row("ORCL"), row("vti")))
    assert [p.symbol for p in r.positions] == ["VTI", "ORCL"]
    assert msgs(r) == [(4, "VTI: duplicate symbol")]


def test_blank_lines_are_skipped_and_line_numbers_stay_physical():
    r = parse(m1(row(), "\n", ",,,,\n", row("ORCL", qty="0")))
    assert msgs(r) == [(5, "ORCL: Quantity must be greater than 0")]


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


def test_row_limit():
    r = parse(m1(*(row(f"S{i}") for i in range(5001))))
    assert "More than 5000 rows" in r.errors[0].message
    assert len(r.positions) == 5000


def test_registered_for_m1_first():
    assert [c.slug for c in connectors.for_platform("m1")] == [
        "m1-holdings",
        "m1-tax-lots",
        "snapshot",
    ]
    assert connectors.get("m1-holdings") is not None
