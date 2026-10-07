import re
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation

import httpx

from app.providers.base import Metrics, NewsItem, Profile, ProviderError, Quote, SearchHit

# Authenticated with a header, not ?token=, so the key never lands in URLs, httpx logs or proxies.
_TOKEN_HEADER = "X-Finnhub-Token"

_CLASS_SHARE = re.compile(r"^[A-Z]{1,5}\.[A-Z]$")  # BRK.B yes, NVDA.MX (a foreign listing) no


def _text(value: object, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    value = " ".join(value.split())  # drop control characters and runs of whitespace
    return value[:limit] or None


def _http_url(value: object) -> str | None:
    """Only absolute http(s) URLs, so a hostile feed can't smuggle in javascript: or data: links."""
    url = _text(value, 1000)
    return url if url and url.lower().startswith(("http://", "https://")) else None


def _num(value: object) -> Decimal | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    d = Decimal(str(value))
    return d if d.is_finite() else None


class FinnhubProvider:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://finnhub.io/api/v1",
        transport: httpx.BaseTransport | None = None,  # tests inject a MockTransport
        max_workers: int = 5,
    ) -> None:
        self._client = httpx.Client(
            base_url=base_url,
            timeout=5.0,
            headers={_TOKEN_HEADER: api_key},
            transport=transport or httpx.HTTPTransport(retries=2),  # retries connect failures only
        )
        self._max_workers = max_workers

    def get_quotes(self, symbols: list[str]) -> dict[str, Quote]:
        if not symbols:
            return {}
        with ThreadPoolExecutor(max_workers=self._max_workers) as pool:
            results = list(pool.map(self._one, symbols))
        quotes: dict[str, Quote] = {}
        failures: list[ProviderError] = []
        for symbol, result in zip(symbols, results, strict=True):
            if isinstance(result, ProviderError):
                failures.append(result)
            elif result is not None:
                quotes[symbol] = result
        if failures and not quotes:
            raise failures[0]  # nothing usable: let the caller fall back
        return quotes

    def _one(self, symbol: str) -> Quote | ProviderError | None:
        try:
            resp = self._client.get("/quote", params={"symbol": symbol})
        except httpx.HTTPError as e:
            return ProviderError(f"Finnhub request failed: {type(e).__name__}")
        if resp.status_code == 429:
            return ProviderError("Finnhub rate limit reached")
        if resp.status_code in (401, 403):
            return ProviderError("Finnhub rejected the API key")
        if resp.status_code != 200:
            return ProviderError(f"Finnhub returned HTTP {resp.status_code}")
        try:
            data = resp.json()
            price = Decimal(str(data["c"]))
        except (ValueError, KeyError, TypeError, InvalidOperation):
            return ProviderError("Finnhub returned an unreadable response")
        if not price.is_finite() or price <= 0:
            return None  # Finnhub answers unknown symbols with 200 and all zeros
        prev = None
        try:
            raw_prev = data.get("pc")
            if raw_prev:
                prev = Decimal(str(raw_prev))
                if not prev.is_finite() or prev <= 0:
                    prev = None
        except InvalidOperation:
            prev = None
        ts = data.get("t")
        quote_time = datetime.fromtimestamp(ts, UTC) if isinstance(ts, int) and ts > 0 else None
        return Quote(symbol=symbol, price=price, prev_close=prev, quote_time=quote_time)

    # --- company data (profile, metrics, news, search) ---

    def _json(self, path: str, params: dict[str, str]) -> object:
        try:
            resp = self._client.get(path, params=params)
        except httpx.HTTPError as e:
            raise ProviderError(f"Finnhub request failed: {type(e).__name__}") from e
        if resp.status_code == 429:
            raise ProviderError("Finnhub rate limit reached")
        if resp.status_code == 401:
            raise ProviderError("Finnhub rejected the API key")
        if resp.status_code == 403:
            raise ProviderError("Finnhub does not allow this request on the current plan")
        if resp.status_code != 200:
            raise ProviderError(f"Finnhub returned HTTP {resp.status_code}")
        try:
            return resp.json()
        except ValueError:
            raise ProviderError("Finnhub returned an unreadable response") from None

    def get_profile(self, symbol: str) -> Profile | None:
        data = self._json("/stock/profile2", {"symbol": symbol})
        if not isinstance(data, dict) or not data.get("name"):
            return None  # empty object: ETFs and unknown symbols have no profile
        return Profile(
            name=_text(data.get("name"), 200),
            exchange=_text(data.get("exchange"), 100),
            industry=_text(data.get("finnhubIndustry"), 100),
            country=_text(data.get("country"), 50),
            currency=_text(data.get("currency"), 10),
            web_url=_http_url(data.get("weburl")),
            market_cap_millions=_num(data.get("marketCapitalization")),
        )

    def get_metrics(self, symbol: str) -> Metrics | None:
        data = self._json("/stock/metric", {"symbol": symbol, "metric": "all"})
        m = data.get("metric") if isinstance(data, dict) else None
        if not isinstance(m, dict) or not m:
            return None
        return Metrics(
            week52_high=_num(m.get("52WeekHigh")),
            week52_low=_num(m.get("52WeekLow")),
            avg_volume_10d_millions=_num(m.get("10DayAverageTradingVolume")),
            avg_volume_3m_millions=_num(m.get("3MonthAverageTradingVolume")),
        )

    def get_news(self, symbol: str, days: int, limit: int) -> list[NewsItem]:
        today = datetime.now(UTC).date()
        data = self._json(
            "/company-news",
            {"symbol": symbol, "from": _iso(today - timedelta(days=days)), "to": _iso(today)},
        )
        if not isinstance(data, list):
            raise ProviderError("Finnhub returned an unreadable response")
        items: list[NewsItem] = []
        for raw in data:
            if not isinstance(raw, dict):
                continue
            headline, url, ts = (
                _text(raw.get("headline"), 300),
                _http_url(raw.get("url")),
                raw.get("datetime"),
            )
            if not headline or not url or not isinstance(ts, int) or ts <= 0:
                continue
            items.append(
                NewsItem(
                    headline=headline,
                    summary=_text(raw.get("summary"), 500) or "",
                    source=_text(raw.get("source"), 60) or "",
                    url=url,
                    published_at=datetime.fromtimestamp(ts, UTC),
                )
            )
        items.sort(key=lambda n: n.published_at, reverse=True)
        return items[:limit]

    def search(self, query: str) -> list[SearchHit]:
        data = self._json("/search", {"q": query})
        results = data.get("result") if isinstance(data, dict) else None
        if not isinstance(results, list):
            return []
        hits: list[SearchHit] = []
        for r in results:
            sym = r.get("symbol") if isinstance(r, dict) else None
            if not isinstance(sym, str) or not (sym.isalnum() or _CLASS_SHARE.match(sym)):
                continue  # drops foreign listings such as NVDA.MX and odd tickers
            hits.append(
                SearchHit(
                    symbol=sym,
                    description=_text(r.get("description"), 120) or "",
                    type=_text(r.get("type"), 40) or "",
                )
            )
            if len(hits) == 8:
                break
        return hits


def _iso(d: date) -> str:
    return d.isoformat()
