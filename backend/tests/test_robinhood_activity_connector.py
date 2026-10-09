from decimal import Decimal
from pathlib import Path

import pytest

from app import connectors
from app.connectors.robinhood_activity import RobinhoodActivityConnector

SAMPLE = (
    Path(__file__).resolve().parents[2] / "seed" / "sample" / "robinhood_activity.csv"
).read_bytes()
parse = RobinhoodActivityConnector().parse
HEAD = '"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"\n'


def act(date, symbol, code, qty="", price="", amount="", desc=None):
    desc = desc if desc is not None else f"{symbol} Inc\nCUSIP: 000000000"
    return f'"{date}","{date}","{date}","{symbol}","{desc}","{code}","{qty}","{price}","{amount}"\n'


def report(*rows):
    return (HEAD + "".join(rows)).encode()


def msgs(result):
    return [(e.row, e.message) for e in result.errors]


def held(result):
    return {p.symbol: (p.quantity, p.cost_basis) for p in result.positions}


def test_sample_replays_with_average_cost():
    r = parse(SAMPLE)
    assert held(r) == {
        "INTC": (Decimal(100), Decimal("3100.00")),
        "ORCL": (Decimal(40), Decimal("5120.00")),
    }
    assert r.needs_average_cost == ["DIS"]
    assert (
        len(r.errors) == 1
        and r.errors[0].row == 0
        and "DIS: shares were transferred in" in r.errors[0].message
    )
    orcl = next(p for p in r.positions if p.symbol == "ORCL")
    assert orcl.name == "Oracle" and orcl.market_value is None and orcl.price is None


def test_transferred_symbol_takes_the_users_average_cost():
    r = parse(SAMPLE, average_costs={"DIS": Decimal("96.00")})
    assert r.errors == [] and r.needs_average_cost == ["DIS"]
    assert held(r)["DIS"] == (Decimal(25), Decimal("2400.00"))


def test_average_cost_overrides_the_whole_symbol_after_later_buys():
    r = parse(
        report(
            act("2/1/2026", "KO", "Buy", "5", "$60.00", "($300.00)"),
            act("1/1/2026", "KO", "ACATI", "10"),
        ),
        average_costs={"KO": Decimal("55.555")},
    )
    assert held(r) == {"KO": (Decimal(15), Decimal("833.33"))}  # 833.325 half-up


def test_cost_not_needed_is_an_error():
    r = parse(SAMPLE, average_costs={"DIS": Decimal(1), "ORCL": Decimal(1)})
    assert msgs(r) == [(0, "ORCL: no average cost is needed (no transferred shares held)")]


def test_replays_oldest_first_and_keeps_same_day_order():
    # Newest first, as Robinhood writes it: on 1/2 the buy (lower in the file) came before the sell.
    r = parse(
        report(
            act("1/2/2026", "KO", "Sell", "10", "$60.00", "$600.00"),
            act("1/2/2026", "KO", "Buy", "10", "$50.00", "($500.00)"),
            act("1/1/2026", "KO", "Buy", "10", "$40.00", "($400.00)"),
        )
    )
    # avg after both buys = 45; selling 10 leaves 10 at 45
    assert r.errors == [] and held(r) == {"KO": (Decimal(10), Decimal("450.00"))}


def test_fully_sold_symbol_is_dropped():
    r = parse(
        report(
            act("1/2/2026", "BND", "Sell", "3", "$70", "$210.00"),
            act("1/1/2026", "BND", "Buy", "3", "$70", "($210.00)"),
            act("1/1/2026", "KO", "Buy", "1", "$60", "($60.00)"),
        )
    )
    assert r.errors == [] and list(held(r)) == ["KO"]


def test_selling_more_than_held_means_missing_history():
    r = parse(
        report(
            act("1/2/2026", "KO", "Sell", "5", "$60", "$300.00"),
            act("1/1/2026", "KO", "Buy", "2", "$60", "($120.00)"),
            act("1/1/2026", "PEP", "Buy", "1", "$150", "($150.00)"),
        )
    )
    assert (
        r.errors[0].row == 2 and "KO: removes 5 share(s) but only 2 are held" in r.errors[0].message
    )
    assert "account was opened" in r.errors[0].message
    assert list(held(r)) == ["PEP"]


