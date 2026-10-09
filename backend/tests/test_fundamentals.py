import json
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from app import fundamentals as F
from app.providers.base import Bar, InsiderTrade, Ownership
from app.providers.finnhub import FinnhubProvider

FIXTURES = Path(__file__).parent / "fixtures" / "fundamentals"
D = Decimal


def real_core(symbol, industry="Drug Manufacturers - General", inst="0.767"):
    """CoreData from the recorded (trimmed) Finnhub responses of 2026-10-08."""

    def handler(req):
        kind = "metric" if req.url.path.endswith("/metric") else "reported"
        return httpx.Response(
            200, json=json.loads((FIXTURES / f"{symbol}-{kind}.json").read_text())
        )

    fp = FinnhubProvider("K", "https://f.test", transport=httpx.MockTransport(handler))
    own = Ownership(D(inst), "Healthcare", industry, "EQUITY", f"{symbol} Inc")
    return F.core_from(symbol, fp.get_basic_financials(symbol), fp.get_reported_annual(symbol), own)


def by_key(results):
    return {r.key: r for r in results}


@pytest.fixture(scope="module")
def jnj():
    return real_core("JNJ")


def test_jnj_scorecard_matches_hand_checked_values(jnj):
    r = by_key(F.score(jnj))
    expected = {
        "institutional_pct": (D("76.70"), "fail"),
        "pb": (D("7.18"), "fail"),
        "pe": (D("29.01"), "fail"),
        # (11.0332 + 5.7899 + 13.7295) / 3 vs fiscal 2014-2016 average
        "eps_growth_10y": (D("78.58"), "pass"),
        "current_ratio": (D("1.09"), "fail"),
        "market_cap": (D("610355000000"), "pass"),
        "ltd_to_capital": (D("30.46"), "pass"),
        "owner_earnings_cagr": (D("11.10"), "pass"),
        "opm": (D("-0.23"), "pass"),
        "rd_pct_sales": (D("15.57"), "info"),  # 14.665B / 94.193B
        "acquisitions": (D("43.34"), "pass"),
    }
    assert {k: (r[k].value, r[k].status) for k in expected} == expected
    assert r["buybacks_at_highs"].status == "na"  # no price history given


def test_scores_come_in_registry_order(jnj):
    from app.principles import PRINCIPLES, Kind

    assert [r.key for r in F.score(jnj)] == [p.key for p in PRINCIPLES if p.kind is Kind.COMPUTED]


def test_fiscal_years_ending_in_early_january_belong_to_the_previous_year():
    assert F.fiscal_year(date(2023, 1, 1)) == 2022
    assert F.fiscal_year(date(2016, 1, 3)) == 2015
    assert F.fiscal_year(date(2025, 12, 28)) == 2025
    assert F.fiscal_year(date(2025, 6, 30)) == 2025


def test_jnj_eps_has_one_point_per_fiscal_year(jnj):
    years = [y for y, _ in jnj.eps]
    assert years == sorted(set(years), reverse=True)
    assert years[:4] == [2025, 2024, 2023, 2022]


def test_the_rd_concept_that_is_a_small_charge_is_not_taken_for_total_rd(jnj):
    assert jnj.years[0].rnd == D("14665000000")


def test_core_data_survives_a_json_round_trip(jnj):
    assert F.CoreData.from_json(json.loads(json.dumps(jnj.to_json()))) == jnj


def test_a_bank_has_no_current_ratio_and_no_cash_flow_verdicts():
    jpm = real_core("JPM", industry="Banks - Diversified")
    r = by_key(F.score(jpm))
    assert r["current_ratio"].status == "na"
    assert r["opm"].status == "na" and "banks" in r["opm"].note
    assert r["acquisitions"].status == "na"
    assert r["owner_earnings_cagr"].status == "na"  # banks report no capex
    assert r["pe"].status == "pass"


def test_a_fund_is_recognised():
    assert F.CoreData("VOO", quote_type="ETF").is_fund
    assert F.CoreData("VOO").is_fund  # nothing at all: also not a company we can score
    assert not F.CoreData("X", pe=D(10)).is_fund


def eps_core(values, start=2025):
    return F.CoreData("X", eps=tuple((start - i, D(v)) for i, v in enumerate(values)))


def test_eps_growth_uses_three_year_averages_a_decade_apart():
    # 2025..2014: recent avg 2.0, old (2016, 2015, 2014) avg 1.5 -> +33.33%
    r = F.eps_growth_result(eps_core([2, 2, 2, 9, 9, 9, 9, 9, 9, 1.5, 1.5, 1.5, 100]))
    assert (r.value, r.status, r.years) == (D("33.33"), "pass", 12)


def test_eps_growth_with_a_short_history_says_so():
    r = F.eps_growth_result(eps_core([2, 2, 2, 1, 1, 1]))
    assert (r.value, r.status) == (D("100.00"), "pass")
    assert "6 years" in r.note


def test_eps_growth_not_enough_years_or_losses():
    assert F.eps_growth_result(eps_core([1, 1, 1])).status == "na"
    r = F.eps_growth_result(eps_core([2, 2, 2, -1, -1, -1]))
    assert (r.value, r.status) == (None, "fail")


@pytest.mark.parametrize(
    ("pe", "eps", "status"),
    [
        (D("14.9"), (), "pass"),
        (D(15), (), "fail"),
        (None, ((2025, D(-1)),), "fail"),
        (None, (), "na"),
    ],
)
def test_pe(pe, eps, status):
    assert F.pe_result(F.CoreData("X", pe=pe, eps=eps)).status == status


