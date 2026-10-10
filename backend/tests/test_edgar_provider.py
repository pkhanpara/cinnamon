import json
import threading
from datetime import date
from decimal import Decimal
from itertools import pairwise
from pathlib import Path

import httpx
import pytest

from app.config import get_settings
from app.providers import ProviderError, _edgar, get_edgar_provider
from app.providers.edgar import FACTS_URL, TICKERS_URL, EdgarProvider

FIXTURES = Path(__file__).parent / "fixtures" / "edgar"
UA = "Cinnamon tests test@example.com"


def fixture(name):
    return json.loads((FIXTURES / name).read_text())


class FakeClock:
    def __init__(self, now=1000.0):
        self.now = now
        self.sleeps = []

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


def sec(routes, requests=None, **kw):
    """Provider over a fake SEC: `routes` maps URL -> payload, Response, or callable(request)."""

    def handler(request):
        if requests is not None:
            requests.append(request)
        route = routes.get(str(request.url), httpx.Response(404))
        if callable(route):
            route = route(request)
        return route if isinstance(route, httpx.Response) else httpx.Response(200, json=route)

    clock = kw.pop("clock", None) or FakeClock()
    return EdgarProvider(
        UA, transport=httpx.MockTransport(handler), clock=clock, sleep=clock.sleep, **kw
    )


def standard(requests=None, **kw):
    return sec(
        {
            TICKERS_URL: fixture("company_tickers.json"),
            FACTS_URL.format(cik=1234567): fixture("companyfacts-small.json"),
        },
        requests,
        **kw,
    )


# --- ticker -> CIK ---


def test_cik_from_fixture_map():
    p = standard()
    assert p.cik_for("EXMP") == 1234567
    assert p.cik_for("LOW") == 7  # lower-case ticker in SEC's file is normalized too


def test_cik_class_share_and_case_normalized():
    p = standard()
    assert p.cik_for("BRK.B") == 1067983
    assert p.cik_for(" brk.a ") == 1067983
    assert p.cik_for("exmp") == 1234567


@pytest.mark.parametrize("symbol", ["", "   ", "../x", "A B", "TOOLONG1", "BRK.BB", "X?y=1", "Ä"])
def test_cik_invalid_symbols_make_no_request(symbol):
    requests = []
    p = standard(requests)
    assert p.cik_for(symbol) is None
    assert p.get_company_facts(symbol) is None
    assert requests == []


def test_cik_unknown_returns_none():
    p = standard()
    assert p.cik_for("SPYX") is None
    assert p.get_company_facts("SPYX") is None


def test_malformed_ticker_rows_skipped_and_duplicate_ticker_first_wins():
    p = standard()
    assert p.cik_for("DUP") == 111
    for symbol in ("STRCIK", "BOOL", "ZERO"):
        assert p.cik_for(symbol) is None


def test_ticker_map_cached_until_ttl():
    requests, clock = [], FakeClock()
    p = standard(requests, clock=clock, tickers_ttl=100)
    p.cik_for("EXMP")
    p.cik_for("DUP")
    assert len(requests) == 1
    clock.now += 101
    p.cik_for("EXMP")
    assert len(requests) == 2


def test_ticker_map_stale_on_error():
    state = {"fail": False}
    payload = fixture("company_tickers.json")
    clock = FakeClock()
    p = sec(
        {
            TICKERS_URL: lambda r: (
                httpx.Response(500) if state["fail"] else httpx.Response(200, json=payload)
            )
        },
        clock=clock,
        tickers_ttl=100,
    )
    assert p.cik_for("EXMP") == 1234567
    state["fail"] = True
    clock.now += 101
    assert p.cik_for("EXMP") == 1234567


def test_ticker_map_error_without_cache_raises():
    p = sec({TICKERS_URL: httpx.Response(500)})
    with pytest.raises(ProviderError):
        p.cik_for("EXMP")


@pytest.mark.parametrize("payload", [{}, [], "x", {"0": {"cik_str": "1", "ticker": "A"}}])
def test_garbage_ticker_map_raises_and_is_not_cached(payload):
    state = {"payload": payload}
    p = sec({TICKERS_URL: lambda r: httpx.Response(200, json=state["payload"])})
    with pytest.raises(ProviderError, match="ticker map"):
        p.cik_for("EXMP")
    state["payload"] = fixture("company_tickers.json")
    assert p.cik_for("EXMP") == 1234567  # the broken map was not cached


