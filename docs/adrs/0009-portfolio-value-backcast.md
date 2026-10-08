# 0009 - Portfolio value chart: a labelled back-cast of current holdings

Status: Accepted (2026-10-07)

## Context
Home should show total portfolio value over time, optionally against SPY, for the ranges the ticker page has
(1D 5D 1M 6M YTD 1Y All) and for the selected accounts. Cinnamon stores only the latest snapshot per account
(`Position`); there are no transactions and no daily snapshots, so true history does not exist yet.
Options considered:
- **Wait** for daily snapshots / transactions (TODO "Daily snapshots, performance + allocation charts"). Correct but the chart is empty for weeks and the feature blocks on a much larger one.
- **Build snapshots first.** Same problem, larger scope.
- **Back-cast now:** today's quantities x historical closes from the existing `HistoryProvider`, clearly labelled.
- Sum in the browser from the per-symbol history endpoint: N requests per page view, duplicated alignment logic, no cap.

## Decision
- **Back-cast, labelled.** `GET /api/portfolio/history?range=&account_ids=&compare=spy` (new `api/portfolio.py`,
  behind `current_user`, same `account_ids` semantics as `/api/holdings`) returns `basis: "backcast"`. The UI always shows
  "Current holdings at past prices. Ignores past buys, sells and cash." Ignored: trades, cash, dividends, closed positions. Splits are fine (Yahoo prices are split-adjusted and quantities are constant).
- **Math.** Per symbol, closes are carried forward onto the union of bar timestamps; value = sum(quantity x close), Decimal, rounded to cents.
  The chart starts at the first timestamp where every included symbol has a price, so a recent listing shortens the chart (with a warning) rather than faking a jump. Shorts (negative quantity) work.
- **SPY** (`compare=spy`) is fetched through the same path and returned rebased to the portfolio's first value, plus % change for both and the gap in percentage points.
  A SPY failure hides only the overlay.
- **Cost control.** History reuses `history_cache` with the ticker page's keys and TTLs (`(symbol, range)`), so the two share entries and each symbol costs at most one Yahoo call per TTL. At most **25 symbols** per request (largest by current value first; the rest are named in `warnings`), fetched by 5 worker threads. `covered_value_pct` says how much of today's value the chart represents.
- **Degradation.** A symbol that fails or has no history is omitted with a warning; if none succeed the answer is 503. Stale-on-error cache values set `stale`.
- **1D** uses the provider's 5-minute bars of the last session; the baseline is the first bar (not the previous close).
- **Frontend.** `components/portfolio-chart` reuses `CHART_FACTORY`; `ChartHandle` gains an optional `setCompare()` for the second line.

## Consequences
- Good: useful immediately; one request per view; the response contract (`basis`) lets real snapshots replace the back-cast later without a UI change.
- Bad: the numbers are not what the account was actually worth; past trades are invisible. Users could misread it, hence the permanent caption.
- Cold first load of 25 symbols is ~25 Yahoo calls (measured warm path 0.2-0.5 s for 6 symbols); yfinance is unofficial and may rate-limit, which shows as warnings or 503.
- The cache is in-process, so a restart refetches.
- Holdings beyond 25 are not charted; funds/cash without a Yahoo ticker are omitted with a warning.
