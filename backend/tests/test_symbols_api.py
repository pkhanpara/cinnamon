from datetime import UTC, date, datetime
from decimal import Decimal as D
from pathlib import Path

import pytest

from app.main import app
from app.providers import (
    ProviderError,
    Quote,
    get_company_provider,
    get_history_provider,
    get_quote_provider,
)
from app.providers.base import Bar, HistoryRange, Metrics, NewsItem, Profile, SearchHit
from tests.conftest import ADMIN, login, seed_user

SAMPLE = Path(__file__).resolve().parents[2] / "seed" / "sample"
RH = (SAMPLE / "robinhood_positions.csv").read_bytes()  # ORCL 40, INTC 100, DIS 25
M1 = (SAMPLE / "m1_positions.csv").read_bytes()  # VTI 30, SCHD 80, ORCL 10


class FakeQuotes:
    def __init__(self, prices=None, error=None):
        self.prices, self.error, self.calls = prices or {}, error, 0

    def get_quotes(self, symbols):
        self.calls += 1
        if self.error:
            raise self.error
        return {
            s: Quote(s, D(p), D(prev), None) for s, (p, prev) in self.prices.items() if s in symbols
        }


class FakeCompany:
    def __init__(self, profiles=None, metrics=None, news=None, hits=None, error=None):
        self.profiles, self.metrics, self.news_items = profiles or {}, metrics or {}, news or []
        self.hits, self.error, self.calls = hits or [], error, []

    def _go(self, name, *args):
        self.calls.append((name, *args))
        if self.error:
            raise self.error

    def get_profile(self, symbol):
        self._go("profile", symbol)
        return self.profiles.get(symbol)

    def get_metrics(self, symbol):
        self._go("metrics", symbol)
        return self.metrics.get(symbol)

    def get_news(self, symbol, days, limit):
        self._go("news", symbol, days, limit)
        return self.news_items

    def search(self, query):
        self._go("search", query)
        return self.hits


class FakeHistory:
    def __init__(self, bars=None, error=None):
        self.bars, self.error, self.calls = bars or [], error, []

    def get_history(self, symbol, range_):
        self.calls.append((symbol, range_))
        if self.error:
            raise self.error
        return self.bars


def use(quotes=None, company=None, history=None):
    app.dependency_overrides[get_quote_provider] = lambda: quotes
    app.dependency_overrides[get_company_provider] = lambda: company
    if history is not None:
        app.dependency_overrides[get_history_provider] = lambda: history
    return quotes, company, history


NVDA_PROFILE = Profile(
    "NVIDIA Corp",
    "NASDAQ",
    "Semiconductors",
    "US",
    "USD",
    "https://www.nvidia.com/",
    D("5765683.85"),
)
NVDA_METRICS = Metrics(D("240.0983"), D("164.27"), D("107.9"), D("134.7"))


def mk(client, platform, nick, csv):
    a = client.post("/api/accounts", json={"platform": platform, "nickname": nick}).json()["id"]
    r = client.post(
        f"/api/accounts/{a}/imports",
        data={"connector": "snapshot"},
        files={"file": ("x.csv", csv, "text/csv")},
    )
    assert r.status_code == 201, r.text


def test_overview_of_a_held_symbol_combines_quote_profile_stats_and_position(alice):
    mk(alice, "robinhood", "RH", RH)
    mk(alice, "m1", "M1", M1)
    use(
        FakeQuotes({"ORCL": ("170.55", "169.00")}),
        FakeCompany(
            {"ORCL": Profile("Oracle", "NYSE", "Software", "US", "USD", None, D(500000))},
            {"ORCL": NVDA_METRICS},
        ),
    )
    b = alice.get("/api/symbols/orcl").json()  # lower case is normalised
    assert b["symbol"] == "ORCL" and b["name"] == "Oracle" and b["warnings"] == []
    assert (
        b["quote"]["price"] == "170.55"
        and b["quote"]["change"] == "1.55"
        and b["quote"]["change_pct"] == "0.9172"
    )
    assert b["profile"]["market_cap"] == "500000000000"  # millions -> dollars
    assert b["stats"]["week52_high"] == "240.0983" and b["stats"]["avg_volume_10d"] == "107900000"
    pos = b["position"]
    assert pos["quantity"] == "50" and pos["value"] == "8527.50"
    assert [(ln["account_nickname"], ln["quantity"]) for ln in pos["lines"]] == [
        ("M1", "10"),
        ("RH", "40"),
    ]