def test_ticker_map_404_raises():
    with pytest.raises(ProviderError):
        sec({}).cik_for("EXMP")


# --- HTTP ---


def test_user_agent_sent_on_every_request():
    requests = []
    standard(requests).get_company_facts("EXMP")
    assert [r.url.host for r in requests] == ["www.sec.gov", "data.sec.gov"]
    assert all(r.headers["User-Agent"] == UA for r in requests)
    assert all("gzip" in r.headers["Accept-Encoding"] for r in requests)


def _raise_connect(request):
    raise httpx.ConnectError("boom")


@pytest.mark.parametrize(
    ("route", "message"),
    [
        (httpx.Response(403), "SEC_USER_AGENT"),
        (httpx.Response(429), "rate limit"),
        (httpx.Response(500), "HTTP 500"),
        (_raise_connect, "ConnectError"),
        (httpx.Response(200, content=b"<html>not json"), "unreadable"),
    ],
)
def test_http_errors_become_provider_error(route, message):
    p = sec({TICKERS_URL: route})
    with pytest.raises(ProviderError, match=message):
        p.cik_for("EXMP")


def test_oversized_body_rejected():
    p = sec({TICKERS_URL: fixture("company_tickers.json")}, max_bytes=100)
    with pytest.raises(ProviderError, match="too large"):
        p.cik_for("EXMP")


# --- company facts ---


def test_company_facts_parsed_from_fixture():
    requests = []
    cf = standard(requests).get_company_facts("EXMP")
    assert str(requests[-1].url).endswith("/CIK0001234567.json")  # zero-padded to 10 digits
    assert cf.cik == 1234567
    assert cf.name == "Example Corp"
    assert set(cf.facts) == {
        "NetIncomeLoss",
        "EarningsPerShareDiluted",
        "CommonStockSharesOutstanding",
        "Revenues",
    }
    ni = cf.facts["NetIncomeLoss"]["USD"]
    # newest period end first, then newest filing (the 10-K/A after the original 10-K)
    assert [(f.end.year, f.form, f.filed) for f in ni] == [
        (2024, "10-K/A", date(2025, 4, 1)),
        (2024, "10-K", date(2025, 2, 14)),
        (2023, "10-K", date(2025, 2, 14)),
        (2023, "10-K", date(2024, 2, 15)),
        (2022, "10-K", date(2023, 2, 15)),
    ]
    latest = ni[1]
    assert latest.value == Decimal(123456789012345678)  # large integers stay exact
    assert latest.start == date(2024, 1, 1)
    assert latest.fy == 2024 and latest.fp == "FY" and latest.frame == "CY2024"
    assert ni[0].frame is None
    assert cf.facts["EarningsPerShareDiluted"]["USD/shares"][0].value == Decimal("6.08")
    shares = cf.facts["CommonStockSharesOutstanding"]["shares"][0]
    assert shares.start is None and shares.value == Decimal(15000000000)
    assert set(cf.facts["Revenues"]) == {"USD"}  # EUR dropped


def test_company_facts_drops_bad_rows_and_non_annual():
    good = {
        "end": "2024-12-31",
        "val": 5,
        "fy": 2024,
        "fp": "FY",
        "form": "10-K",
        "filed": "2025-02-01",
    }
    bad = [
        {**good, "val": "5"},
        {**good, "val": True},
        {**good, "val": None},
        {**good, "end": "2024-13-01"},
        {**good, "end": None},
        {**good, "filed": "soon"},
        {**good, "fy": None},
        {**good, "fy": "2024"},
        {**good, "fy": True},
        {**good, "fp": "Q4"},
        {**good, "form": "10-Q"},
        {**good, "form": "20-F"},
        "not a row",
    ]
    payload = {
        "entityName": 42,
        "facts": {
            "us-gaap": {
                "Good": {"units": {"USD": [good, *bad]}},
                "AllBad": {"units": {"USD": bad}},
                "NoUnits": {"label": "x"},
                "UnitsNotDict": {"units": []},
                "UnitNotList": {"units": {"USD": {"end": "2024-12-31"}}},
                "NotDict": "x",
            }
        },
    }
    p = sec({TICKERS_URL: fixture("company_tickers.json"), FACTS_URL.format(cik=1234567): payload})
    cf = p.get_company_facts("EXMP")
    assert cf.name is None
    assert list(cf.facts) == ["Good"]
    assert [f.value for f in cf.facts["Good"]["USD"]] == [Decimal(5)]


