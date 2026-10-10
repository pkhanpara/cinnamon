"""SEC EDGAR: ticker -> CIK map and XBRL company facts (ADR 0017).

Free and keyless, but SEC requires a User-Agent naming the requester with a contact address and
blocks clients above 10 requests/second. Like the other providers this never touches the database;
the caller caches company facts.
"""

import json
import re
import threading
import time
from collections.abc import Callable
from datetime import date
from decimal import Decimal

import httpx

from app.cache import TTLCache
from app.providers.base import CompanyFacts, Fact, ProviderError

TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"

# SEC allows 10 requests/second; stay below it. One instance per process, so this is process-wide.
MIN_INTERVAL = 1 / 8
# A request waits this long at most for its slot; beyond that it fails fast rather than hanging a page.
MAX_WAIT = 10.0
TICKERS_TTL = 24 * 3600
# Decoded body cap. Big filers' companyfacts run to several MB; this only guards against runaway bodies.
MAX_BYTES = 50 * 1024 * 1024

_UNITS = ("USD", "USD/shares", "shares")
_ANNUAL_FORMS = ("10-K", "10-K/A")
# SEC writes class shares with a dash (BRK-B); cinnamon uses a dot (BRK.B), normalized before this.
_TICKER = re.compile(r"^[A-Z0-9]{1,5}(-[A-Z])?$")
_USER_AGENT = re.compile(r"^[\x20-\x7e]{1,200}$")


def valid_user_agent(value: str) -> bool:
    """SEC wants 'Company or name contact@email': printable ASCII with an address in it."""
    value = value.strip()
    return bool(_USER_AGENT.match(value)) and "@" in value


def _text(value: object, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    return " ".join(value.split())[:limit] or None


def _num(value: object) -> Decimal | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    d = Decimal(str(value))
    return d if d.is_finite() else None


def _date(value: object) -> date | None:
    if not isinstance(value, str) or len(value) != 10:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _normalize(symbol: str) -> str | None:
    ticker = symbol.strip().upper().replace(".", "-")
    return ticker if _TICKER.match(ticker) else None


class EdgarProvider:
    def __init__(
        self,
        user_agent: str,
        transport: httpx.BaseTransport | None = None,  # tests inject a MockTransport
        min_interval: float = MIN_INTERVAL,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        tickers_ttl: float = TICKERS_TTL,
        max_bytes: int = MAX_BYTES,
    ) -> None:
        self._client = httpx.Client(
            timeout=15.0,
            headers={"User-Agent": user_agent.strip(), "Accept-Encoding": "gzip, deflate"},
            transport=transport or httpx.HTTPTransport(retries=2),  # retries connect failures only
        )
        self._min_interval = min_interval
        self._clock = clock
        self._sleep = sleep
        self._next_at = 0.0
        self._throttle_lock = threading.Lock()
        self._tickers = TTLCache(max_entries=1, clock=clock)
        self._tickers_ttl = tickers_ttl
        self._max_bytes = max_bytes

    def _throttle(self) -> None:
        """Reserve the next free slot (at least `min_interval` after the previous one) and wait for it."""
        with self._throttle_lock:
            now = self._clock()
            slot = max(now, self._next_at)
            wait = slot - now
            if wait > MAX_WAIT:
                raise ProviderError("SEC request budget is used up for now")
            self._next_at = slot + self._min_interval
        if wait > 0:
            self._sleep(wait)

    def _get_json(self, url: str) -> object | None:
        """Parsed JSON, or None on 404."""
        self._throttle()
        try:
            with self._client.stream("GET", url) as resp:
                if resp.status_code == 404:
                    return None
                if resp.status_code == 403:
                    raise ProviderError("SEC refused the request (check SEC_USER_AGENT)")
                if resp.status_code == 429:
                    raise ProviderError("SEC rate limit reached")
                if resp.status_code != 200:
                    raise ProviderError(f"SEC returned HTTP {resp.status_code}")
                body = bytearray()
                for chunk in resp.iter_bytes():
                    body += chunk
                    if len(body) > self._max_bytes:
                        raise ProviderError("SEC response is too large")
        except httpx.HTTPError as e:
            raise ProviderError(f"SEC request failed: {type(e).__name__}") from e
        try:
            return json.loads(body)
        except ValueError:
            raise ProviderError("SEC returned an unreadable response") from None

    def _load_tickers(self) -> dict[str, int]:
        data = self._get_json(TICKERS_URL)
        tickers: dict[str, int] = {}
        if isinstance(data, dict):
            for row in data.values():
                if not isinstance(row, dict):
                    continue
                cik, ticker = row.get("cik_str"), row.get("ticker")
                if isinstance(cik, bool) or not isinstance(cik, int) or cik <= 0:
                    continue
                if not isinstance(ticker, str) or not _TICKER.match(ticker.upper()):
                    continue
                tickers.setdefault(ticker.upper(), cik)  # first (largest filer) wins
        if not tickers:
            raise ProviderError("SEC ticker map is empty or unreadable")  # never cache a broken map
        return tickers

    def cik_for(self, symbol: str) -> int | None:
        ticker = _normalize(symbol)
        if ticker is None:
            return None
        tickers = self._tickers.get_or_set("tickers", self._tickers_ttl, self._load_tickers).value
        return tickers.get(ticker)

    def get_company_facts(self, symbol: str) -> CompanyFacts | None:
        cik = self.cik_for(symbol)
        if cik is None:
            return None
        data = self._get_json(FACTS_URL.format(cik=cik))
        if data is None:
            return None
        if not isinstance(data, dict):
            raise ProviderError("SEC returned an unreadable response")
        raw_facts = data.get("facts")
        gaap = raw_facts.get("us-gaap") if isinstance(raw_facts, dict) else None
        facts: dict[str, dict[str, list[Fact]]] = {}
        if isinstance(gaap, dict):
            for concept, body in gaap.items():
                units = body.get("units") if isinstance(body, dict) else None
                if not isinstance(concept, str) or not isinstance(units, dict):
                    continue
                by_unit = {
                    unit: parsed
                    for unit in _UNITS
                    if isinstance(units.get(unit), list) and (parsed := _annual(units[unit]))
                }
                if by_unit:
                    facts[concept] = by_unit
        return CompanyFacts(cik=cik, name=_text(data.get("entityName"), 200), facts=facts)


def _annual(rows: list) -> list[Fact]:
    """Fiscal-year facts from 10-K and 10-K/A filings, newest period end first, then newest filing."""
    facts: list[Fact] = []
    for r in rows:
        if not isinstance(r, dict) or r.get("form") not in _ANNUAL_FORMS or r.get("fp") != "FY":
            continue
        end, filed, value, fy = (
            _date(r.get("end")),
            _date(r.get("filed")),
            _num(r.get("val")),
            r.get("fy"),
        )
        if end is None or filed is None or value is None:
            continue
        if isinstance(fy, bool) or not isinstance(fy, int):
            continue
        facts.append(
            Fact(
                end=end,
                start=_date(r.get("start")),
                value=value,
                fy=fy,
                fp="FY",
                form=r["form"],
                filed=filed,
                frame=_text(r.get("frame"), 20),
            )
        )
    facts.sort(key=lambda f: (f.end, f.filed), reverse=True)
    return facts
