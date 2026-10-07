from datetime import UTC, datetime
from decimal import Decimal

import httpx
import pytest

from app.providers import ProviderError
from app.providers.finnhub import FinnhubProvider


def provider(handler, key="SECRET-KEY"):
    # Goes through the real constructor, so auth wiring is what production uses.
    return FinnhubProvider(
        key, "https://finnhub.test/api/v1", transport=httpx.MockTransport(handler)
    )


def ok(symbol_data):
    return lambda req: httpx.Response(200, json=symbol_data[req.url.params["symbol"]])


GOOD = {"c": 505.54, "d": 1.28, "dp": 0.25, "h": 1, "l": 1, "o": 1, "pc": 504.26, "t": 1791316800}


def test_parses_quote_with_exact_decimals_and_time():
    q = provider(ok({"BRK.B": GOOD})).get_quotes(["BRK.B"])["BRK.B"]
    assert q.price == Decimal("505.54") and q.prev_close == Decimal("504.26")
    assert q.quote_time == datetime.fromtimestamp(1791316800, UTC)


def test_key_goes_in_a_header_never_in_the_url():
    seen = []

    def handler(req):
        seen.append(req)
        return httpx.Response(200, json=GOOD)

    provider(handler).get_quotes(["KO"])
    assert seen[0].headers["X-Finnhub-Token"] == "SECRET-KEY"
    assert "SECRET-KEY" not in str(seen[0].url) and "token" not in str(seen[0].url).lower()


def test_unknown_symbol_returns_all_zeros_and_is_dropped():
    zero = {"c": 0, "d": None, "dp": None, "h": 0, "l": 0, "o": 0, "pc": 0, "t": 0}
    quotes = provider(ok({"NOPE": zero, "KO": GOOD})).get_quotes(["NOPE", "KO"])
    assert list(quotes) == ["KO"]


def test_missing_prev_close_and_time_are_tolerated():
    q = provider(ok({"KO": {"c": 10, "pc": 0, "t": 0}})).get_quotes(["KO"])["KO"]
    assert q.prev_close is None and q.quote_time is None


def test_partial_failure_returns_the_good_quotes():
    def handler(req):
        if req.url.params["symbol"] == "BAD":
            return httpx.Response(429)
        return httpx.Response(200, json=GOOD)

    assert list(provider(handler).get_quotes(["KO", "BAD"])) == ["KO"]


@pytest.mark.parametrize(
    ("response", "fragment"),
    [
        (httpx.Response(429), "rate limit"),
        (httpx.Response(401, json={"error": "x"}), "rejected the API key"),
        (httpx.Response(403), "rejected the API key"),
        (httpx.Response(500), "HTTP 500"),
        (httpx.Response(200, text="not json"), "unreadable"),
        (httpx.Response(200, json={"nope": 1}), "unreadable"),
        (httpx.Response(200, json={"c": "abc"}), "unreadable"),
    ],
)
def test_total_failure_raises_provider_error(response, fragment):
    with pytest.raises(ProviderError, match=fragment):
        provider(lambda req: response).get_quotes(["KO"])


def test_network_error_raises_provider_error_without_leaking_details():
    def boom(req):
        raise httpx.ConnectError("connection refused to secret.internal:443")

    with pytest.raises(ProviderError) as e:
        provider(boom).get_quotes(["KO"])
    assert "secret.internal" not in str(e.value)


def test_empty_symbol_list_makes_no_calls():
    def handler(req):
        raise AssertionError("no call expected")

    assert provider(handler).get_quotes([]) == {}