def test_company_facts_non_finite_values_dropped():
    body = (
        b'{"facts": {"us-gaap": {"X": {"units": {"USD": ['
        b'{"end": "2024-12-31", "val": NaN, "fy": 2024, "fp": "FY", "form": "10-K", "filed": "2025-02-01"},'
        b'{"end": "2023-12-31", "val": Infinity, "fy": 2023, "fp": "FY", "form": "10-K", "filed": "2024-02-01"}'
        b"]}}}}}"
    )
    p = sec(
        {
            TICKERS_URL: fixture("company_tickers.json"),
            FACTS_URL.format(cik=1234567): httpx.Response(200, content=body),
        }
    )
    assert p.get_company_facts("EXMP").facts == {}


def test_company_facts_404_is_none():
    p = sec({TICKERS_URL: fixture("company_tickers.json")})  # facts URL not routed: 404
    assert p.get_company_facts("EXMP") is None


@pytest.mark.parametrize("payload", [{"entityName": "IFRS Filer", "facts": {"ifrs-full": {}}}, {}])
def test_company_facts_without_us_gaap(payload):
    p = sec({TICKERS_URL: fixture("company_tickers.json"), FACTS_URL.format(cik=1234567): payload})
    cf = p.get_company_facts("EXMP")
    assert cf is not None and cf.cik == 1234567 and cf.facts == {}


def test_company_facts_non_object_raises():
    p = sec({TICKERS_URL: fixture("company_tickers.json"), FACTS_URL.format(cik=1234567): []})
    with pytest.raises(ProviderError, match="unreadable"):
        p.get_company_facts("EXMP")


# --- throttle ---


def test_throttle_spaces_calls():
    clock, times = FakeClock(), []

    def timed(name):
        def respond(request):
            times.append(clock.now)
            return httpx.Response(200, json=fixture(name))

        return respond

    p = sec(
        {
            TICKERS_URL: timed("company_tickers.json"),
            FACTS_URL.format(cik=1234567): timed("companyfacts-small.json"),
        },
        clock=clock,
    )
    for _ in range(9):
        p.get_company_facts("EXMP")
    assert len(times) == 10
    gaps = [b - a for a, b in pairwise(times)]
    assert all(g >= 1 / 8 - 1e-9 for g in gaps)
    # never more than 8 requests in any one-second window
    assert all(sum(1 for t in times if s <= t < s + 1) <= 8 for s in times)


def test_throttle_gives_up_past_max_wait():
    clock = FakeClock()
    p = EdgarProvider(
        UA,
        transport=httpx.MockTransport(lambda r: httpx.Response(200)),
        min_interval=3,
        clock=clock,
        sleep=lambda s: None,
    )
    for _ in range(4):  # waits 0, 3, 6, 9: all within MAX_WAIT (10 s)
        p._throttle()
    with pytest.raises(ProviderError, match="budget"):
        p._throttle()  # would wait 12 s


def test_throttle_thread_safe():
    clock, waits = FakeClock(), []
    p = EdgarProvider(
        UA,
        transport=httpx.MockTransport(lambda r: httpx.Response(200)),
        min_interval=0.01,
        clock=clock,
        sleep=waits.append,  # clock stands still, so each wait is that caller's reserved offset
    )
    start = threading.Barrier(8)

    def worker():
        start.wait()
        for _ in range(3):
            p._throttle()

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    # 24 calls: the first goes immediately, the other 23 each got their own 10 ms slot
    assert sorted(waits) == pytest.approx([i * 0.01 for i in range(1, 24)])


# --- factory ---


@pytest.fixture
def sec_setting(monkeypatch):
    def set_ua(value):
        monkeypatch.setenv("SEC_USER_AGENT", value)
        get_settings.cache_clear()
        _edgar.cache_clear()

    yield set_ua
    monkeypatch.undo()
    get_settings.cache_clear()
    _edgar.cache_clear()


@pytest.mark.parametrize(
    "value",
    [
        "",
        "   ",
        "Cinnamon no-contact",
        "Cinnämon me@example.com",
        "Cinnamon\tme@example.com",
        "x@" + "y" * 200,
    ],
)
def test_factory_disabled_without_or_with_invalid_user_agent(sec_setting, value):
    sec_setting(value)
    assert get_edgar_provider() is None


def test_factory_returns_singleton(sec_setting):
    sec_setting("Cinnamon me@example.com")
    p = get_edgar_provider()
    assert isinstance(p, EdgarProvider)
    assert get_edgar_provider() is p
