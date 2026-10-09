from collections import Counter
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import update

from app.db import get_db
from app.main import app
from app.models import FundamentalsCache
from app.providers import get_fundamentals_provider, get_history_provider, get_ownership_provider
from app.providers.base import (
    AnnualReport,
    Bar,
    BasicFinancials,
    InsiderTrade,
    Ownership,
    ProviderError,
    SeriesPoint,
    Split,
)

D = Decimal


def financials(pe="12", pb="1.2", cap="5000"):
    return BasicFinancials(
        metric={
            "peTTM": D(pe),
            "pb": D(pb),
            "marketCapitalization": D(cap),
            "currentRatioQuarterly": D("2.5"),
        },
        annual={
            "eps": [
                SeriesPoint(date(2025 - i, 12, 31), D(2) if i < 3 else D(1)) for i in range(12)
            ],
            "longtermDebtTotalCapital": [SeriesPoint(date(2025, 12, 31), D("0.3"))],
        },
    )


def reports():
    return [
        AnnualReport(
            2025 - i,
            date(2025 - i, 12, 31),
            {
                "NetIncomeLoss": D(100 + 10 * (10 - i)),
                "DepreciationDepletionAndAmortization": D(10),
                "PaymentsToAcquirePropertyPlantAndEquipment": D(10),
                "NetCashProvidedByUsedInOperatingActivities": D(120),
                "NetCashProvidedByUsedInFinancingActivities": D(-50),
                "PaymentsForRepurchaseOfCommonStock": D(20),
                "Revenues": D(1000),
                "ResearchAndDevelopmentExpense": D(80),
            },
        )
        for i in range(11)
    ]


class FakeFundamentals:
    def __init__(self, by_symbol=None, peers=(), error=None, insider_error=None):
        self.by_symbol = by_symbol if by_symbol is not None else {"ACME": financials()}
        self.peers = list(peers)
        self.error = error
        self.insider_error = insider_error
        self.calls = Counter()

    def _go(self, name, symbol):
        self.calls[(name, symbol)] += 1
        if self.error:
            raise self.error

    def get_basic_financials(self, symbol):
        self._go("metric", symbol)
        return self.by_symbol.get(symbol)

    def get_reported_annual(self, symbol):
        self._go("reported", symbol)
        return reports() if symbol in self.by_symbol else []

    def get_peers(self, symbol):
        self._go("peers", symbol)
        return self.peers

    def get_insider_transactions(self, symbol):
        self._go("insider", symbol)
        if self.insider_error:
            raise self.insider_error
        today = datetime.now(UTC).date()
        return [
            InsiderTrade("CEO", -1000, D(50), "S", today - timedelta(days=10), None),
            InsiderTrade("CFO", 100, None, "A", today - timedelta(days=10), None),
        ]


class FakeOwnership:
    def __init__(self, inst="0.45", quote_types=None, error=None):
        self.inst, self.quote_types, self.error = inst, quote_types or {}, error

    def get_ownership(self, symbol):
        if self.error:
            raise self.error
        return Ownership(
            D(self.inst),
            "Industrials",
            "Machinery",
            self.quote_types.get(symbol, "EQUITY"),
            f"{symbol} Corp",
        )

    def get_splits(self, symbol):
        return [Split(date(2020, 1, 2), D(2)), Split(date(2024, 6, 1), D(4))]


class FakeHistory:
    def __init__(self, error=None):
        self.error = error

    def get_history(self, symbol, range_):
        if self.error:
            raise self.error
        out = []
        for year, close in [(2021, 50), (2022, 50), (2023, 50), (2024, 50), (2025, 40)]:
            d = date(year, 6, 1)
            out.append(
                Bar(datetime(year, 6, 1, tzinfo=UTC), d, D(close), D(close), D(close), D(close), 0)
            )
        return out


def use(fundamentals=None, ownership=None, history=None):
    app.dependency_overrides[get_fundamentals_provider] = lambda: fundamentals
    app.dependency_overrides[get_ownership_provider] = lambda: ownership or FakeOwnership()
    app.dependency_overrides[get_history_provider] = lambda: history or FakeHistory()


def by_key(body):
    return {p["key"]: p for p in body["principles"]}