def test_negative_book_value_fails_pb():
    assert F.pb_result(F.CoreData("X", pb=D("-0.5"))).status == "fail"
    assert F.pb_result(F.CoreData("X", pb=D("1.49"))).status == "pass"


def years(*rows):
    return tuple(F.YearFacts(year=2025 - i, **row) for i, row in enumerate(rows))


def test_owner_earnings_cagr():
    # 3-year averages 100 (2016-18) and 200 (2023-25); middles 2017 and 2024 are 7 years apart
    # -> 2 ** (1/7) - 1 = 10.41% a year
    rows = [
        {"net_income": D(v), "dna": D(0), "capex": D(0)} for v in [200] * 3 + [150] * 4 + [100] * 3
    ]
    r = F.owner_earnings_result(F.CoreData("X", years=years(*rows)))
    assert (r.value, r.status, r.years) == (D("10.41"), "pass", 10)


def test_owner_earnings_need_net_income_dna_and_capex():
    rows = [{"net_income": D(1), "dna": D(1)}] * 10
    assert F.owner_earnings_result(F.CoreData("X", years=years(*rows))).status == "na"


def test_opm_fails_when_financing_exceeds_operating_cash():
    r = F.opm_result(F.CoreData("X", years=years({"cfo": D(10), "cff": D(20)})))
    assert (r.value, r.status) == (D("2.00"), "fail")


def test_opm_warns_when_it_happened_often_before():
    rows = [{"cfo": D(10), "cff": D(-5)}] + [{"cfo": D(10), "cff": D(20)}] * 3
    assert F.opm_result(F.CoreData("X", years=years(*rows))).status == "warn"


def test_acquisitions_warn_above_half_of_operating_cash():
    rows = [{"cfo": D(100), "acquisitions": D(60)}] + [{"cfo": D(100)}] * 4
    r = F.acquisitions_result(F.CoreData("X", years=years(*rows)))
    assert (r.value, r.status) == (D("12.00"), "pass")
    rows = [{"cfo": D(100), "acquisitions": D(300)}] + [{"cfo": D(100)}] * 4
    assert F.acquisitions_result(F.CoreData("X", years=years(*rows))).status == "warn"


def weekly(prices_by_year):
    bars = []
    for year, closes in prices_by_year.items():
        for i, c in enumerate(closes):
            d = date(year, 1 + i, 15)
            bars.append(
                Bar(datetime(d.year, d.month, d.day, tzinfo=UTC), d, D(c), D(c), D(c), D(c), 0)
            )
    return bars


def test_buybacks_near_the_five_year_high_are_flagged():
    bars = weekly({2021: [50], 2022: [60], 2023: [70], 2024: [80], 2025: [100]})
    core = F.CoreData(
        "X",
        years=years({"buybacks": D(90)}, {"buybacks": D(10)}, {}, {}, {}),  # 2025 at the high
    )
    rows = F.buyback_years(core, bars)
    assert [(b.year, b.near_high) for b in rows] == [(2025, True), (2024, True)]
    r = F.buybacks_result(core, bars)
    assert (r.value, r.status) == (D("100.00"), "warn")


def test_buybacks_when_cheap_pass():
    bars = weekly({2021: [100], 2022: [100], 2023: [100], 2024: [100], 2025: [60]})
    core = F.CoreData("X", years=years({"buybacks": D(90)}, {}, {}, {}, {}))
    r = F.buybacks_result(core, bars)
    assert (r.value, r.status) == (D("0.00"), "pass")


def test_no_buybacks_pass_and_no_prices_is_na():
    core = F.CoreData("X", years=years({}, {}))
    assert F.buybacks_result(core, []).status == "pass"
    assert F.buybacks_result(F.CoreData("X", years=years({"buybacks": D(1)})), None).status == "na"


def test_peer_stats_mean_median_and_count_skip_missing_values():
    scored = {
        "A": [F.Result("pe", D(10), "pass")],
        "B": [F.Result("pe", D(20), "fail")],
        "C": [F.Result("pe", D(90), "fail")],
        "D": [F.Result("pe", None, "na")],
    }
    stats = {s.key: s for s in F.peer_stats(scored)}
    assert (stats["pe"].mean, stats["pe"].median, stats["pe"].n) == (D("40.00"), D("20.00"), 3)
    assert stats["pe"].symbols == ["A", "B", "C"]
    assert (stats["pb"].mean, stats["pb"].n) == (None, 0)


def test_insider_evidence_keeps_open_market_trades_of_the_last_year():
    t = lambda code, change, price, when: InsiderTrade("N", change, price, code, when, None)
    trades = [
        t("S", -100, D(10), date(2026, 9, 1)),
        t("P", 50, D(8), date(2026, 3, 1)),
        t("A", 1000, None, date(2026, 9, 1)),  # grant: not open market
        t("P", 5, D(1), date(2025, 1, 1)),  # older than a year
    ]
    recent = F.recent_open_market(trades, date(2026, 10, 8))
    assert [x.code for x in recent] == ["S", "P"]
    assert F.net_insider_value(recent) == D("-600.00")


def test_without_an_eps_series_the_10k_eps_is_used_and_flagged():
    jpm = real_core("JPM", industry="Banks - Diversified")
    assert jpm.eps_as_reported
    assert jpm.eps[0][0] == 2025
    r = F.eps_growth_result(jpm)
    assert r.status in {"pass", "fail"} and r.value is not None
    assert "not adjusted for stock splits" in r.note


def test_jnj_keeps_the_split_adjusted_series(jnj):
    assert not jnj.eps_as_reported
