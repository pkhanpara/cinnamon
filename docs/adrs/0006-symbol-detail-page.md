# 0006 - Symbol detail page: Yahoo history, cached company data, lightweight-charts

Status: Accepted (2026-10-07)

## Context
User wants a Yahoo-style ticker page (quote header, chart, key stats, your position, news) reachable from
the holdings table and from a header search box, with the PDF's ranges (1D 5D 1M 6M YTD 1Y All).
Checked against the live APIs on 2026-10-07 instead of assuming:
- Finnhub `/stock/candle` (history) -> **HTTP 403** on the free key. `profile2`, `/stock/metric`,
  `/company-news` and `/search` work. `profile2` is `{}` for ETFs (VOO). The unknown-symbol answer is HTTP 200 with zeros.
- Finnhub's 52-week range for `BRK.B` was 698,000-806,102 (Class A prices) while the quote was 505.54.
- yfinance 1.7.0 returns daily, weekly and 5-minute bars, works for ETFs and `BRK-B`, and returns an empty frame
  for an unknown symbol. It is unofficial and can break without notice.
- One first request failed with a transient `ConnectError`, then worked; it did not reproduce.

## Decision
- **Endpoints** (`/api/symbols`, all behind `current_user`): `GET /search?q=`, `GET /{symbol}` (quote, profile,
  stats, and your position across your accounts via the existing pure `holdings.build`), `GET /{symbol}/history?range=`,
  `GET /{symbol}/news`. The overview is assembled from independent pieces: a failing profile call becomes a warning, not an error.
  Symbols must match `^[A-Za-z0-9][A-Za-z0-9.\-]{0,14}$` (422 otherwise); with no key and nothing held the answer is 503, not a false 404.
- **Providers:** `HistoryProvider` (`YFinanceHistory`, lazy-imported, dots become dashes, 1D = last session of a 5-day fetch)
  and `CompanyDataProvider` (extra methods on `FinnhubProvider`). One pooled Finnhub client for the process; the transport retries connect failures twice.
- **Caches:** an in-process `TTLCache` (`app/cache.py`): one upstream call per key even under concurrency, failures are never
  cached, and an expired value is served flagged `stale` if the refresh fails. TTLs: history 1 min (1D), 5 min (5D), 15 min (daily), 1 h (All);
  profile 6 h, metrics 1 h, news 30 min (was 10, see amendment), search 5 min. Quotes keep using the DB-backed cache (ADR 0003). No new tables.
- **Untrusted text:** news and profiles are plain text; only absolute `http(s)` URLs survive; images and logos are not
  fetched or sent (no third-party requests from the browser); news links open with `rel="noopener noreferrer"`.
- **Plausibility:** a 52-week range that cannot contain the current price (outside 0.8 x low .. 1.2 x high) is hidden with a warning.
- **Chart:** TradingView `lightweight-charts` 5 (Apache-2.0, ~47 kB gzipped), loaded lazily in its own chunk with its
  attribution logo left on, behind an injectable factory so tests need no canvas. Intraday axes and crosshair use US Eastern time;
  daily bars use the exchange date string, so they cannot drift by time zone. A 1D line is coloured against the previous close
  (so it agrees with the header's day change); other ranges first-to-last.
- **Search box:** 300 ms debounce, cancels the previous request, results in an ARIA combobox/listbox. Enter opens the highlighted result, else
  the exact symbol if it is a result, else the first result, else the text as a symbol.

## Consequences
+ Works for any valid symbol, not only held ones; each section degrades on its own.
- yfinance is unofficial and heavy (pandas); the Docker image grows and has not been rebuilt with it yet.
- Caches live in one process: a restart refetches, and several workers would not share them.
- Finnhub budget is 60 calls/min: an overview costs 3 (quote, profile, metrics), news 1, each search 1.
  Only news refresh is rate-limited per user so far (see amendment); search and lookups are not (TODO).
- Intraday data is US-market oriented; extended hours, other exchanges and currencies are not handled.

## Amendment 2026-10-07: news TTL and refresh
- News TTL is 30 min. `NewsListOut.as_of` reports when the items were fetched, so the page shows "Updated N min ago".
- `POST /api/symbols/{symbol}/news/refresh` refetches on demand: never within 60 s of the last fetch (any user's), at most one upstream call per
  user and symbol per minute and ten per user per minute (429 + `Retry-After`), and on failure the previous items are returned flagged stale.
  Limiter state is in-process like the caches. Details: `docs/log/20261007-163500-news-cache-and-refresh.md`.