def test_money_and_volume_are_whole_numbers_without_float_noise(alice):
    noisy = Profile("X", None, None, None, None, None, D("5765683.852695655"))
    use(
        FakeQuotes({"X": ("100", "100")}),
        FakeCompany({"X": noisy}, {"X": Metrics(D(90), D(120), D("107.92138"), None)}),
    )
    b = alice.get("/api/symbols/X").json()
    assert b["profile"]["market_cap"] == "5765683852696"
    assert b["stats"]["avg_volume_10d"] == "107921380" and b["stats"]["avg_volume_3m"] is None


def test_a_52_week_range_that_cannot_belong_to_the_price_is_hidden(alice):
    # Real Finnhub data for BRK.B: Class A prices (~$700k-$800k) while the quote is ~$505.
    use(
        FakeQuotes({"BRK.B": ("505.54", "504.26")}),
        FakeCompany(
            {"BRK.B": NVDA_PROFILE},
            {"BRK.B": Metrics(D("806102.8"), D(698000), D("3.5"), D("4.1"))},
        ),
    )
    b = alice.get("/api/symbols/BRK.B").json()
    assert b["stats"]["week52_high"] is None and b["stats"]["week52_low"] is None
    assert b["stats"]["avg_volume_10d"] == "3500000"  # the rest of the stats are kept
    assert any("52-week range" in w for w in b["warnings"])


def test_a_plausible_52_week_range_is_kept_even_when_the_price_is_at_its_edge(alice):
    use(
        FakeQuotes({"X": ("101", "100")}),
        FakeCompany({"X": NVDA_PROFILE}, {"X": Metrics(D(100), D(60), None, None)}),
    )
    b = alice.get("/api/symbols/X").json()
    assert b["stats"]["week52_high"] == "100" and b["warnings"] == []


def test_a_symbol_you_do_not_hold_has_no_position(alice):
    use(
        FakeQuotes({"NVDA": ("239.24", "238.0")}),
        FakeCompany({"NVDA": NVDA_PROFILE}, {"NVDA": NVDA_METRICS}),
    )
    b = alice.get("/api/symbols/NVDA").json()
    assert b["position"] is None and b["name"] == "NVIDIA Corp" and b["quote"]["price"] == "239.24"


def test_an_etf_without_a_profile_takes_its_name_from_your_import(alice):
    mk(alice, "m1", "M1", M1)
    use(
        FakeQuotes({"VTI": ("280", "279")}), FakeCompany()
    )  # profile and metrics are None, like Finnhub for ETFs
    b = alice.get("/api/symbols/VTI").json()
    assert b["profile"] is None and b["stats"] is None
    assert b["name"] == "Vanguard Total Stock Market ETF" and b["position"]["quantity"] == "30"


def test_other_users_positions_are_never_included(admin, alice):
    mk(admin, "robinhood", "Admin RH", RH)
    use(FakeQuotes({"ORCL": ("170", "169")}), FakeCompany())
    assert alice.get("/api/symbols/ORCL").json()["position"] is None
    assert admin.get("/api/symbols/ORCL").json()["position"]["quantity"] == "40"


def test_a_stale_quote_has_no_day_change(alice):
    from datetime import timedelta

    from sqlalchemy import update

    from app.db import get_db
    from app.models import QuoteCache

    use(FakeQuotes({"KO": ("70", "69")}), FakeCompany())
    alice.get("/api/symbols/KO")
    db = next(app.dependency_overrides[get_db]())
    db.execute(update(QuoteCache).values(fetched_at=datetime.now(UTC) - timedelta(hours=3)))
    db.commit()
    use(FakeQuotes(error=ProviderError("down")), FakeCompany())
    q = alice.get("/api/symbols/KO").json()["quote"]
    assert (
        q["stale"] is True
        and q["price"] == "70"
        and q["change"] is None
        and q["change_pct"] is None
    )


def test_company_failure_still_returns_the_quote_with_a_warning(alice):
    use(
        FakeQuotes({"KO": ("70", "69")}),
        FakeCompany(error=ProviderError("Finnhub rate limit reached")),
    )
    b = alice.get("/api/symbols/KO").json()
    assert b["quote"]["price"] == "70" and b["profile"] is None
    assert any("rate limit" in w for w in b["warnings"])


