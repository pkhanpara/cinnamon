from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest

from app import connectors
from app.connectors.snapshot import SnapshotConnector

SAMPLE = Path(__file__).resolve().parents[2] / "seed" / "sample"
parse = SnapshotConnector().parse
HEAD = "symbol,quantity,cost_basis\n"


def msgs(result):
    return [(e.row, e.message) for e in result.errors]


def test_parses_the_committed_sample_files():
    for name, n in (("robinhood_positions.csv", 3), ("m1_positions.csv", 3)):
        r = parse((SAMPLE / name).read_bytes())
        assert r.errors == [] and len(r.positions) == n, name
    orcl = parse((SAMPLE / "robinhood_positions.csv").read_bytes()).positions[0]
    assert orcl.symbol == "ORCL" and orcl.quantity == Decimal(40)
    assert orcl.market_value == Decimal("6800.00") and orcl.price == Decimal("170.00")
    assert orcl.as_of == datetime(2026, 1, 1, tzinfo=UTC)


def test_minimal_file_and_decimal_exactness():
    r = parse((HEAD + "aapl,0.1,0.30\n").encode())
    p = r.positions[0]
    assert p.symbol == "AAPL" and p.name is None and p.market_value is None
    assert p.quantity == Decimal("0.1") and p.cost_basis == Decimal("0.30")  # no float drift


def test_headers_are_case_insensitive_and_bom_is_ignored():
    r = parse(("\ufeffSymbol, Quantity ,COST_BASIS\nvoo,2,100\n").encode("utf-8"))
    assert r.errors == [] and r.positions[0].symbol == "VOO"


def test_money_formatting_is_tolerated():
    r = parse((HEAD + 'KO,"1,000.5","$3,693.20"\n').encode())
    assert r.positions[0].quantity == Decimal("1000.5")
    assert r.positions[0].cost_basis == Decimal("3693.20")


def test_naive_as_of_is_taken_as_utc():
    r = parse((HEAD.strip() + ",as_of\nKO,1,1,2026-03-04T05:06:07\n").encode())
    assert r.positions[0].as_of == datetime(2026, 3, 4, 5, 6, 7, tzinfo=UTC)


def test_class_share_symbols_allowed():
    r = parse((HEAD + "BRK.B,1,1\nBF-B,1,1\n").encode())
    assert [p.symbol for p in r.positions] == ["BRK.B", "BF-B"]


def test_blank_lines_are_skipped():
    r = parse((HEAD + "\nKO,1,1\n,,\n\n").encode())
    assert r.errors == [] and len(r.positions) == 1


@pytest.mark.parametrize(
    ("body", "fragment"),
    [
        ("KO,0,1", "quantity must be greater than 0"),
        ("KO,-5,1", "quantity must be greater than 0"),
        ("KO,abc,1", "quantity is not a number"),
        ("KO,NaN,1", "finite"),
        ("KO,Infinity,1", "finite"),
        ("KO,,1", "quantity is required"),
        ("KO,1,", "cost_basis is required"),
        ("KO,1,-1", "cost_basis cannot be negative"),
        ("K O,1,1", "Invalid symbol"),
        (",1,1", "Invalid symbol"),
        ("=CMD(),1,1", "Invalid symbol"),
        ("TOOLONGSYMBOLXXXXXX,1,1", "Invalid symbol"),
    ],
)
def test_bad_rows_report_line_and_reason(body, fragment):
    r = parse((HEAD + body + "\n").encode())
    assert r.positions == []
    assert len(r.errors) == 1 and r.errors[0].row == 2
    assert fragment in r.errors[0].message


def test_optional_field_errors():
    head = HEAD.strip() + ",market_value,price_used,as_of\n"
    for row, frag in (
        ("KO,1,1,-1,,", "market_value cannot be negative"),
        ("KO,1,1,,0,", "price_used must be greater than 0"),
        ("KO,1,1,,,yesterday", "as_of is not an ISO 8601"),
    ):
        r = parse((head + row + "\n").encode())
        assert frag in r.errors[0].message, row


def test_good_rows_survive_alongside_bad_ones_and_lines_are_exact():
    r = parse((HEAD + "KO,1,1\nBAD,x,1\nPM,2,2\n").encode())
    assert [p.symbol for p in r.positions] == ["KO", "PM"]
    assert msgs(r) == [(3, "quantity is not a number: 'x'")]


def test_duplicate_symbol_is_an_error_pointing_at_the_first_line():
    r = parse((HEAD + "KO,1,1\nko,2,2\n").encode())
    assert len(r.positions) == 1
    assert msgs(r) == [(3, "Duplicate symbol KO (first on line 2)")]


@pytest.mark.parametrize(
    ("data", "fragment"),
    [
        (b"", "File is empty"),
        (b"symbol,quantity\nKO,1\n", "Missing required column(s): cost_basis"),
        ((HEAD).encode(), "File has no data rows"),
        (b"\xff\xfe\x00bad", "not valid UTF-8"),
    ],
)
def test_file_level_errors(data, fragment):
    r = parse(data)
    assert r.positions == [] and r.errors[0].row == 0 and fragment in r.errors[0].message


def test_row_limit():
    rows = "".join(f"S{i},1,1\n" for i in range(5001))
    r = parse((HEAD + rows).encode())
    assert len(r.positions) == 5000 and "More than 5000 rows" in r.errors[0].message


def test_registry_lists_generic_connector_for_any_platform():
    assert [c.slug for c in connectors.for_platform("robinhood")] == ["snapshot"]
    assert [c.slug for c in connectors.for_platform("some-new-broker")] == ["snapshot"]
    with pytest.raises(ValueError):
        connectors.register(SnapshotConnector())