def test_without_a_key_the_scorecard_says_so(alice):
    use(None)
    r = alice.get("/api/principles/ACME")
    assert r.status_code == 503 and "FINNHUB_API_KEY" in r.json()["detail"]
    assert alice.get("/api/principles/ACME/peers").status_code == 503


def test_scorecard_values_statuses_and_evidence(alice):
    use(FakeFundamentals())
    r = alice.get("/api/principles/acme")
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["symbol"], body["name"], body["sector"], body["applicable"]) == (
        "ACME",
        "ACME Corp",
        "Industrials",
        True,
    )
    p = by_key(body)
    assert (p["pe"]["value"], p["pe"]["status"], p["pe"]["rule"]) == ("12.00", "pass", "< 15")
    assert p["institutional_pct"]["value"] == "45.00"
    assert p["market_cap"]["value"] == "5000000000"
    assert p["eps_growth_10y"]["status"] == "pass"
    assert p["rd_pct_sales"]["value"] == "8.00"
    # bought back every year; 2021-24 at the 5-year high (50), 2025 at 40: 4 of 5 equal years
    assert (p["buybacks_at_highs"]["value"], p["buybacks_at_highs"]["status"]) == ("80.00", "warn")
    assert p["wide_moat"]["kind"] == "manual" and p["wide_moat"]["status"] == "manual"
    assert all(x["check"] is None for x in body["principles"])

    ev = body["evidence"]
    assert [t["name"] for t in ev["insider_trades"]] == ["CEO"]  # the grant is not open market
    assert ev["insider_net_value"] == "-50000.00"
    [ceo] = ev["insider_summary"]["sellers"]
    assert (ceo["name"], ceo["value"], ceo["avg_price"]) == ("CEO", "50000.00", "50.00")
    assert ev["insider_summary"]["buyers"] == []
    assert [s["ratio"] for s in ev["splits"]] == ["4", "2"]  # newest first
    assert len(ev["years"]) == 10 and ev["years"][0]["owner_earnings"] == "200"
    assert body["warnings"] == [] and body["stale"] is False


def test_watchlist_rows_skip_evidence_lookups(alice):
    fp = FakeFundamentals()
    use(fp)
    body = alice.get("/api/principles/ACME?evidence=false").json()
    assert body["evidence"] is None
    assert fp.calls[("insider", "ACME")] == 0


def test_fundamentals_are_cached_in_the_db(alice):
    fp = FakeFundamentals()
    use(fp)
    alice.get("/api/principles/ACME")
    alice.get("/api/principles/ACME?evidence=false")
    assert fp.calls[("metric", "ACME")] == 1
    assert fp.calls[("reported", "ACME")] == 1


def test_a_failed_refresh_serves_the_old_row_flagged_stale(alice):
    use(FakeFundamentals())
    alice.get("/api/principles/ACME")
    db = next(app.dependency_overrides[get_db]())
    db.execute(update(FundamentalsCache).values(fetched_at=datetime.now(UTC) - timedelta(days=2)))
    db.commit()
    use(FakeFundamentals(error=ProviderError("Finnhub rate limit reached")))
    body = alice.get("/api/principles/ACME?evidence=false").json()
    assert body["stale"] is True
    assert by_key(body)["pe"]["value"] == "12.00"
    assert any("refresh failed" in w for w in body["warnings"])


def test_provider_down_with_nothing_cached_is_502(alice):
    use(FakeFundamentals(error=ProviderError("Finnhub rate limit reached")))
    r = alice.get("/api/principles/ACME")
    assert r.status_code == 502 and "rate limit" in r.json()["detail"]


def test_yahoo_down_degrades_only_its_parts(alice):
    use(
        FakeFundamentals(),
        FakeOwnership(error=ProviderError("Yahoo Finance request failed")),
        FakeHistory(error=ProviderError("Yahoo Finance request failed")),
    )
    body = alice.get("/api/principles/ACME?evidence=false").json()
    p = by_key(body)
    assert p["institutional_pct"]["status"] == "na"
    assert p["buybacks_at_highs"]["status"] == "na"
    assert p["pe"]["status"] == "pass"
    assert len(body["warnings"]) == 2


