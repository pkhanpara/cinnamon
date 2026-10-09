# Watchlists + investing-principles scorecard (phase 1)

Status: phase 1 done (branch `feat/watchlists-principles`)

## Why
The user wants watchlists filtered by their value-investing principles (P/E < 15, P/B < 1.5, current ratio > 2,
long-term debt < 50% of capital, 10-year EPS growth >= 33%, owner-earnings growth 6-7%/yr, institutional
ownership < 60%, market cap > $2B, financing cash flow not above operating cash flow, buybacks not at highs,
no serial acquisitions, plus qualitative checks) and, on a ticker, each value next to its sector mean.

Decided with the user (2026-10-08): manual watchlists first, universe screener later (phase 2); "sector mean" =
Finnhub peers; qualitative principles = manual checklist + evidence; watchlists private per user.

## Pre-flight findings
Probed with the dev `.env` Finnhub key (free tier), 2026-10-08:

| Endpoint | HTTP | Notes |
|---|---|---|
| `/stock/metric?symbol=JNJ&metric=all` | 200 | `peTTM 29.0134`, `pb 7.1831`, `pbAnnual 6.1326`, `marketCapitalization 610355` (USD millions), `currentRatioAnnual 1.0277`; `series.annual` has `eps` (41 years), `currentRatio`, `longtermDebtTotalCapital` (0.3046 for 2025), `pb`/`pe` (27 years) |
| `/stock/peers?symbol=JNJ` | 200 | `["LLY","JNJ","MRK","PFE","BMY","RPRX","ZTS","VTRS","CORT","ELAN"]`: includes the symbol itself |
| `/stock/ownership` | **403** | `You don't have access to this resource.` (premium) |
| `/stock/insider-transactions?symbol=JNJ` | 200 | 266 rows, codes `{P, M, F, S, A}`; **no officer title**, so "senior executives" can't be filtered |
| `/stock/financials-reported?symbol=JNJ&freq=annual` | 200 | 16 10-Ks (2010-2025), sections `bs`/`ic`/`cf`, concepts prefixed `us-gaap_`, `jnj_`, `jnj:` or unprefixed in old years |
| same for JPM | 200 | 15 years; **no capex concept** and no current ratio (`currentRatioAnnual None`): banks |
| same for VOO | 200 | `{"cik":"","data":[]}`: ETF, no financials; metric has only price stats |

yfinance 1.x `Ticker('JNJ').info`: `heldPercentInstitutions 0.767`, `sector Healthcare`, `industry Drug Manufacturers - General`,
`priceToBook 7.27`, `trailingPE 29.7`, `currentRatio 1.089`; `.cashflow` only 4 years (2022-2025), so 10-year
numbers must come from Finnhub as-reported.

