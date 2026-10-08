"""News cache (30 min), as_of, and the rate-limited POST /news/refresh."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.api import symbols
from app.cache import company_cache
from app.main import app
from app.providers import ProviderError
from app.providers.base import NewsItem
from app.ratelimit import SlidingWindowLimiter
from tests.conftest import clear_forced_change, login
from tests.test_symbols_api import FakeCompany, use

BOB = {"username": "bob", "password": "bob-password-1234"}
EPOCH = 1_790_000_000.0  # wall clock = EPOCH + fake seconds


class Clock:
    t = 0.0

    def __call__(self):
        return self.t


@pytest.fixture
def clock(monkeypatch):
    c = Clock()
    for obj in (company_cache, symbols._refresh_per_symbol, symbols._refresh_per_user):
        monkeypatch.setattr(obj, "_clock", c)
    monkeypatch.setattr("app.cache.time.time", lambda: EPOCH + c.t)
    symbols.reset_news_refresh_limits()
    yield c
    symbols.reset_news_refresh_limits()


def item(i):
    return NewsItem(
        f"h{i}", "s", "Reuters", f"https://x.test/{i}", datetime(2026, 10, 1 + i, tzinfo=UTC)
    )


def headlines(r):
    return [n["headline"] for n in r.json()["items"]]


def as_of(r):
    return datetime.fromisoformat(r.json()["as_of"]).timestamp()


def refresh(client, symbol="NVDA"):
    return client.post(f"/api/symbols/{symbol}/news/refresh")


# ---- cache TTL and as_of ----


def test_news_is_cached_for_30_minutes_and_reports_when_it_was_fetched(alice, clock):
    _, company, _ = use(company=FakeCompany(news=[item(1)]))
    first = alice.get("/api/symbols/NVDA/news")
    assert as_of(first) == EPOCH and first.json()["stale"] is False

    clock.t = 29 * 60 + 59
    assert as_of(alice.get("/api/symbols/NVDA/news")) == EPOCH
    assert len(company.calls) == 1

    clock.t = 30 * 60
    second = alice.get("/api/symbols/NVDA/news")
    assert len(company.calls) == 2 and as_of(second) == EPOCH + 1800


# ---- refresh ----


def test_refresh_bypasses_a_fresh_cache_and_the_next_get_serves_the_new_items(alice, clock):
    _, company, _ = use(company=FakeCompany(news=[item(1)]))
    alice.get("/api/symbols/NVDA/news")
    company.news_items = [item(2), item(1)]
    clock.t = 120  # well inside the 30-minute TTL, past the one-minute floor

    r = refresh(alice)
    assert r.status_code == 200 and headlines(r) == ["h2", "h1"]
    assert as_of(r) == EPOCH + 120 and r.json()["stale"] is False
    assert headlines(alice.get("/api/symbols/NVDA/news")) == ["h2", "h1"]
    assert len(company.calls) == 2


def test_refresh_of_news_younger_than_a_minute_makes_no_upstream_call(alice, clock):
    _, company, _ = use(company=FakeCompany(news=[item(1)]))
    alice.get("/api/symbols/NVDA/news")
    clock.t = 59
    r = refresh(alice)
    assert r.status_code == 200 and as_of(r) == EPOCH
    assert len(company.calls) == 1
    # and it did not use up the user's refresh slot
    clock.t = 60
    assert refresh(alice).status_code == 200 and len(company.calls) == 2


def test_second_refresh_by_the_same_user_is_429_with_retry_after_and_no_upstream_call(alice, clock):
    _, company, _ = use(company=FakeCompany(news=[item(1)]))
    assert refresh(alice).status_code == 200  # cold cache: this one fetches
    clock.t = 70
    assert refresh(alice).status_code == 200  # cache is older than a minute: fetches again
    n = len(company.calls)
    clock.t = 80
    r = refresh(alice)
    assert r.status_code == 429
    assert r.headers["Retry-After"] == "50"  # slot taken at t=70, free at t=130
    assert "50 s" in r.json()["detail"]
    assert len(company.calls) == n


@pytest.fixture
def bob(admin):
    assert admin.post("/api/users", json=BOB).status_code == 201
    clear_forced_change(BOB)
    return login(admin, BOB)


def test_cooldown_is_per_user_and_symbol_but_the_age_floor_is_shared(alice, bob, clock):
    _, company, _ = use(company=FakeCompany(news=[item(1)]))
    assert refresh(alice).status_code == 200  # NVDA fetched at t=0
    assert refresh(alice, "MSFT").status_code == 200  # other symbol: not blocked
    assert len(company.calls) == 2

    clock.t = 30  # bob is not cooling down, but NVDA is only 30 s old: served, no call
    r = refresh(bob)
    assert r.status_code == 200 and as_of(r) == EPOCH and len(company.calls) == 2

    clock.t = 90  # old enough: bob's refresh fetches ...
    assert refresh(bob).status_code == 200 and len(company.calls) == 3
    # ... and alice, whose cooldown has ended, is coalesced onto bob's fresh fetch
    r = refresh(alice)
    assert r.status_code == 200 and as_of(r) == EPOCH + 90 and len(company.calls) == 3


def test_one_user_cannot_refresh_more_than_ten_symbols_a_minute(alice, clock):
    _, company, _ = use(company=FakeCompany(news=[item(1)]))
    for i in range(10):
        assert refresh(alice, f"S{i}").status_code == 200
    r = refresh(alice, "S10")
    assert r.status_code == 429 and int(r.headers["Retry-After"]) == 60
    assert len(company.calls) == 10
    clock.t = 60
    assert refresh(alice, "S10").status_code == 200


# ---- failure behaviour ----


def test_failed_refresh_keeps_serving_the_old_items_flagged_stale(alice, clock):
    _, company, _ = use(company=FakeCompany(news=[item(1)]))
    alice.get("/api/symbols/NVDA/news")
    company.error = ProviderError("Finnhub rate limit reached")
    clock.t = 120
    r = refresh(alice)
    assert r.status_code == 200 and headlines(r) == ["h1"]
    assert r.json()["stale"] is True and as_of(r) == EPOCH  # the label keeps counting from t=0
    # the failed attempt used the slot, because the upstream call was spent
    clock.t = 121
    assert refresh(alice).status_code == 429


def test_failed_refresh_with_nothing_cached_is_502(alice, clock):
    use(company=FakeCompany(error=ProviderError("Finnhub rate limit reached")))
    r = refresh(alice)
    assert r.status_code == 502 and "rate limit" in r.json()["detail"]


def test_refresh_without_a_key_is_503_without_a_session_401_and_bad_symbol_422(alice, clock):
    use(company=None)
    assert refresh(alice).status_code == 503
    use(company=FakeCompany(news=[item(1)]))
    assert refresh(alice, "bad%20symbol").status_code == 422
    assert refresh(TestClient(app)).status_code == 401


# ---- limiter ----


def test_limiter_window_expiry_pruning_and_size_cap():
    c = Clock()
    lim = SlidingWindowLimiter(limit=2, window=10, max_keys=3, clock=c)
    assert lim.retry_after("a") == 0
    lim.hit("a")
    lim.hit("a")
    assert lim.retry_after("a") == 10
    c.t = 4
    assert lim.retry_after("a") == 6
    c.t = 10
    assert lim.retry_after("a") == 0  # both hits (t=0) have expired

    c.t = 100
    for k in "bcde":  # a is long expired; the cap is 3 keys
        lim.hit(k)
    assert len(lim._hits) <= 3
    assert lim.retry_after("zzz") == 0 and "zzz" not in lim._hits  # checking never allocates