def test_unknown_symbol_is_404(alice):
    use(FakeQuotes(), FakeCompany())
    r = alice.get("/api/symbols/ZZZZ")
    assert r.status_code == 404 and "Unknown symbol ZZZZ" in r.json()["detail"]


def test_providers_down_for_an_unheld_symbol_is_502_not_a_false_404(alice):
    use(
        FakeQuotes(error=ProviderError("Finnhub rate limit reached")),
        FakeCompany(error=ProviderError("Finnhub rate limit reached")),
    )
    r = alice.get("/api/symbols/NVDA")
    assert r.status_code == 502 and "rate limit" in r.json()["detail"]


def test_without_api_keys_a_held_symbol_still_works_from_the_import(alice):
    mk(alice, "robinhood", "RH", RH)
    use(None, None)
    b = alice.get("/api/symbols/ORCL").json()
    assert b["quote"] is None and b["name"] == "Oracle Corporation"
    assert b["position"]["source"] == "file" and b["position"]["value"] == "6800.00"
    assert any("FINNHUB_API_KEY" in w for w in b["warnings"])


def test_without_api_keys_an_unheld_symbol_says_a_key_is_needed(alice):
    use(None, None)
    r = alice.get("/api/symbols/NVDA")
    assert r.status_code == 503 and "FINNHUB_API_KEY" in r.json()["detail"]


@pytest.mark.parametrize("bad", ["a%20b", "x" * 16, "%24%24", "-A", ".A", "A%2FB"])
def test_malformed_symbols_are_rejected_before_any_provider_call(alice, bad):
    q, c, h = use(FakeQuotes(), FakeCompany(), FakeHistory())
    for path in ("", "/history", "/news"):
        assert alice.get(f"/api/symbols/{bad}{path}").status_code in (404, 422), (bad, path)
    assert q.calls == 0 and c.calls == [] and h.calls == []


def test_profile_and_stats_are_cached_between_requests(alice):
    _, company, _ = use(
        FakeQuotes({"NVDA": ("1", "1")}),
        FakeCompany({"NVDA": NVDA_PROFILE}, {"NVDA": NVDA_METRICS}),
    )
    alice.get("/api/symbols/NVDA")
    alice.get("/api/symbols/NVDA")
    assert [c[0] for c in company.calls] == ["profile", "metrics"]


# ---- history ----


def bars(n=3):
    return [
        Bar(
            datetime(2026, 10, 1 + i, 4, tzinfo=UTC),
            date(2026, 10, 1 + i),
            D("1.5"),
            D(2),
            D(1),
            D(f"{10 + i}.25"),
            100 * (i + 1),
        )
        for i in range(n)
    ]


def test_history_shape_and_defaults(alice):
    _, _, h = use(history=FakeHistory(bars()))
    b = alice.get("/api/symbols/nvda/history").json()
    assert (
        b["symbol"] == "NVDA"
        and b["range"] == "1m"
        and b["intraday"] is False
        and b["stale"] is False
    )
    assert b["bars"][0] == {
        "t": int(datetime(2026, 10, 1, 4, tzinfo=UTC).timestamp()),
        "d": "2026-10-01",
        "o": "1.5",
        "h": "2",
        "l": "1",
        "c": "10.25",
        "v": 100,
    }
    assert h.calls == [("NVDA", HistoryRange.M1)]


@pytest.mark.parametrize(
    ("rng", "intraday"),
    [
        ("1d", True),
        ("5d", True),
        ("1m", False),
        ("6m", False),
        ("ytd", False),
        ("1y", False),
        ("all", False),
    ],
)
def test_every_range_is_accepted_and_flags_intraday(alice, rng, intraday):
    use(history=FakeHistory(bars()))
    b = alice.get(f"/api/symbols/NVDA/history?range={rng}").json()
    assert b["range"] == rng and b["intraday"] is intraday


def test_unknown_range_is_422(alice):
    use(history=FakeHistory(bars()))
    assert alice.get("/api/symbols/NVDA/history?range=10y").status_code == 422


