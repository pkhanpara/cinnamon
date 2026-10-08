from datetime import UTC, date, datetime, timedelta
from decimal import Decimal as D
from pathlib import Path

import pytest

from app.api import portfolio
from app.main import app
from app.providers import ProviderError, get_history_provider
from app.providers.base import Bar

SAMPLE = Path(__file__).resolve().parents[2] / "seed" / "sample"
RH = (SAMPLE / "robinhood_positions.csv").read_bytes()  # ORCL 40, INTC 100, DIS 25
M1 = (SAMPLE / "m1_positions.csv").read_bytes()  # VTI 30, SCHD 80, ORCL 10


def bar(day: date, close, hour=0) -> Bar:
    t = datetime(day.year, day.month, day.day, 14 + hour, 30, tzinfo=UTC)
    c = D(str(close))
    return Bar(time=t, session_date=day, open=c, high=c, low=c, close=c, volume=1)


def daily(start: date, closes) -> list[Bar]:
    return [bar(start + timedelta(days=i), c) for i, c in enumerate(closes)]


class FakeHistory:
    def __init__(self, data=None, errors=()):
        self.data, self.errors, self.calls = data or {}, set(errors), []

    def get_history(self, symbol, range_):
        self.calls.append((symbol, range_.value))
        if symbol in self.errors:
            raise ProviderError("boom")
        return self.data.get(symbol, [])


def use(h):
    app.dependency_overrides[get_history_provider] = lambda: h
    return h


def make(client, platform, nickname, csv):
    a = client.post("/api/accounts", json={"platform": platform, "nickname": nickname}).json()["id"]
    r = client.post(
        f"/api/accounts/{a}/imports",
        data={"connector": "snapshot"},
        files={"file": ("x.csv", csv, "text/csv")},
    )
    assert r.status_code == 201, r.text
    return a


D0 = date(2026, 9, 1)
ALL5 = {
    "ORCL": daily(D0, [100, 110, 120]),
    "INTC": daily(D0, [10, 10, 20]),
    "DIS": daily(D0, [100, 100, 100]),
    "SPY": daily(D0, [400, 420, 440]),
}


def test_single_account_sums_quantity_times_close(alice):
    make(alice, "robinhood", "RH", RH)  # ORCL 40, INTC 100, DIS 25
    use(FakeHistory(ALL5))
    r = alice.get("/api/portfolio/history?range=1m")
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["basis"] == "backcast"
    assert [p["value"] for p in b["points"]] == ["7500.00", "7900.00", "9300.00"]
    assert [p["d"] for p in b["points"]] == ["2026-09-01", "2026-09-02", "2026-09-03"]
    assert b["start_value"] == "7500.00" and b["end_value"] == "9300.00"
    assert b["change"] == "1800.00" and b["change_pct"] == "24.00"
    assert b["symbols"] == ["DIS", "INTC", "ORCL"]
    assert b["spy"] is None and b["warnings"] == []


def test_accounts_merge_and_subset(alice):
    a, m = make(alice, "robinhood", "RH", RH), make(alice, "m1", "M1", M1)
    data = {**ALL5, "VTI": daily(D0, [1, 1, 1]), "SCHD": daily(D0, [2, 2, 2])}
    use(FakeHistory(data))
    both = alice.get("/api/portfolio/history?range=1m").json()
    # ORCL 50 x 100 + INTC 100 x 10 + DIS 25 x 100 + VTI 30 + SCHD 160 on day one
    assert both["points"][0]["value"] == "8690.00"
    only_m = alice.get(f"/api/portfolio/history?range=1m&account_ids={m}").json()
    assert only_m["points"][0]["value"] == "1190.00"  # ORCL 10 x 100 + 30 + 160
    assert a != m


def test_empty_selection_and_no_positions_give_an_empty_chart(alice):
    make(alice, "robinhood", "RH", RH)
    h = use(FakeHistory(ALL5))
    b = alice.get("/api/portfolio/history?account_ids=").json()
    assert b["points"] == [] and b["end_value"] is None
    assert h.calls == []


def test_foreign_or_unknown_account_is_404(admin, alice):
    other = make(admin, "robinhood", "Admin RH", RH)
    use(FakeHistory(ALL5))
    assert alice.get(f"/api/portfolio/history?account_ids={other}").status_code == 404


def test_requires_login(client):
    assert client.get("/api/portfolio/history").status_code == 401


def test_malformed_account_ids_is_422(alice):
    assert alice.get("/api/portfolio/history?account_ids=a,b").status_code == 422


def test_forward_fills_symbols_with_missing_bars(alice):
    make(alice, "robinhood", "RH", RH)
    data = {
        "ORCL": daily(D0, [100, 110, 120]),
        "INTC": [bar(D0, 10), bar(D0 + timedelta(days=2), 20)],  # no bar on day two
        "DIS": daily(D0, [100, 100, 100]),
    }
    use(FakeHistory(data))
    b = alice.get("/api/portfolio/history").json()
    assert [p["value"] for p in b["points"]] == ["7500.00", "7900.00", "9300.00"]


