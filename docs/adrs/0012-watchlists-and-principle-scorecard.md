# 0012 - Watchlists and an investing-principles scorecard with peer comparison

Status: Accepted (2026-10-08). Phase 1 (manual watchlists) built; phase 2 (screener) proposed below.

## Context
The user invests by a fixed set of value principles (Graham/Buffett style) and wants watchlists filtered by them, and,
on a ticker, each principle's value next to its sector mean. The principles:

| Computable | Needs judgment |
|---|---|
| institutional holding < 60%, P/B < 1.5, P/E < 15, 10-year EPS growth >= 33%, current ratio > 2, market value > $2B, long-term debt < 50% of capital, owner-earnings growth 6-7%/yr over a decade, financing cash flow not above operating cash flow, R&D % of sales, no buybacks at record highs, not a serial acquirer | temporary bad news / recoverable trouble, stock-split hype, CEO hype or self-dealing, Form 4 insider trades of senior executives, wide moat, reliance on one customer, acquisitions in the 10-K |

Sources were probed live on 2026-10-08 with the free Finnhub key (details in `docs/log/20261008-213725-watchlists-principles.md`):
- Finnhub `/stock/metric?metric=all` (ratios + 41 years of annual EPS, current ratio, LTD/total capital), `/stock/financials-reported`
  (16 years of as-reported 10-K XBRL), `/stock/peers`, `/stock/insider-transactions`: all HTTP 200.
- Finnhub `/stock/ownership` (institutional holders): **403**, premium. yfinance `info.heldPercentInstitutions` works, also gives sector/industry and splits.
- yfinance statements cover only 4 years, so they can't serve the 10-year principles.

Alternatives considered:
- **SEC EDGAR companyfacts/frames directly.** Free and complete, frames even give every filer's value per concept, but needs a CIK map and SIC-based
  sector grouping. Finnhub as-reported wraps the same 10-K XBRL behind the key we already use. Kept as the fallback if Finnhub's free tier shrinks.
- **"Sector" = every universe stock in the same Yahoo sector.** Needs the screener universe first. Finnhub peers (~10 companies in the same
  sub-industry) are cheaper and closer comparables.
- **In-process cache** (like ADR 0006) for fundamentals. A peer group costs ~20 upstream calls; losing that on every restart is too costly.
- **Verdicts per watchlist.** A judgment like "wide moat" is about the company, so it follows the symbol into every list.

## Decision
- **Phase 1 = user-curated watchlists** (private per user, max 50 lists x 100 symbols) plus a per-symbol scorecard. Phase 2 = screener (below).
- **Principle registry** in `backend/app/principles.py` (key, label, the user's wording, threshold, unit, which direction is better).
  Pure scoring in `backend/app/fundamentals.py` (Decimal only, no I/O): each computed principle yields value, `pass|fail|warn|info|na`, a note
  and the years of data used. Specific rules:
  - EPS growth: Graham's method, 3-year average EPS now vs 3-year average a decade earlier (last 12 fiscal years). Without a Finnhub EPS
    series (JPM), 10-K diluted EPS is used and flagged "not adjusted for stock splits". 52/53-week fiscal years ending in early January
    belong to the previous year.
  - Owner earnings = net income + D&A - capex, CAGR between 3-year averages. The user's formula also subtracts non-recurring items,
    pension income and unusual charges; those are inconsistently tagged in XBRL (and need tax treatment), so they are **not** applied and the
    principle is labelled an approximation.
  - Financing vs operating cash: fail if the latest year's financing cash flow exceeds operating; warn if it happened in 3+ of the last 10.
  - Buybacks at highs: warn if > 50% of the last 5 fiscal years' buyback dollars were spent in years whose average weekly close was within
    10% of the 5-year high (Yahoo weekly closes, the ticker page's cached "All" history).
  - Acquisitions: warn above 50% of operating cash flow over 5 years.
  - Banks and insurers (Yahoo industry): current ratio, financing-vs-operating and acquisitions are n/a, their cash flows aren't comparable.
  - Funds (Yahoo quote type ETF/mutual fund, or no financials at all) are not scored.
- **User verdicts** (`principle_checks`: pass/fail/unsure + note, per user and symbol) can be set on any principle and override the computed
  status for display and filtering; the computed status stays visible next to it.
- **Peers as the sector:** Finnhub `/stock/peers` (self removed, max 10), each scored without price history; mean, median and n per principle.
  The UI compares with the median (outliers drag the mean: JNJ's peers have P/E mean 69 vs median 39.6).
- **Caching:** `fundamentals_cache` table (JSON of the trimmed `CoreData`, one row per symbol): fresh 24 h, 1 h when a source failed,
  stale-on-error, single-flight per symbol; peer fetches run 4 at a time in threads, the DB session stays on the request thread.
  Insider trades (6 h), splits (24 h) and peer lists (24 h) use the in-process `company_cache`.
- **Finnhub budget:** `FinnhubProvider` now throttles itself process-wide to 55 calls/min (sliding window) and fails fast with ProviderError
  rather than waiting more than 20 s. This also covers quotes, profiles and news.
- **API:** `/api/watchlists` CRUD + items; `/api/principles/{symbol}` (`?evidence=false` for watchlist rows skips insider/split lookups),
  `/api/principles/{symbol}/peers`, `PUT|DELETE /api/principles/{symbol}/checks/{key}`. 503 without `FINNHUB_API_KEY`, 502 when nothing
  was ever cached and Finnhub fails.
- **UI:** Watchlists nav page and detail page (rows fill in progressively, 3 scorecards at a time; filter chips "show only symbols that pass");
  the ticker page gets "Add to watchlist" and an "Investing principles" section with peer median/mean, verdicts, notes and evidence
  (open-market Form 4 trades, buybacks vs price, 10-year cash flows, splits).

### Phase 2 (proposed, not built)
Screener over a fixed universe (S&P 500 list checked into the repo), filled by a nightly background job into `fundamentals_cache` at
<= 55 Finnhub calls/min (~2 calls + 1 Yahoo call per symbol: ~20 min), and saved filter sets ("watchlist = filters") with per-list threshold
overrides. Needs the startup/worker guard from the TODO (two processes) and a decision on where the job runs.

## Consequences
+ Every principle the data can answer is answered with its rule, data span and caveat; the rest are explicit checklists with evidence.
+ One upstream budget for the whole process; caches survive restarts.
- Finnhub insider data has **no officer titles**, so "senior executives" can't be filtered; the UI says so.
- 10-K EPS fallback is not split-adjusted; owner earnings skip non-recurring/pension adjustments; calendar years approximate fiscal
  years for buyback timing.
- Peer quality is Finnhub's (JNJ's peers include CORT and ELAN, much smaller). n is shown.
- yfinance remains unofficial: when it breaks, institutional ownership and buyback timing go n/a with a warning; the rest still works.
- More Finnhub traffic: a cold ticker page costs ~3 calls more, a cold peer group ~20 (then a day of cache).
