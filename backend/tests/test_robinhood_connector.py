from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest

from app.connectors.robinhood import RobinhoodPositionsConnector
from app.connectors.snapshot import SnapshotConnector

SAMPLE = Path(__file__).resolve().parents[2] / "seed" / "sample"
parse = RobinhoodPositionsConnector().parse
HEAD = "Symbol,Shares,Average cost\n"


def msgs(result):
    return [(e.row, e.message) for e in result.errors]


def test_sample_matches_the_snapshot_sample():
    """The template sample and the snapshot sample describe the same three positions."""
    r = parse((SAMPLE / "robinhood_app_positions.csv").read_bytes())
    snap = SnapshotConnector().parse((SAMPLE / "robinhood_positions.csv").read_bytes())
    assert r.errors == [] and len(r.positions) == 3
    assert r.positions == snap.positions
    orcl = r.positions[0]
    assert orcl.symbol == "ORCL" and orcl.name == "Oracle Corporation"
    assert orcl.cost_basis == Decimal("5200.00") and orcl.price == Decimal("170.00")
    assert orcl.as_of == datetime(2026, 1, 1, tzinfo=UTC)


def test_cost_basis_is_shares_times_average_cost_rounded_to_cents():
    r = parse((HEAD + "ACME,12.3456,101.2345\nMETA,0.5,0.005\n").encode())
    acme, meta = r.positions
    assert acme.cost_basis == Decimal("1249.80")  # 1249.8006...
    assert meta.cost_basis == Decimal("0.00")  # 0.0025 rounds half up to 0.00
    assert acme.market_value is None and acme.price is None


def test_price_is_derived_from_market_value():
    r = parse(b"Symbol,Shares,Average cost,Market value\nKO,3,50,200\nX,2,1,0\n")
    ko, x = r.positions
    assert ko.market_value == Decimal(200) and ko.price == Decimal("66.6667")
    assert x.market_value == Decimal(0) and x.price is None


def test_headers_are_case_and_space_insensitive_and_bom_is_ignored():
    r = parse("﻿ SYMBOL ,shares,AVERAGE   COST,market value\nvoo,2,100,250\n".encode())
    assert r.errors == [] and r.positions[0].symbol == "VOO"


def test_naive_as_of_is_taken_as_utc():
    r = parse(b"Symbol,Shares,Average cost,As of\nKO,1,1,2026-03-04T05:06:07\n")
    assert r.positions[0].as_of == datetime(2026, 3, 4, 5, 6, 7, tzinfo=UTC)


def test_blank_lines_are_skipped():
    r = parse((HEAD + "\nKO,1,1\n,,\n\n").encode())
    assert r.errors == [] and len(r.positions) == 1


@pytest.mark.parametrize(
    ("row", "fragment"),
    [
        ("$$$,1,1", "Invalid symbol"),
        ("KO,,1", "Shares is required"),
        ("KO,0,1", "Shares must be greater than 0"),
        ("KO,abc,1", "Shares is not a number"),
        ("KO,1,", "Average cost is required"),
        ("KO,1,(5)", "Average cost cannot be negative"),
    ],
)
def test_row_errors(row, fragment):
    r = parse((HEAD + row + "\n").encode())
    assert r.positions == [] and r.errors[0].row == 2 and fragment in r.errors[0].message


def test_bad_market_value_and_as_of():
    r = parse(b"Symbol,Shares,Average cost,Market value,As of\nKO,1,1,-1,\nPEP,1,1,1,soon\n")
    assert msgs(r) == [
        (2, "Market value cannot be negative"),
        (3, "As of is not an ISO 8601 date/time: 'soon'"),
    ]


def test_duplicate_symbol():
    r = parse((HEAD + "KO,1,1\nko,2,2\n").encode())
    assert msgs(r) == [(3, "Duplicate symbol KO (first on line 2)")]


@pytest.mark.parametrize(
    ("data", "fragment"),
    [
        (b"", "File is empty"),
        (HEAD.encode(), "File has no data rows"),
        (b"\xff\xfe\x00bad", "not valid UTF-8"),
        (
            b"Symbol,Quantity,Cost basis\nKO,1,1\n",
            "Missing required column(s): Shares, Average cost",
        ),
        (b"symbol,quantity,cost_basis\nKO,1,1\n", "Missing required column(s): Shares"),
    ],
)
def test_file_level_errors(data, fragment):
    r = parse(data)
    assert r.positions == [] and r.errors[0].row == 0 and fragment in r.errors[0].message


# Headers of Robinhood's own exports, no real data.
TAX_CSV = (
    b"1099-DIV,ACCOUNT NUMBER,TAX YEAR,ORDINARY DIV,QUALIFIED DIV\n"
    b"1099-DIV,000000000,2025,0.41,0.41\n"
    b"1099-B,ACCOUNT NUMBER,TAX YEAR,DATE ACQUIRED,SALE DATE,DESCRIPTION,SHARES,COST BASIS\n"
    b"1099-B,000000000,2025,01/02/2025,03/04/2025,ACME CORP,1,10\n"
)
ACTIVITY_CSV = (
    b'"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code",'
    b'"Quantity","Price","Amount"\n'
    b'"10/1/2026","10/1/2026","10/2/2026","KO","Coca-Cola\nCUSIP: 000000000","Buy","1",'
    b'"$60.00","($60.00)"\n'
    b'\n"","","","","","","","","","The data provided is for informational purposes only."\n'
)


@pytest.mark.parametrize(
    ("data", "fragment"),
    [
        (TAX_CSV, "1099 tax CSV"),
        (TAX_CSV.replace(b"1099-DIV", b"1099-B", 2), "1099 tax CSV"),
        (b"1099-INT,ACCOUNT NUMBER\n1099-INT,0\n", "1099 tax CSV"),
        (ACTIVITY_CSV, "Account activity report"),
    ],
)
def test_robinhood_exports_are_recognized(data, fragment):
    r = parse(data)
    assert r.positions == [] and len(r.errors) == 1
    assert r.errors[0].row == 0 and fragment in r.errors[0].message
    assert "positions template" in r.errors[0].message


def test_row_limit():
    rows = "".join(f"S{i},1,1\n" for i in range(5001))
    r = parse((HEAD + rows).encode())
    assert "More than 5000 rows" in r.errors[0].message and len(r.positions) == 5000
