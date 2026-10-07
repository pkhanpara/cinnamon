from datetime import UTC, datetime
from decimal import Decimal as D

from app.holdings import build
from app.models import Account, Position
from app.quotes import PricedQuote

NOW = datetime(2026, 10, 7, tzinfo=UTC)


def acct(i, nick="A", platform="robinhood"):
    return Account(id=i, user_id=1, platform=platform, nickname=nick)


def pos(account, symbol, qty, cost, mv=None, name=None):
    return Position(
        account_id=account.id,
        import_id=1,
        symbol=symbol,
        name=name,
        quantity=D(qty),
        cost_basis=D(cost),
        market_value=None if mv is None else D(mv),
    ), account


def q(price, prev=None, stale=False):
    return PricedQuote(D(price), None if prev is None else D(prev), NOW, stale)


RH, M1 = acct(1, "Robinhood"), acct(2, "M1", "m1")


def test_merges_a_symbol_across_accounts_with_hand_checked_numbers():
    rows, s = build(
        [pos(RH, "ORCL", "40", "5200", name="Oracle"), pos(M1, "ORCL", "10", "1400")],
        {"ORCL": q("170.55", "169.00")},
    )
    (r,) = rows
    assert (r.symbol, r.name, r.quantity, r.cost_basis) == ("ORCL", "Oracle", D(50), D(6600))
    assert [(ln.account_nickname, ln.value) for ln in r.lines] == [
        ("M1", D("1705.50")),
        ("Robinhood", D("6822.00")),
    ]
    assert r.value == D("8527.50") and r.gain == D("1927.50") and r.gain_pct == D("29.2045")
    assert r.source == "live" and r.price == D("170.55")
    assert r.day_change == D("77.50") and r.day_change_pct == D("0.9172")
    assert (s.total_value, s.total_cost_basis, s.gain) == (D("8527.50"), D(6600), D("1927.50"))
    assert (s.day_change, s.day_change_pct, s.live_count) == (D("77.50"), D("0.9172"), 1)


def test_fractional_shares_use_exact_decimal_math():
    (r,), _ = build([pos(RH, "AAPL", "19.8834", "4377.83")], {"AAPL": q("344.59")})
    assert r.value == D("6851.62")  # 19.8834 x 344.59 = 6851.620806


def test_no_float_drift_when_merging_quantities():
    (r,), _ = build([pos(RH, "X", "0.1", "1"), pos(M1, "X", "0.2", "1")], {})
    assert r.quantity == D("0.3")


def test_rows_equal_the_sum_of_rounded_lines():
    # each line is 0.005 -> rounds to 0.01; the merged row and total must be 0.02, not 0.01
    (r,), s = build([pos(RH, "X", "1", "1"), pos(M1, "X", "1", "1")], {"X": q("0.005")})
    assert [ln.value for ln in r.lines] == [D("0.01"), D("0.01")]
    assert r.value == D("0.02") == s.total_value


def test_falls_back_to_imported_value_when_there_is_no_quote():
    (r,), s = build([pos(RH, "KO", "10", "500", mv="600")], {})
    assert r.source == "file" and r.value == D("600.00") and r.price == D("60.00")
    assert r.day_change is None and s.day_change is None and s.file_count == 1


def test_a_holding_with_no_price_is_excluded_from_totals_and_gain():
    rows, s = build([pos(RH, "KO", "10", "500", mv="600"), pos(RH, "ZZZ", "5", "9000")], {})
    zzz = next(r for r in rows if r.symbol == "ZZZ")
    assert (
        zzz.value is None and zzz.gain is None and zzz.source == "none" and zzz.weight_pct is None
    )
    assert s.unpriced_count == 1 and s.total_value == D(600)
    assert s.total_cost_basis == D(9500)  # cost basis still counts everything held
    assert s.gain == D(100) and s.gain_pct == D("20.0000")  # 600-500, NOT 600-9500


def test_partially_priced_symbol_gets_no_misleading_partial_value():
    (r,), s = build([pos(RH, "KO", "10", "500", mv="600"), pos(M1, "KO", "5", "250")], {})
    assert r.value is None and r.source == "none" and s.total_value == 0


def test_stale_quote_is_flagged_and_gives_no_day_change():
    (r,), s = build([pos(RH, "KO", "10", "500")], {"KO": q("70", "69", stale=True)})
    assert r.source == "stale" and r.value == D("700.00") and r.day_change is None
    assert s.stale_count == 1 and s.day_change is None


def test_live_quote_beats_imported_value():
    (r,), _ = build([pos(RH, "KO", "10", "500", mv="600")], {"KO": q("70")})
    assert r.value == D("700.00") and r.source == "live"


def test_weights_sum_to_one_hundred_and_ignore_unpriced():
    rows, _ = build(
        [pos(RH, "A", "1", "1", mv="25"), pos(RH, "B", "1", "1", mv="75"), pos(RH, "C", "1", "1")],
        {},
    )
    w = {r.symbol: r.weight_pct for r in rows}
    assert w == {"A": D("25.0000"), "B": D("75.0000"), "C": None}


def test_rows_sorted_by_value_desc_with_unpriced_last():
    rows, _ = build(
        [
            pos(RH, "SMALL", "1", "1", mv="5"),
            pos(RH, "NONE", "1", "1"),
            pos(RH, "BIG", "1", "1", mv="50"),
        ],
        {},
    )
    assert [r.symbol for r in rows] == ["BIG", "SMALL", "NONE"]


def test_zero_cost_basis_gives_no_percentage():
    (r,), s = build([pos(RH, "GIFT", "1", "0", mv="10")], {})
    assert r.gain == D(10) and r.gain_pct is None and s.gain_pct is None


def test_empty_selection_is_all_zeros():
    rows, s = build([], {})
    assert rows == [] and s.total_value == 0 and s.gain_pct is None and s.day_change is None


def test_day_change_percent_is_weighted_by_previous_value():
    # A: 10 sh 100->110 (+100), B: 10 sh 10->9 (-10). prev value = 1000+100 = 1100 -> +90 = 8.1818%
    rows, s = build(
        [pos(RH, "A", "10", "1"), pos(RH, "B", "10", "1")],
        {"A": q("110", "100"), "B": q("9", "10")},
    )
    assert s.day_change == D("90.00") and s.day_change_pct == D("8.1818")
    assert {r.symbol: r.day_change_pct for r in rows} == {"A": D("10.0000"), "B": D("-10.0000")}