def test_partial_data_is_refetched_sooner(alice):
    fp = FakeFundamentals()
    use(fp, FakeOwnership(error=ProviderError("down")))
    alice.get("/api/principles/ACME?evidence=false")
    db = next(app.dependency_overrides[get_db]())
    row = db.get(FundamentalsCache, "ACME")
    assert row.complete is False
    db.execute(update(FundamentalsCache).values(fetched_at=datetime.now(UTC) - timedelta(hours=2)))
    db.commit()
    use(fp)
    body = alice.get("/api/principles/ACME?evidence=false").json()
    assert by_key(body)["institutional_pct"]["status"] == "pass"
    assert fp.calls[("metric", "ACME")] == 2


def test_insider_failure_is_a_warning(alice):
    use(FakeFundamentals(insider_error=ProviderError("down")))
    body = alice.get("/api/principles/ACME").json()
    assert body["evidence"]["insider_trades"] == []
    assert body["evidence"]["insider_net_value"] is None
    assert any("Insider" in w for w in body["warnings"])


def test_a_fund_is_not_scored(alice):
    use(FakeFundamentals(by_symbol={"VOO": None}), FakeOwnership(quote_types={"VOO": "ETF"}))
    body = alice.get("/api/principles/VOO").json()
    assert body["applicable"] is False and body["principles"] == []
    assert "fund" in body["warnings"][0]


def test_checks_are_per_user_and_override_nothing_else(admin, alice):
    use(FakeFundamentals())
    r = alice.put(
        "/api/principles/acme/checks/wide_moat", json={"verdict": "pass", "note": " brand "}
    )
    assert r.status_code == 200 and r.json()["note"] == "brand"
    alice.put("/api/principles/ACME/checks/pe", json={"verdict": "fail"})

    p = by_key(alice.get("/api/principles/ACME").json())
    assert p["wide_moat"]["check"]["verdict"] == "pass"
    assert p["pe"]["check"]["verdict"] == "fail" and p["pe"]["status"] == "pass"
    assert by_key(admin.get("/api/principles/ACME").json())["wide_moat"]["check"] is None

    assert alice.delete("/api/principles/ACME/checks/wide_moat").status_code == 204
    assert alice.delete("/api/principles/ACME/checks/wide_moat").status_code == 204
    assert by_key(alice.get("/api/principles/ACME").json())["wide_moat"]["check"] is None


def test_check_validation(alice):
    assert (
        alice.put("/api/principles/ACME/checks/nope", json={"verdict": "pass"}).status_code == 404
    )
    assert alice.put("/api/principles/ACME/checks/pe", json={"verdict": "maybe"}).status_code == 422
    long = {"verdict": "pass", "note": "x" * 2001}
    assert alice.put("/api/principles/ACME/checks/pe", json=long).status_code == 422
    assert alice.put("/api/principles/-x/checks/pe", json={"verdict": "pass"}).status_code == 422


def test_peer_stats(alice):
    fp = FakeFundamentals(
        by_symbol={
            "ACME": financials(),
            "P1": financials(pe="10"),
            "P2": financials(pe="20"),
            "P3": financials(pe="60"),
            "FUND": None,
        },
        peers=["P1", "P2", "P3", "FUND", "GONE"],
    )
    fp_fail = {"GONE"}
    orig = fp.get_basic_financials

    def flaky(symbol):
        if symbol in fp_fail:
            raise ProviderError("down")
        return orig(symbol)

    fp.get_basic_financials = flaky
    use(fp, FakeOwnership(quote_types={"FUND": "ETF"}))
    r = alice.get("/api/principles/ACME/peers")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [p["symbol"] for p in body["peers"]] == ["P1", "P2", "P3"]
    assert body["failed"] == ["GONE"]
    stats = {s["key"]: s for s in body["stats"]}
    assert (stats["pe"]["mean"], stats["pe"]["median"], stats["pe"]["n"]) == ("30.00", "20.00", 3)
    assert stats["buybacks_at_highs"]["n"] == 0  # peers are scored without price history

    alice.get("/api/principles/ACME/peers")
    assert fp.calls[("peers", "ACME")] == 1  # cached
    assert fp.calls[("metric", "P1")] == 1


def test_peers_provider_down_is_502(alice):
    use(FakeFundamentals(error=ProviderError("down")))
    assert alice.get("/api/principles/ACME/peers").status_code == 502
