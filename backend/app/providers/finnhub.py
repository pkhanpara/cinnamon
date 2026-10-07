from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation

import httpx

from app.providers.base import ProviderError, Quote

# Authenticated with a header, not ?token=, so the key never lands in URLs, httpx logs or proxies.
_TOKEN_HEADER = "X-Finnhub-Token"


class FinnhubProvider:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://finnhub.io/api/v1",
        transport: httpx.BaseTransport | None = None,  # tests inject a MockTransport
        max_workers: int = 5,
    ) -> None:
        self._client = httpx.Client(
            base_url=base_url, timeout=5.0, headers={_TOKEN_HEADER: api_key}, transport=transport
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
