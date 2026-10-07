# Ticker detail page

## Why
Next item in TODO.md: click a holdings row / search a symbol and get a Yahoo-style page: quote, chart, key stats,
your position, news. Decisions and trade-offs: ADR 0006.

## Pre-flight findings
- Push of the previous work was first REJECTED (`hint: ... fast-forwards`): another session had merged PR #1
  (adds `CLAUDE.md`) on GitHub. Fetched, `git merge origin/main` (only added a file; a rebase would have needed a clean
  tree and the E2E session had uncommitted files), pushed `77bc324..6aaea9a`. PR #2 (Playwright E2E) landed later the same way.
- Live probes (2026-10-07, free Finnhub key):
  `/stock/candle` -> `{"error":"You don't have access to this resource."} [HTTP 403]`;
  `/stock/profile2?symbol=NVDA` ok, `VOO` -> `{}`; `/company-news` -> 250 items for 14 days; `/stock/metric` ok; `/search?q=nvidia` ok.
  yfinance 1.7.0 via `uv run --with yfinance` (throwaway env): NVDA 1mo/1d 21 rows, VOO 1y 251 rows, NVDA 1d/5m 78 rows,
  BRK-B 5d 5 rows, unknown symbol 0 rows.
- Design questions asked first. Answers: lightweight-charts; ranges 1D 5D 1M 6M YTD 1Y All (the PDF's); contents =
  quote header, key stats, your position, news; navigation = holdings link + header search box.

## Design
See ADR 0006. Rejected: Finnhub candles (403), hand-rolled SVG or Chart.js for the chart, fetching logos/news images
(third-party requests from the browser), persisting history in SQLite (no migration needed, restart just refetches),
failing the whole overview when profile/stats fail.

## What was done
- Backend (commit `81d2c2d`): `app/cache.py` (TTLCache), `providers/yfinance_history.py`, Finnhub profile/metrics/news/search,
  `api/symbols.py`, schemas; provider factories are singletons (previously a new `httpx.Client` per request). Tests: 212 passing
  (cache incl. concurrency/eviction, provider parsing incl. hostile news URLs, fake `yfinance` module with real pandas frames, API).
- Mutation checks, all restored: no symbol validation, `javascript:` links allowed, other users' positions leaking into the overview,
  stale quote showing a day change -> each made exactly one test fail.
- A first attempt to round market cap/volume silently did nothing: `ruff format` had re-wrapped the lines my text replacement
  targeted (3 tests failed, which is how I noticed); redone with a regex.
- Frontend: `core/{format,chart-data,symbols.service}.ts`, `components/price-chart` (+ lazy `lightweight.ts` adapter behind
  `CHART_FACTORY`), `components/symbol-search`, `pages/symbol`, route `/symbol/:ticker`, holdings symbols link to it,
  holdings now uses the shared formatters. 129 tests passing.
- Mutation checks (restored): remove the history-race guard, the overview-race guard, `rel="noopener noreferrer"` -> each fails one test.
- My own test bugs, not product bugs: a search test flushed a request that `switchMap` had (correctly) cancelled; a holdings
  test assumed row order that is value-then-symbol.
- Live browser run (isolated ports 8020/4220, fresh DB, default admin sign-in + forced password change, real Finnhub + Yahoo,
  real-derived seed + a Roth account with 10 NVDA):
  - NVDA: header `$239.24 +$0.34 (+0.14%)`, 6M chart rendered (7 canvases, 896x352), stats `$164.27 - $240.10`, `$5.77T`, `107.92M`,
    position `927.239` with lines Main 917.239 / Roth 10, 20 news items with `_blank` + `noopener noreferrer` links.
  - 1D: ET axis labels (10:00 AM ... 3:40 PM). BUG FOUND: the line was red while the header said up; it was coloured first-bar to
    last-bar (opened 241.245, closed 239.17) but the day was up vs yesterday's 238.90. Fixed: a 1D line is coloured against the previous
    close (`periodUp(points, baseline)`), re-checked green.
  - VOO (ETF, held): name from the import, no market cap, volumes present. BRK.B (not held): 52-week range hidden with a warning.
    ZZZZNOPE: "Unknown symbol ZZZZNOPE" + link home. Search "nvid" -> NVDA listbox, Enter opens it; searching "ko" from an error page loads KO.
  - The Finnhub key appears 0 times in the served HTML/JS and in the backend log; no tracebacks.
- Live backend smoke before the UI found 3 real problems: a transient first-call `ConnectError` (did not reproduce; now retried by the
  transport), BRK.B's wrong 52-week range (now hidden), and float noise in market cap/volume (now whole numbers).

## Still to do
Rate-limit lookups per user, Docker rebuild with yfinance, ticker-page E2E in `frontend/e2e`, candlesticks/previous-close line, watchlist button. See `docs/TODO.md`.

## Gotchas
- Cleanup killed only the `npx` wrapper PID; the `ng serve` child kept port 4220 until I killed it by port. Ports 8000/4200 belonged to
  someone else and were left alone (isolated stack used 8020/4220 via `ng serve --proxy-config`).
- Finnhub `marketCapitalization` and average volumes are in millions.
- The chart's attribution logo (TradingView) is intentionally left visible per the Apache-2.0 notice requirement.
