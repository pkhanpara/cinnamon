# News: 30-minute cache, Refresh button, "Updated N min ago"

Status: done (uncommitted at time of writing). Touches `api/symbols.py` (news section only), `schemas.py`, `ratelimit.py` (new),
`pages/symbol/symbol.ts` (news section), `core/{format,models,symbols.service}.ts`, `styles.scss`.

## Why
- `NEWS_TTL` was 600 s and `NewsListOut` had `stale` but no fetch time, so the UI could not say how old the headlines were.
- No way to force a refetch. Finnhub free key = 60 calls/min for everyone (ADR 0006), so a naive "bypass cache" button is a budget risk.
- Two other agents share this checkout (seed script; LLM news chat that will also edit `symbols.py` and the ticker page), so the change is
  kept small and in new files where possible.

## Pre-flight findings
- `TTLCache.get_or_set` already returns `Cached(value, stale, fetched_at)`; `fetched_at` is wall-clock, freshness uses an injectable monotonic clock.
  `HistoryOut.as_of` already converts it with `datetime.fromtimestamp(..., UTC)`.
- Baseline before touching anything: `uv run pytest` -> all green; `ng test` -> 129 tests (ADR 0006 log) green.
- **Finding that changed the plan:** the plan had a `force` parameter on `TTLCache.get_or_set`. While implementing I saw that calling
  `get_or_set(key, ttl=60, ...)` on the same entry gives the "never refetch news younger than 60 s" floor, single-flight and stale-on-error
  for free, because the TTL is only applied at read time. `force` was written, then reverted (`git checkout backend/app/cache.py`); `cache.py` is untouched.

## Design
- `NEWS_TTL = 30 * 60`. `NewsListOut.as_of` = cache `fetched_at` (UTC).
- `POST /api/symbols/{symbol}/news/refresh` (POST: side effects, never cached by a browser/proxy). Same cache key `("news", symbol)`, so the LLM
  chat agent reading that entry sees refreshed headlines.
- Limits (`app/ratelimit.py`, in-process sliding window, injectable clock): 1 upstream call per (user, symbol) per 60 s, 10 per user per 60 s across symbols;
  429 + `Retry-After`. Only calls that reach Finnhub are charged (failures too, the budget was spent). Cache age floor of 60 s is shared by all users.
  Check order: 503 no key -> 429 -> age floor -> upstream. Honest note: since every charge corresponds to a fetch, the per-symbol limiter is
  mostly redundant with the age floor; it only bites after a *failed* fetch (cache not updated) and gives the client a Retry-After. The per-user cap is the real protection.
- Failure: cached entry exists -> 200, old items, `stale=true`, old `as_of`; nothing cached -> 502.
- Frontend: `ageLabel(as_of, now)` pure helper; one 1 s `setInterval` (cleared with `DestroyRef`) drives both the label and the 429 countdown.
  1 s rather than the planned 30 s because the countdown needs it; cost is two signal updates per second.
- Rejected: `GET /news?refresh=1` (side effect on GET); invalidate-then-get (loses the items we must keep on failure); a `<app-news>` component
  (rewrites a large chunk of `symbol.ts` while another agent edits it); an `age_seconds` field to dodge clock skew (client clamps negative ages to "just now" instead).

## What was done
Backend (`cd backend`):
- `uv run pytest tests/test_news_refresh.py` -> 10 passed. Full `uv run pytest` -> **222 passed**. `uv run ruff check .` clean; `ruff format --check` on my files clean.
- Mutation checks (each restored from a backup copy; `git diff` confirmed only intended changes remain):
  | mutation | result |
  |---|---|
  | `NEWS_TTL` back to 600 | 1 failed |
  | refresh age floor 60 -> 0 | 2 failed |
  | drop per-symbol `hit` | 2 failed |
  | drop per-user `hit` | 1 failed |
  | never charge the limiter | 3 failed |
Frontend (`cd frontend`):
- `npx ng test --watch=false` -> **139 passed** (17 files; was 129). `npm run build` ok.
- Existing test `news problems are shown quietly...` needed its selector changed (`#news-h` parent -> `closest('section')`) because the heading now sits in a `.news-head` wrapper.
- Mutation checks (restored): timer not cleared -> 1 failed; no symbolSeq guard on refresh success -> 1 failed; button not disabled during 429 cooldown -> 1 failed;
  `newsRefreshing` never reset -> 4 failed.
- Not run: browser/Playwright check (ticker page has no e2e yet, tracked in TODO) and a live Finnhub refresh. **The UI has not been looked at in a browser.**

## Still to do
- Look at the new header row in a real browser (wrapping on narrow screens, button styling).
- Share `SlidingWindowLimiter` with the per-user search/lookup limit (TODO item).
- Limits and caches are per process; with several workers the budget is per worker (ADR 0006 caveat).
- Decide whether a refresh that returns an empty list should keep the old items (currently the empty result wins).

## Gotchas
- `TTLCache` TTL is a *read-time* argument, so different callers can apply different freshness to one entry; that is what the age floor relies on.
- A failed refresh consumes the user's slot (up to 60 s wait), deliberately.
- Tests patch `app.cache.time.time` and the private `_clock` of the cache and limiters; if those are renamed the fixture in `test_news_refresh.py` must follow.