def test_history_is_cached_per_symbol_and_range(alice):
    _, _, h = use(history=FakeHistory(bars()))
    alice.get("/api/symbols/NVDA/history?range=1y")
    alice.get("/api/symbols/NVDA/history?range=1y")
    alice.get("/api/symbols/NVDA/history?range=6m")
    alice.get("/api/symbols/VOO/history?range=1y")
    assert len(h.calls) == 3


def test_history_for_an_unknown_symbol_is_404_and_a_provider_failure_is_502(alice):
    use(history=FakeHistory([]))
    assert alice.get("/api/symbols/ZZZZ/history").status_code == 404
    use(history=FakeHistory(error=ProviderError("Yahoo Finance request failed: HTTPError")))
    r = alice.get("/api/symbols/NVDA/history")
    assert r.status_code == 502 and "Price history is unavailable" in r.json()["detail"]


# ---- news ----


def item(i):
    return NewsItem(
        f"h{i}", "s", "Reuters", f"https://x.test/{i}", datetime(2026, 10, 1 + i, tzinfo=UTC)
    )


def test_news_returns_items_and_asks_for_a_bounded_window(alice):
    _, company, _ = use(company=FakeCompany(news=[item(2), item(1)]))
    b = alice.get("/api/symbols/NVDA/news").json()
    assert [n["headline"] for n in b["items"]] == ["h2", "h1"] and b["stale"] is False
    assert b["items"][0] == {
        "headline": "h2",
        "summary": "s",
        "source": "Reuters",
        "url": "https://x.test/2",
        "published_at": "2026-10-03T00:00:00Z",
    }
    assert company.calls == [("news", "NVDA", 14, 20)]


def test_news_without_a_key_is_503_and_provider_failure_is_502(alice):
    use(company=None)
    assert alice.get("/api/symbols/NVDA/news").status_code == 503
    use(company=FakeCompany(error=ProviderError("Finnhub rate limit reached")))
    r = alice.get("/api/symbols/NVDA/news")
    assert r.status_code == 502 and "rate limit" in r.json()["detail"]


def test_news_is_cached(alice):
    _, company, _ = use(company=FakeCompany(news=[item(1)]))
    alice.get("/api/symbols/NVDA/news")
    alice.get("/api/symbols/nvda/news")
    assert len(company.calls) == 1


# ---- search ----


def test_search_returns_hits_and_is_cached_case_insensitively(alice):
    _, company, _ = use(
        company=FakeCompany(hits=[SearchHit("NVDA", "NVIDIA Corp", "Common Stock")])
    )
    assert alice.get("/api/symbols/search?q=nvidia").json() == [
        {"symbol": "NVDA", "description": "NVIDIA Corp", "type": "Common Stock"}
    ]
    alice.get("/api/symbols/search?q=NVIDIA")
    assert len(company.calls) == 1


def test_search_route_is_not_shadowed_by_the_symbol_route(alice):
    use(company=FakeCompany(hits=[]))
    assert alice.get("/api/symbols/search?q=zz").status_code == 200  # not "unknown symbol SEARCH"


def test_search_validation_and_failures(alice):
    use(company=FakeCompany())
    assert alice.get("/api/symbols/search").status_code == 422
    assert alice.get("/api/symbols/search?q=").status_code == 422
    assert alice.get("/api/symbols/search?q=" + "x" * 41).status_code == 422
    assert alice.get("/api/symbols/search?q=%20%20").json() == []
    use(company=None)
    assert alice.get("/api/symbols/search?q=a").status_code == 503
    use(company=FakeCompany(error=ProviderError("Finnhub rate limit reached")))
    assert alice.get("/api/symbols/search?q=a").status_code == 502


# ---- access control ----


def test_everything_requires_login(client):
    for path in (
        "/api/symbols/NVDA",
        "/api/symbols/NVDA/history",
        "/api/symbols/NVDA/news",
        "/api/symbols/search?q=a",
    ):
        assert client.get(path).status_code == 401, path


def test_a_pending_password_change_blocks_them_too(client):
    seed_user(client, ADMIN, is_admin=True, must_change=True)
    c = login(client, ADMIN)
    for path in (
        "/api/symbols/NVDA",
        "/api/symbols/NVDA/history",
        "/api/symbols/NVDA/news",
        "/api/symbols/search?q=a",
    ):
        r = c.get(path)
        assert r.status_code == 403 and r.json()["detail"] == "Password change required", path