def test_fractional_shares_are_exact():
    r = parse(
        report(
            act("1/2/2026", "NVDA", "Sell", "0.123456", "$100", "$12.35"),
            act("1/1/2026", "NVDA", "Buy", "1.5", "$100", "($150.00)"),
        )
    )
    q, cost = held(r)["NVDA"]
    assert q == Decimal("1.376544") and cost == Decimal("137.65")  # 150 * 1.376544 / 1.5 = 137.6544


def test_buy_without_amount_uses_price():
    r = parse(report(act("1/1/2026", "KO", "Buy", "2", "$60.00", "")))
    assert held(r) == {"KO": (Decimal(2), Decimal("120.00"))}


def test_split_adds_shares_without_cost():
    r = parse(
        report(
            act("2/1/2026", "NVDA", "SPL", "9"),
            act("1/1/2026", "NVDA", "Buy", "1", "$1000", "($1,000.00)"),
        )
    )
    assert held(r) == {"NVDA": (Decimal(10), Decimal("1000.00"))}


def test_transfer_out_removes_at_average_cost():
    r = parse(
        report(
            act("2/1/2026", "KO", "ACATO", "1"),
            act("1/1/2026", "KO", "Buy", "4", "$50", "($200.00)"),
        )
    )
    assert held(r) == {"KO": (Decimal(3), Decimal("150.00"))}


def test_options_cash_and_footer_rows_are_skipped():
    r = parse(
        report(
            act("1/3/2026", "NVDA", "STC", "1", "$5", "$500.00", "NVDA 2/20/2026 Call $200.00"),
            act("1/2/2026", "NVDA", "BTO", "1", "$3", "($300.00)", "NVDA 2/20/2026 Call $200.00"),
            act("1/2/2026", "KO", "CDIV", "", "", "$1.00", "Cash Div: R/D 2026-01-01"),
            act("1/2/2026", "", "MTCH", "", "", "$5.00", "Interest on Contribution (IRA Match)"),
            act("1/1/2026", "KO", "Buy", "1", "$60", "($60.00)"),
        )
        + b'\n"","","","","","","","","","The data provided is for informational purposes only."\n'
    )
    assert r.errors == [] and held(r) == {"KO": (Decimal(1), Decimal("60.00"))}


@pytest.mark.parametrize(
    ("row", "fragment"),
    [
        (
            act("1/1/2026", "KO", "OASGN", "100"),
            "option assignment/exercise (OASGN) is not supported",
        ),
        (act("1/1/2026", "KO", "REC", "1"), "unsupported transaction code 'REC'"),
        (act("13/45/2026", "KO", "Buy", "1", "$1", "($1.00)"), "Activity Date is not M/D/YYYY"),
        (act("1/1/2026", "KO", "Buy", "0", "$1", "($1.00)"), "Quantity must be greater than 0"),
        (act("1/1/2026", "KO", "Buy", "x", "$1", "($1.00)"), "Quantity is not a number"),
        (act("1/1/2026", "KO", "Buy", "1", "", ""), "a buy needs an Amount or a Price"),
        (act("1/1/2026", "$$$", "Buy", "1", "$1", "($1.00)"), "Invalid symbol"),
    ],
)
def test_row_errors(row, fragment):
    r = parse(report(row))
    assert r.positions == [] and r.errors[0].row == 2 and fragment in r.errors[0].message


@pytest.mark.parametrize(
    ("data", "fragment"),
    [
        (b"", "File is empty"),
        (HEAD.encode(), "File has no data rows"),
        (b"\xff\xfe\x00bad", "not valid UTF-8"),
        (b"Symbol,Shares,Average cost\nKO,1,1\n", "Not a Robinhood Account activity report"),
        (b"1099-B,ACCOUNT NUMBER\n1099-B,0\n", "Not a Robinhood Account activity report"),
    ],
)
def test_file_level_errors(data, fragment):
    r = parse(data)
    assert r.positions == [] and r.errors[0].row == 0 and fragment in r.errors[0].message


def test_bom_and_header_spacing():
    r = parse(
        ("﻿" + HEAD.replace("Trans Code", " TRANS  CODE ")).encode()
        + act("1/1/2026", "KO", "Buy", "1", "$1", "($1.00)").encode()
    )
    assert r.errors == [] and list(held(r)) == ["KO"]


def test_registered_first_for_robinhood():
    slugs = [c.slug for c in connectors.for_platform("robinhood")]
    assert slugs == ["robinhood-activity", "robinhood-positions", "snapshot"]