def test_late_listed_symbol_shortens_the_chart_and_warns(alice):
    make(alice, "robinhood", "RH", RH)
    data = {
        "ORCL": daily(D0, [100, 110, 120]),
        "INTC": daily(D0 + timedelta(days=1), [10, 20]),
        "DIS": daily(D0, [100, 100, 100]),
    }
    use(FakeHistory(data))
    b = alice.get("/api/portfolio/history").json()
    assert [p["d"] for p in b["points"]] == ["2026-09-02", "2026-09-03"]
    assert any("INTC began trading" in w for w in b["warnings"])


def test_one_symbol_failing_or_empty_is_left_out_with_a_warning(alice):
    make(alice, "robinhood", "RH", RH)
    use(FakeHistory({"ORCL": ALL5["ORCL"]}, errors={"DIS"}))
    b = alice.get("/api/portfolio/history").json()
    assert b["symbols"] == ["ORCL"]
    text = " ".join(b["warnings"])
    assert "DIS is unavailable" in text and "No price history for INTC" in text
    assert b["points"][0]["value"] == "4000.00"
    assert b["covered_value_pct"] is not None and D(b["covered_value_pct"]) < 100


def test_all_symbols_failing_is_503(alice):
    make(alice, "robinhood", "RH", RH)
    use(FakeHistory(errors={"ORCL", "INTC", "DIS"}))
    assert alice.get("/api/portfolio/history").status_code == 503


def test_caps_symbols_and_names_the_ones_left_out(alice, monkeypatch):
    make(alice, "robinhood", "RH", RH)
    monkeypatch.setattr(portfolio, "MAX_SYMBOLS", 2)
    h = use(FakeHistory(ALL5))
    b = alice.get("/api/portfolio/history").json()
    assert len(b["symbols"]) == 2
    assert len({s for s, _ in h.calls}) == 2
    assert any("2 largest holdings; left out:" in w for w in b["warnings"])


def test_spy_is_rebased_to_the_start_value(alice):
    make(alice, "robinhood", "RH", RH)
    use(FakeHistory(ALL5))
    b = alice.get("/api/portfolio/history?compare=spy").json()
    # 400 -> 440 is +10%; portfolio goes 7500 -> 9300 (+24%)
    assert [p["spy_value"] for p in b["points"]] == ["7500.00", "7875.00", "8250.00"]
    assert b["spy"] == {"change_pct": "10.00", "difference_pp": "14.00"}


def test_spy_failure_keeps_the_portfolio_line(alice):
    make(alice, "robinhood", "RH", RH)
    use(FakeHistory(ALL5, errors={"SPY"}))
    b = alice.get("/api/portfolio/history?compare=spy").json()
    assert b["spy"] is None and all(p["spy_value"] is None for p in b["points"])
    assert any("SPY history is unavailable" in w for w in b["warnings"])
    assert len(b["points"]) == 3


def test_spy_is_not_fetched_unless_asked(alice):
    make(alice, "robinhood", "RH", RH)
    h = use(FakeHistory(ALL5))
    alice.get("/api/portfolio/history")
    assert "SPY" not in {s for s, _ in h.calls}


def test_history_is_cached_per_symbol_and_range(alice):
    make(alice, "robinhood", "RH", RH)
    h = use(FakeHistory(ALL5))
    alice.get("/api/portfolio/history?range=1m")
    n = len(h.calls)
    alice.get("/api/portfolio/history?range=1m")
    assert len(h.calls) == n
    alice.get("/api/portfolio/history?range=6m")
    assert len(h.calls) == 2 * n


def test_intraday_uses_bar_timestamps(alice):
    make(alice, "robinhood", "RH", RH)
    day = date(2026, 10, 6)
    data = {
        s: [bar(day, c, 0), bar(day, c + 1, 1)]
        for s, c in (("ORCL", 100), ("INTC", 10), ("DIS", 100))
    }
    use(FakeHistory(data))
    b = alice.get("/api/portfolio/history?range=1d").json()
    assert b["intraday"] is True and len(b["points"]) == 2
    assert b["points"][1]["t"] - b["points"][0]["t"] == 3600
    assert b["points"][0]["value"] == "7500.00"


def test_negative_quantity_and_zero_start_do_not_crash():
    pts, limiter = portfolio.back_cast(
        {"A": D(-1)}, {"A": portfolio.Series(daily(D0, [5, 6]), False)}
    )
    assert [v for _, v in pts] == [D("-5.00"), D("-6.00")] and limiter is None
    assert portfolio._pct(D(1), D(0)) is None


@pytest.mark.parametrize("rng", ["1d", "5d", "1m", "6m", "ytd", "1y", "all"])
def test_every_range_is_accepted(alice, rng):
    make(alice, "robinhood", "RH", RH)
    use(FakeHistory(ALL5))
    assert alice.get(f"/api/portfolio/history?range={rng}").status_code == 200