Concept coverage per year (JNJ): `NetIncomeLoss`, D&A (`DepreciationDepletionAndAmortization`), capex
(`PaymentsToAcquirePropertyPlantAndEquipment`), CFO, CFF, buybacks, acquisitions present all years; revenue moved from
`SalesRevenueGoodsNet` (<= 2017) to `RevenueFromContractWithCustomerExcludingAssessedTax` (>= 2018); R&D is
`ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost`. JPM uses `DepreciationAmortizationAndAccretionNet`, `Revenues`.
So concepts need fallback lists, and prefixes must be stripped (only `us-gaap` / unprefixed kept, so company
extensions can't shadow a standard name).

JNJ EPS is noisy (2023 13.73, 2024 5.79, 2025 11.03), which is why the 10-year EPS test uses 3-year averages at
both ends (Graham's method).

## Design
See ADR 0012. Rejected alternatives:
- SEC EDGAR companyfacts/frames directly: free and complete, but needs CIK mapping and SIC-based sector grouping;
  Finnhub as-reported already wraps the same 10-K XBRL with the key we have.
- yfinance for the 10-year numbers: only 4 years of statements.
- In-process `TTLCache` for fundamentals: a peer comparison is ~20 Finnhub calls; losing it on every restart is
  too costly, so a DB table (like `quote_cache`).
- Per-watchlist judgments: a verdict on "wide moat" is about the company, so checks are per user + symbol.

## What was done
Backend (`backend/app/`):
- `providers/base.py`: `FundamentalsProvider` / `OwnershipProvider` protocols and dataclasses. `providers/finnhub.py`:
  `get_basic_financials`, `get_reported_annual` (prefix stripping, extensions dropped, original 10-K preferred over 10-K/A),
  `get_peers` (self removed), `get_insider_transactions`, plus a process-wide 55 calls/min budget (`_throttle`, fails after 20 s).
  `providers/yfinance_fundamentals.py`: ownership, sector/industry, quote type, splits. Dependencies in `providers/__init__.py`.
- `principles.py` (registry, thresholds), `fundamentals.py` (pure scoring), `fundamentals_store.py` (DB cache, stale-on-error,
  threaded peer fetch).
- Models `Watchlist`, `WatchlistItem`, `PrincipleCheck`, `FundamentalsCache`; migration `b4eb7a38ed02_watchlists_and_principles.py`.
- Routers `api/watchlists.py`, `api/principles.py`, registered in `main.py`; schemas in `schemas.py`.

Frontend (`frontend/src/app/`): `core/principles.ts` (+spec), `core/principles.service.ts`, `core/watchlists.service.ts`, models;
`components/principles-panel`, `components/add-to-watchlist` (+specs); `pages/watchlists/{watchlists,watchlist}.ts` (+spec); routes, nav link;
ticker page (`pages/symbol/symbol.ts`) embeds both components. E2E: `e2e/watchlists.spec.ts`; `first-login.spec.ts` nav expectation now
includes Watchlists.

Bugs the real data exposed while building:
- JNJ fiscal years end on e.g. `2023-01-01` (= fiscal 2022); keying EPS by `period.year` merged/missed years and made the decade window fall
  back to 1985 data (+4889%). Fixed with `fiscal_year()` (shift a week back).
- JNJ R&D came out 0.12% of sales: the plain `ResearchAndDevelopmentExpense` concept is a $109M in-process charge; the real $14.7B is
  `...ExcludingAcquiredInProcessCost`. Order of fallbacks swapped.
- JPM has no EPS series on Finnhub: falls back to 10-K diluted EPS, flagged not split-adjusted.
- Watchlist page: typing the next symbol while an add was in flight got wiped when it finished (found by the e2e run). Now only the submitted
  text is cleared; unit test added.

Checks (2026-10-08):
- `uv run ruff check . && uv run ruff format --check .` → clean; `uv run pytest -q` → `451 passed` (was 381).
- `npm run test:ci` → `230 passed`; `typecheck`, `format:check`, `build` clean.
- `npm run e2e` → `19 passed` (incl. the first-login audit).
- Live, throwaway backend on :8340 + `ng serve` on :4340 with the real key (dev server on :8000 untouched):
  - `/api/principles/JNJ` 1.99 s cold: P/E 29.01 fail, P/B 7.18 fail, inst. 76.73% fail, EPS growth 78.58% pass, current ratio 1.09 fail,
    LTD/capital 30.46% pass, owner earnings 11.10%/yr pass, R&D 15.57%, buybacks near highs 41.39% pass, acquisitions 43.34% pass.
  - JPM 1.23 s: P/E 13.34 pass, current ratio / cash-flow tests n/a (bank), EPS growth 229.41% from 10-K EPS. VOO: "looks like a fund".
  - `/api/principles/JNJ/peers` 1.48 s cold, 0.00 s cached, 9 peers (LLY MRK PFE BMY RPRX ZTS VTRS CORT ELAN): P/E median 39.61 vs
    mean 69.04, institutional median 85.32%.
  - Headless Chromium: ticker panel, watchlist with JNJ/JPM/KO/VOO, filter "Price / earnings" → `1 of 4 shown` (JPM).

## Still to do
- Phase 2 screener (ADR 0012): universe list, nightly fill job, saved filter sets with threshold overrides.
- Owner-earnings adjustments (non-recurring, pension income, unusual charges) once a reliable tagging is found.
- Split-adjust the 10-K EPS fallback using the yfinance split history.
- Persist the watchlist filter selection (per browser or server).
- Header overflows at phone width (pre-existing; the new nav link adds ~80 px): scrollWidth 691-698 at 390 px on Home, ticker and
  watchlists pages, caused by the symbol search + user name.
- Real-browser check in the user's own dev app (only checked headless here).

## Gotchas
- Finnhub insider transactions carry no officer title.
- `/stock/peers` returns the symbol itself.
- `pkill -f "uvicorn ... --port 8340"` from a Bash tool call killed the calling shell (the pattern matched its own command line);
  kill by the port's pid from `ss -ltnp` instead.
- Finnhub `pb` is current price/book (JNJ 7.18); `pbAnnual` uses the fiscal-year-end price (6.13). The scorecard uses `pb`.
