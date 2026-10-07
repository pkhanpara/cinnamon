from datetime import UTC, datetime
from decimal import Decimal

import httpx
import pytest

from app.providers import ProviderError
from app.providers.finnhub import FinnhubProvider


def provider(handler):
    return FinnhubProvider(
        "K", "https://finnhub.test/api/v1", transport=httpx.MockTransport(handler)
    )


def respond(payload, status=200):
    return provider(lambda req: httpx.Response(status, json=payload))


NVDA = {
    "name": "NVIDIA Corp",
    "exchange": "NASDAQ NMS - GLOBAL MARKET",
    "finnhubIndustry": "Semiconductors",
    "country": "US",
    "currency": "USD",
    "weburl": "https://www.nvidia.com/",
    "marketCapitalization": 5765683.85,
    "logo": "https://static2.finnhub.io/x.png",
}


def test_profile_maps_fields_and_ignores_the_logo():
    p = respond(NVDA).get_profile("NVDA")
    assert (p.name, p.exchange, p.industry, p.web_url) == (
        "NVIDIA Corp",
        "NASDAQ NMS - GLOBAL MARKET",
        "Semiconductors",
        "https://www.nvidia.com/",
    )
    assert p.market_cap_millions == Decimal("5765683.85")
    assert not hasattr(p, "logo_url")


@pytest.mark.parametrize("payload", [{}, [], {"name": ""}, "nope"])
def test_empty_or_odd_profile_is_none_like_an_etf(payload):
    assert respond(payload).get_profile("VOO") is None


def test_profile_drops_a_non_http_website():
    assert respond({**NVDA, "weburl": "javascript:alert(1)"}).get_profile("X").web_url is None


def test_metrics():
    m = respond(
        {
            "metric": {
                "52WeekHigh": 240.0983,
                "52WeekLow": 164.27,
                "10DayAverageTradingVolume": 107.9,
                "3MonthAverageTradingVolume": 134.7,
            }
        }
    ).get_metrics("NVDA")
    assert (m.week52_high, m.week52_low) == (Decimal("240.0983"), Decimal("164.27"))
    assert m.avg_volume_10d_millions == Decimal("107.9")


def test_metrics_missing_values_are_none_and_empty_is_none():
    m = respond({"metric": {"52WeekHigh": "n/a", "52WeekLow": True}}).get_metrics("X")
    assert m.week52_high is None and m.week52_low is None
    assert respond({"metric": {}}).get_metrics("X") is None


def article(**kw):
    base = {
        "headline": "Chip rally",
        "summary": "Details",
        "source": "Reuters",
        "url": "https://x.test/a",
        "datetime": 1791316800,
        "image": "https://x.test/i.png",
    }
    return {**base, **kw}


def test_news_is_sorted_newest_first_and_limited():
    items = [article(headline=f"h{i}", datetime=1791316800 + i) for i in range(5)]
    news = respond(items).get_news("NVDA", 14, 3)
    assert [n.headline for n in news] == ["h4", "h3", "h2"]
    assert news[0].published_at == datetime.fromtimestamp(1791316804, UTC)


def test_news_drops_unsafe_or_malformed_items_and_cleans_text():
    items = [
        article(headline="  Spaced \n out\theadline  "),
        article(headline="evil", url="javascript:alert(1)"),
        article(headline="data", url="data:text/html,<script>"),
        article(headline="relative", url="/a"),
        article(headline="", url="https://x.test/b"),
        article(headline="no time", datetime=0),
        "not a dict",
        article(headline="x" * 1000, summary="s" * 5000, source="r" * 500),
    ]
    news = respond(items).get_news("NVDA", 14, 20)
    assert len(news) == 2
    assert {n.headline[:19] for n in news} == {"Spaced out headline", "x" * 19}
    long = next(n for n in news if n.headline.startswith("xxx"))
    assert len(long.headline) == 300 and len(long.summary) == 500 and len(long.source) == 60
    assert all(n.url.startswith("https://") for n in news)


def test_news_sends_a_date_window():
    seen = []

    def handler(req):
        seen.append(dict(req.url.params))
        return httpx.Response(200, json=[])

    provider(handler).get_news("NVDA", 14, 5)
    assert seen[0]["symbol"] == "NVDA" and seen[0]["from"] < seen[0]["to"]


def test_search_filters_foreign_listings_and_caps_results():
    results = [
        {"symbol": "NVDA", "description": "NVIDIA Corp", "type": "Common Stock"},
        {"symbol": "NVDA.MX", "description": "x", "type": ""},
        {"symbol": "BRK.B", "description": "Berkshire", "type": "Common Stock"},
        {"symbol": "0QZI.L", "description": "x", "type": ""},
        {"symbol": "bad sym", "description": "x", "type": ""},
    ]
    results += [{"symbol": f"S{i}", "description": "d", "type": "t"} for i in range(20)]
    hits = respond({"count": 25, "result": results}).search("nv")
    assert [h.symbol for h in hits][:2] == [
        "NVDA",
        "BRK.B",
    ]  # NVDA.MX, 0QZI.L and "bad sym" were dropped
    assert len(hits) == 8
    assert [h.symbol for h in hits][2:] == [f"S{i}" for i in range(6)]


def test_search_with_garbage_payload_is_empty():
    assert respond({"result": "x"}).search("q") == []
    assert respond([]).search("q") == []


@pytest.mark.parametrize(
    ("status", "fragment"),
    [(429, "rate limit"), (401, "rejected the API key"), (403, "current plan"), (500, "HTTP 500")],
)
def test_http_errors_become_provider_errors(status, fragment):
    with pytest.raises(ProviderError, match=fragment):
        respond({}, status).get_profile("X")


def test_unreadable_body_and_network_errors_are_provider_errors():
    with pytest.raises(ProviderError, match="unreadable"):
        provider(lambda req: httpx.Response(200, text="<html>")).get_metrics("X")

    def boom(req):
        raise httpx.ConnectError("refused to secret.internal")

    with pytest.raises(ProviderError) as e:
        provider(boom).search("q")
    assert "secret.internal" not in str(e.value)


def test_news_non_list_is_an_error():
    with pytest.raises(ProviderError):
        respond({"error": "x"}).get_news("X", 14, 5)
