from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import QuoteCache
from app.providers import ProviderError, Quote
from app.quotes import get_quotes


class Fake:
    def __init__(self, prices=None, error=None):
        self.prices, self.error, self.calls = prices or {}, error, []

    def get_quotes(self, symbols):
        self.calls.append(list(symbols))
        if self.error:
            raise self.error
        return {
            s: Quote(s, Decimal(p), Decimal(p) - 1, None)
            for s, p in self.prices.items()
            if s in symbols
        }


def session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def age(db, symbol, seconds):
    row = db.get(QuoteCache, symbol)
    row.fetched_at = datetime.now(UTC) - timedelta(seconds=seconds)
    db.commit()


def test_second_call_within_ttl_is_served_from_cache():
    db, p, w = session(), Fake({"KO": "70.5"}), []
    assert get_quotes(db, ["KO"], p, 60, w)["KO"].price == Decimal("70.5")
    assert get_quotes(db, ["KO"], p, 60, w)["KO"].price == Decimal("70.5")
    assert len(p.calls) == 1 and w == []


def test_expired_rows_are_refetched_and_only_the_missing_ones():
    db, p, w = session(), Fake({"KO": "70", "PM": "100"}), []
    get_quotes(db, ["KO", "PM"], p, 60, w)
    age(db, "KO", 120)
    p.prices["KO"] = "71"
    out = get_quotes(db, ["KO", "PM"], p, 60, w)
    assert p.calls[-1] == ["KO"] and out["KO"].price == Decimal(71)
    assert db.scalar(select(QuoteCache.price).where(QuoteCache.symbol == "KO")) == Decimal(71)


def test_provider_failure_serves_expired_rows_flagged_stale_with_warning():
    db, w = session(), []
    get_quotes(db, ["KO"], Fake({"KO": "70"}), 60, w)
    age(db, "KO", 3600)
    out = get_quotes(db, ["KO"], Fake(error=ProviderError("Finnhub rate limit reached")), 60, w)
    assert out["KO"].stale is True and out["KO"].price == Decimal(70)
    assert "rate limit" in w[0] and "last known or imported" in w[0]


def test_provider_failure_with_empty_cache_returns_nothing():
    out = get_quotes(session(), ["KO"], Fake(error=ProviderError("down")), 60, w := [])
    assert out == {} and len(w) == 1


def test_no_provider_warns_and_serves_whatever_is_cached():
    db, w = session(), []
    get_quotes(db, ["KO"], Fake({"KO": "70"}), 60, [])
    age(db, "KO", 3600)
    out = get_quotes(db, ["KO", "PM"], None, 60, w)
    assert out["KO"].stale is True and "PM" not in out
    assert "FINNHUB_API_KEY is not set" in w[0]


def test_unknown_symbol_is_absent_and_not_cached():
    db = session()
    out = get_quotes(db, ["KO", "ZZZ"], Fake({"KO": "70"}), 60, [])
    assert list(out) == ["KO"] and db.get(QuoteCache, "ZZZ") is None
