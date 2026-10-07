# 0003 - Market-data providers, quote cache and holdings aggregation

Status: Accepted (2026-10-07)

## Context
The holdings view needs current prices. User chose Finnhub (free key) for quotes, live prices in this
step (not deferred), merged rows expandable per account, and an account-checkbox selection.
Measured against the live API (2026-10-07): header auth works, the free tier allows 60 calls/minute
(`x-ratelimit-limit: 60`), an unknown symbol returns HTTP 200 with all zeros, `BRK.B` and `BRK-B` both resolve.

## Decision
- `QuoteProvider` interface (`app/providers/base.py`); `FinnhubProvider` authenticates with the
  `X-Finnhub-Token` header, never `?token=`, so the key cannot appear in URLs or httpx logs (verified:
  zero occurrences in backend/dev-server logs). A price of 0 means "no quote", never a $0 valuation.
  No `FINNHUB_API_KEY` => provider is `None` and holdings fall back to imported values with a warning.
- `quote_cache` table (shared across users, market data is public) with a 60 s TTL (`QUOTE_TTL_SECONDS`).
  Only missing/expired symbols are fetched, in one batch of 5 parallel requests, under a process lock.
  If the provider fails, expired rows are served flagged `stale` and a warning explains why.
- Value precedence per position: live/stale quote x quantity, else the file's `market_value`, else none.
  Money is rounded to cents per account line so merged rows and totals always equal the sum shown.
  A symbol with any unvalued line gets no value (a partial sum would mislead). Gain is computed over valued
  rows only. Day change uses only live quotes (a stale "previous close" is meaningless). Everything is USD.
- `GET /api/holdings?account_ids=1,2`: omitted = all the user's accounts; empty = none; foreign or unknown
  id = 404; ids are de-duplicated. The UI always sends explicit ids.
- UI: selection priority is URL `?accounts=` > localStorage (per user, with a `known` list so accounts created
  later are ticked) > all. Responses to superseded requests are ignored. The donut is inline SVG (no chart library).

## Consequences
+ A bad/expired key, rate limit or outage degrades to stale or imported values instead of an error page.
+ Pure aggregation (`app/holdings.py`) is unit-tested with hand-computed Decimal expectations.
- 60 calls/minute caps cold-cache loads at about 60 distinct symbols; larger portfolios need batching/queueing.
- Selection lives in the browser only; it does not follow the user across devices (user's choice).
- Finnhub free quotes may be delayed, and day change is shown whenever a live quote has a previous close.
- Cash is not modeled, so totals exclude it (the source PDF had $14,177.37 cash).
