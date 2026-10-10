# TODO.md roadmap cleanup (2026-10-10)

## Why
`docs/TODO.md` had grown to 142 lines: 47 flat Todo entries mixing finished and open work, the same ideas listed 2-3 times (per-user rate limit at lines 13, 17, 38; real-browser checks in ~10 places), a stale "Phase 1 scaffold" In Progress item, and a fully-checked Material UI item sitting in In Progress.

## Pre-flight findings
- `git status` clean on main before the edit; previous version is recoverable via `git show HEAD:docs/TODO.md`.
- Recent merges (#22-#26) already covered Robinhood, Material M3, GHCR publishing, LLM markdown, cash-flow charts, so their parent items were mostly done.

## Design
- Open work regrouped into 9 themes: browser verification, rate limiting/auth, portfolio data model, holdings/account pages, ticker/watchlists, broker import, news/LLM chat, backend robustness, CI/tests/publishing.
- Rejected: priority ordering / effort estimates (nothing in the file has them reliably; would be invented); dropping any open item (kept all, merged only true duplicates).
- Completed parents with open children were split: done part to Done, open children kept under a theme.
- Done section condensed (related lines merged), keeping log/ADR references.

## What was done
- Rewrote docs/TODO.md. Merged: three rate-limit items -> "Rate limiting and auth hardening"; scattered eyeball/real-browser items -> one verification backlog; Dependabot items (actions + uv) -> one.
- In Progress emptied (Material UI done except dark theme/mat-table, moved to Holdings pages; Phase 1 scaffold moved to Done).

## Follow-up
Rate limiting and auth hardening moved to a new `### Backlog` section (deprioritized by the user, 2026-10-10).

## Still to do
Nothing deferred; open items stay in TODO.md.

## Gotchas
- Dates/ADR references were copied from the old file, not re-verified against docs/.
