# Portfolio value chart on Home (back-cast)

Branch `feat/portfolio-value-chart`. ADR: `docs/adrs/0009-portfolio-value-backcast.md`.

## Why
TODO item "Portfolio value chart on Home, with SPY comparison and ranges". Only the current snapshot per account is stored
(`models.Position`), so history has to be a back-cast.

## Pre-flight findings
- The TODO/brief said `providers/history.py`; the file is `providers/yfinance_history.py` (protocol in `providers/base.py`). Used read-only.
- `history_cache` keys are `(symbol, range)` with TTLs in `api/symbols._HISTORY_TTL`; reused so the ticker page and chart share entries.
- `_parse_ids` in `api/holdings.py` reused by import (no edit).
- Position quantities per symbol come from `holdings.build` (also gives values for ranking the 25-symbol cap).

## Design
See ADR 0009. Rejected: wait for snapshots (empty chart), build transactions first (scope), client-side summing (N requests, no cap).

## What was done
- `backend/app/api/portfolio.py` + router line in `main.py`; `backend/tests/test_portfolio_history.py` (24 tests).
- `frontend`: `components/portfolio-chart/`, `core/portfolio-chart.ts`, `core/portfolio.service.ts`, models, optional `setCompare` on `ChartHandle` (+ `lightweight.ts` LineSeries), wired into `pages/holdings/holdings.ts`.
- Results: `uv run pytest` 311 passed; `ruff check` clean; `npm test` 198 passed; `npm run build` ok.
- Live smoke (real Yahoo, sample seed, TestClient): 1d -> 200, 78 points, 1.0 s; 1m -> 21 points, 0.2 s, SPY +1.71% vs portfolio -0.25 pp-gap -1.96; all -> 782 points, warning "Chart starts when SCHD began trading".
- Quote warnings ("Live prices are off") are deliberately not forwarded: quotes only rank symbols for the cap.

## Still to do
See TODO.md leftovers: browser eyeball, Playwright coverage, 1D vs previous-close baseline, real snapshots.

## Gotchas
- 1D values (5m bars) and daily values can differ by a few dollars at the end because the last 5m bar is not the official close.
- Weekly bars for All are keyed by the bar's session date; SPY's weekly bars align by carry-forward.
- A recent listing truncates the whole chart to its first trading day.
