import json
from datetime import date
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from app.providers import ProviderError
from app.providers.finnhub import MAX_BUDGET_WAIT, FinnhubProvider

FIXTURES = Path(__file__).parent / "fixtures" / "fundamentals"


def provider(handler, **kw):
    return FinnhubProvider(
        "K", "https://finnhub.test/api/v1", transport=httpx.MockTransport(handler), **kw
    )


def respond(payload, status=200):
    return provider(lambda req: httpx.Response(status, json=payload))


def fixture(name):
    return json.loads((FIXTURES / name).read_text())


def test_basic_financials_from_real_jnj_data():
    fin = respond(fixture("JNJ-metric.json")).get_basic_financials("JNJ")
    assert fin.metric["peTTM"] == Decimal("29.0134")
    assert fin.metric["marketCapitalization"] == Decimal(610355)
    eps = fin.annual["eps"]
    assert len(eps) == 41
    assert eps[0].period == date(2025, 12, 28)  # newest first
    assert eps[0].value == Decimal("11.0332")


def test_basic_financials_drop_non_numbers_and_bad_points():
    fin = respond(
        {
            "metric": {"peTTM": "n/a", "pb": True, "pbAnnual": 1.2},
            "series": {
                "annual": {
                    "eps": [
                        {"period": "2024-12-31", "v": 2},
                        {"period": "garbage", "v": 1},
                        {"period": "2025-12-31", "v": None},
                        {"period": "2023-12-31", "v": 1.5},
                    ],
                    "pe": "nope",
                }
            },
        }
    ).get_basic_financials("X")
    assert fin.metric == {"pbAnnual": Decimal("1.2")}
    assert [(p.period.year, p.value) for p in fin.annual["eps"]] == [
        (2024, Decimal(2)),
        (2023, Decimal("1.5")),
    ]
    assert "pe" not in fin.annual


@pytest.mark.parametrize("payload", [{}, [], "x", {"metric": {}, "series": {}}])
def test_basic_financials_none_when_empty(payload):
    assert respond(payload).get_basic_financials("X") is None


def test_reported_annual_from_real_jnj_data():
    reports = respond(fixture("JNJ-reported.json")).get_reported_annual("JNJ")
    assert [r.year for r in reports][:3] == [2025, 2024, 2023]
    latest = reports[0]
    assert latest.end_date == date(2025, 12, 28)
    assert latest.values["NetIncomeLoss"] == Decimal("26804000000.0")
    assert latest.values["PaymentsToAcquirePropertyPlantAndEquipment"] == Decimal(4832000000)


def test_reported_concepts_lose_their_prefix_and_extensions_are_dropped():
    item = lambda c, v: {"concept": c, "value": v}
    payload = {
        "data": [
            {
                "year": 2025,
                "form": "10-K",
                "endDate": "2025-12-31 00:00:00",
                "report": {
                    "ic": [
                        item("us-gaap_Revenues", 10),
                        item("NetIncomeLoss", 3),
                        item("acme_Revenues", 999),  # company extension: must not shadow
                        item("us-gaap:ResearchAndDevelopmentExpense", 1),
                        item("us-gaap_Bad", "x"),
                    ],
                    "cf": "not a list",
                },
            }
        ]
    }
    (r,) = respond(payload).get_reported_annual("X")
    assert r.values == {
        "Revenues": Decimal(10),
        "NetIncomeLoss": Decimal(3),
        "ResearchAndDevelopmentExpense": Decimal(1),
    }


def test_the_original_10k_wins_over_an_amendment_in_either_order():
    def filing(form, ni):
        return {
            "year": 2024,
            "form": form,
            "report": {"ic": [{"concept": "NetIncomeLoss", "value": ni}]},
        }

    for data in (
        [filing("10-K/A", 1), filing("10-K", 2)],
        [filing("10-K", 2), filing("10-K/A", 1)],
    ):
        (r,) = respond({"data": data}).get_reported_annual("X")
        assert r.values["NetIncomeLoss"] == 2


def test_reported_annual_is_empty_for_a_fund():
    assert respond({"cik": "", "data": [], "symbol": "VOO"}).get_reported_annual("VOO") == []


def test_peers_exclude_the_symbol_itself_duplicates_and_odd_tickers():
    payload = ["LLY", "JNJ", "MRK", "LLY", "NVDA.MX", "BRK.B", 7, ""]
    assert respond(payload).get_peers("JNJ") == ["LLY", "MRK", "BRK.B"]


def test_insider_transactions():
    payload = {
        "data": [
            {
                "name": "Woods Eugene A.",
                "change": -100,
                "transactionDate": "2026-09-08",
                "filingDate": "2026-09-10",
                "transactionCode": "S",
                "transactionPrice": 276.31,
            },
            {"name": "No Date", "change": 1, "transactionCode": "P"},
            {
                "name": "Bad change",
                "change": "1",
                "transactionCode": "P",
                "transactionDate": "2026-01-01",
            },
            {
                "name": "Grant",
                "change": 50,
                "transactionDate": "2026-09-09",
                "transactionCode": "A",
                "transactionPrice": 0,
            },
        ]
    }
    trades = respond(payload).get_insider_transactions("JNJ")
    assert [(t.name, t.code, t.shares_change, t.price) for t in trades] == [
        ("Grant", "A", 50, None),  # newest first; a zero price means "no price"
        ("Woods Eugene A.", "S", -100, Decimal("276.31")),
    ]


def test_budget_waits_for_the_oldest_call_to_leave_the_window():
    clock = [0.0]
    slept = []

    def fake_sleep(s):
        slept.append(s)
        clock[0] += s

    p = provider(lambda req: httpx.Response(200, json=[]), calls_per_minute=2, sleep=fake_sleep)
    p._budget._clock = lambda: clock[0]
    p.get_peers("X")
    p.get_peers("X")
    clock[0] = 45.0
    p.get_peers("X")  # the window frees up at t=60: a 15 s wait is within MAX_BUDGET_WAIT
    assert slept == [15]


def test_budget_fails_fast_instead_of_hanging_a_request():
    p = provider(lambda req: httpx.Response(200, json=[]), calls_per_minute=1, sleep=lambda s: None)
    p.get_peers("X")
    with pytest.raises(ProviderError, match="budget"):
        p.get_peers("X")
    assert MAX_BUDGET_WAIT < 60


def test_budget_applies_to_quotes_too():
    p = provider(
        lambda req: httpx.Response(200, json={"c": 1, "pc": 1, "t": 1}),
        calls_per_minute=1,
        sleep=lambda s: None,
    )
    assert set(p.get_quotes(["A"])) == {"A"}
    with pytest.raises(ProviderError, match="budget"):
        p.get_quotes(["B"])
