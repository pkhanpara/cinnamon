"""YFinanceHistory with a fake `yfinance` module: no network, but real pandas frames."""

import sys
import types
from datetime import date
from decimal import Decimal

import pandas as pd
import pytest

from app.providers import ProviderError
from app.providers.base import HistoryRange
from app.providers.yfinance_history import YFinanceHistory

NY = "America/New_York"


def frame(rows, tz=NY):
    """rows: (timestamp string, open, high, low, close, volume)"""
    idx = pd.DatetimeIndex([pd.Timestamp(r[0], tz=tz) for r in rows])
    return pd.DataFrame(
        {
            "Open": [r[1] for r in rows],
            "High": [r[2] for r in rows],
            "Low": [r[3] for r in rows],
            "Close": [r[4] for r in rows],
            "Volume": [r[5] for r in rows],
        },
        index=idx,
    )


@pytest.fixture
def fake_yf(monkeypatch):
    calls = []
    state = {"df": pd.DataFrame(), "error": None}

    class Ticker:
        def __init__(self, symbol):
            calls.append({"symbol": symbol})

        def history(self, **kw):
            calls[-1].update(kw)
            if state["error"]:
                raise state["error"]
            return state["df"]

    monkeypatch.setitem(sys.modules, "yfinance", types.SimpleNamespace(Ticker=Ticker))
    return calls, state


def test_daily_bars_are_mapped_with_exact_decimals_and_exchange_dates(fake_yf):
    calls, state = fake_yf
    state["df"] = frame(
        [
            ("2026-10-05", 238.5, 240.1, 237.0, 239.2412, 1000),
            ("2026-10-06", 239.0, 241.0, 238.0, 239.24, 2000),
        ]
    )
    bars = YFinanceHistory().get_history("NVDA", HistoryRange.M1)
    assert [b.session_date for b in bars] == [date(2026, 10, 5), date(2026, 10, 6)]
    assert bars[0].close == Decimal("239.2412") and bars[1].volume == 2000
    assert (
        bars[0].time.utcoffset().total_seconds() == 0 and bars[0].time.hour == 4
    )  # midnight EDT = 04:00 UTC
    assert (calls[0]["period"], calls[0]["interval"], calls[0]["auto_adjust"]) == (
        "1mo",
        "1d",
        False,
    )


@pytest.mark.parametrize(
    ("rng", "period", "interval"),
    [
        (HistoryRange.D1, "5d", "5m"),
        (HistoryRange.D5, "5d", "15m"),
        (HistoryRange.M6, "6mo", "1d"),
        (HistoryRange.YTD, "ytd", "1d"),
        (HistoryRange.Y1, "1y", "1d"),
        (HistoryRange.ALL, "max", "1wk"),
    ],
)
def test_each_range_asks_yahoo_for_the_right_period_and_interval(fake_yf, rng, period, interval):
    calls, _ = fake_yf
    YFinanceHistory().get_history("VOO", rng)
    assert (calls[0]["period"], calls[0]["interval"]) == (period, interval)


def test_class_share_dots_become_dashes_for_yahoo(fake_yf):
    calls, _ = fake_yf
    YFinanceHistory().get_history("BRK.B", HistoryRange.M1)
    assert calls[0]["symbol"] == "BRK-B"


def test_one_day_keeps_only_the_last_session(fake_yf):
    _, state = fake_yf
    state["df"] = frame(
        [
            ("2026-10-05 15:55", 1, 1, 1, 10, 1),
            ("2026-10-06 09:30", 1, 1, 1, 11, 1),
            ("2026-10-06 15:55", 1, 1, 1, 12, 1),
        ]
    )
    bars = YFinanceHistory().get_history("NVDA", HistoryRange.D1)
    assert [b.close for b in bars] == [Decimal(11), Decimal(12)]
    assert {b.session_date for b in bars} == {date(2026, 10, 6)}


def test_five_days_keeps_everything(fake_yf):
    _, state = fake_yf
    state["df"] = frame(
        [("2026-10-05 15:55", 1, 1, 1, 10, 1), ("2026-10-06 15:55", 1, 1, 1, 12, 1)]
    )
    assert len(YFinanceHistory().get_history("NVDA", HistoryRange.D5)) == 2


def test_rows_without_a_close_are_dropped_and_missing_volume_is_zero(fake_yf):
    _, state = fake_yf
    state["df"] = frame(
        [("2026-10-05", 1, 1, 1, float("nan"), 5), ("2026-10-06", 1, 1, 1, 9.5, float("nan"))]
    )
    bars = YFinanceHistory().get_history("X", HistoryRange.M1)
    assert len(bars) == 1 and bars[0].close == Decimal("9.5") and bars[0].volume == 0


def test_unknown_symbol_is_an_empty_list_not_an_error(fake_yf):
    assert YFinanceHistory().get_history("ZZZZ", HistoryRange.M1) == []


def test_any_yfinance_failure_becomes_a_provider_error(fake_yf):
    _, state = fake_yf
    state["error"] = RuntimeError("HTTP 429 from secret.internal")
    with pytest.raises(ProviderError) as e:
        YFinanceHistory().get_history("NVDA", HistoryRange.M1)
    assert "RuntimeError" in str(e.value) and "secret.internal" not in str(e.value)
