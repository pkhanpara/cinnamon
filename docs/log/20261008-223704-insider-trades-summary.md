# Insider trades summary (top 10 sellers / buyers)

Status: done. Branch `feat/watchlists-principles`.

## Why
The ticker page's "Insider trades (Form 4, open market, last 12 months)" block (ADR 0012) listed every
trade row by row plus one net figure. For AAPL that is 36 rows. You couldn't see at a glance who sold,
how much money it came to, at what average price, or over what period.

## Pre-flight findings
- Evidence comes from `F.recent_open_market` (codes P/S, last 365 days) in `backend/app/api/principles.py`;
  `net_insider_value` was the only aggregate.
- Finnhub `/stock/insider-transactions` gives name, signed share change, price (sometimes missing),
  code and date. It gives **no cost basis**, so profit can't be computed. The tables show proceeds and cost.

## Design
- Aggregation is in the backend: a pure Decimal function `F.insider_summary(trades)`, which returns
  `(sellers, buyers)`, each an `InsiderSide` list (trades, shares, value, avg_price, first/last date,
  unpriced). Each list is sorted by value descending, then name, and capped at 10 (`INSIDER_TOP`).
  This follows the repo rule that money math is Decimal on the server and the UI only formats.
- Unpriced trades count toward shares and the trade count but not toward value or avg price. The UI
  marks those rows with `*` and a footnote.
- Sides are separate, so an insider who both bought and sold appears in both tables, each with its own span.
- Rejected: computing it in the frontend (float money math, against convention). Also rejected: one
  combined table with buy and sell columns (the user asked for top 10 buys and top 10 sells, and
  per-side spans and average prices are clearer).

## What was done
- `backend/app/fundamentals.py`: `InsiderSide`, `insider_summary`.
- `backend/app/schemas.py`: `InsiderSideOut`, `InsiderSummaryOut`, `EvidenceOut.insider_summary`.
- `backend/app/api/principles.py`: populates it.
- `frontend/src/app/core/models.ts`: `InsiderSide`, `Evidence.insider_summary`.
- `frontend/src/app/components/principles-panel/principles-panel.ts`: "Insider trades summary" heading
  with "Top 10 sellers" / "Top 10 buyers" tables (#, Insider, Span, Trades, Shares, Sold/Bought for,
  Avg price) at the top of the insider block, with the old per-trade table under "All trades".
- Tests: `test_fundamentals.py` (ranking, both-sides insider, unpriced, span, cap at 10, empty),
  `test_principles_api.py` (shape), `principles-panel.spec.ts` (render).

Results:
```
uv run ruff check .          -> All checks passed!
uv run pytest -q             -> 453 passed
npm run typecheck            -> ok
npm run format:check         -> All matched files use Prettier code style!
npm run test:ci              -> 27 files, 231 tests passed
npm run build                -> ok
```
Live AAPL check (real Finnhub key, `F.insider_summary` directly): 36 trades, 8 sellers, 0 buyers. Top:
LEVINSON ARTHUR D 300,000 sh, $86,740,722.31 @ $289.14 (2026-05-06 to 2026-05-27); COOK TIMOTHY D
256,702 sh, $80,358,038.77 @ $313.04. The sellers' values add up to exactly the existing net figure,
-$205,877,306.37.

## Still to do
- Nothing required. The UI was not clicked through in a browser: the dev backend on :8000 must be
  restarted to serve the new field (see memory note on stale backends).

## Gotchas
- "Made money" here means **proceeds**, not profit. The UI hint says so.
- Finnhub doesn't say which insiders are officers (already noted in the panel).
