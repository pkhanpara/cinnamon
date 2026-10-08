# Merged-row UI polish

## Why
The overlapping seed (docs/log/20261007-170000-seed-overlap.md) showed five rough edges in the merged-row
views: nested scroll box on Home, empty cells on expanded lines, "robinhood robinhood", ticker position
ignoring the Home selection, ticker lines with only quantity and value.

## Pre-flight findings
- Frontend-only: `HoldingLine` already has quantity, cost_basis, value, source; `/api/symbols/{s}` already
  returns the whole position with lines. No backend change.
- `.scroll` is also used by `pages/import`; only `.scroll.tall` (Home table) was removed.
- `frontend/node_modules` was empty and a shared `npm ci` (pid 843472, started by the parent shell) was
  still running ~13 min in when the code was written, so tests had not run yet (see Still to do).

## Design
- Scroll: the page is the only vertical scroller. Table wrapper `.table-x { overflow-x: auto }`, no max-height.
  Rejected `overflow-x: clip` (would hide columns on narrow screens, no sideways scroll) and a taller inner
  box (still two scrollbars). Consequence: the sticky `th` has no tall scroll box to stick in, so the header
  scrolls with the page (global `th { position: sticky }` is harmless).
- Per-line gain: `core/lines.ts` `lineGain` = value - cost; null without a value; percent null at zero cost.
  Price / Day change / Weight stay blank on lines on purpose (per-symbol facts; no per-line API data).
- Platform label: `showPlatform` hides the platform when it equals the nickname (trim, case-insensitive);
  used in Home sub-rows, Home account filter and ticker lines.
- Ticker position vs Home selection: kept as "all accounts" (it is what you own, and what the AI chat is
  told; Home ticks are a per-browser view filter). Labelled "Across all your accounts (N)" / "In <account>",
  and lines unticked on Home get a "hidden on Home" tag (from `loadSelection`, no tags without a user or a
  saved selection). Rejected: client-side filtering (duplicates holdings.py maths) and a backend
  `?accounts=` param (changes what the chat panel receives; other agent's area).
- Ticker lines are now a table: Account | Qty | Cost | Value | Gain / loss.

## What was done
Files: `core/lines.ts` + `lines.spec.ts`, `pages/holdings/holdings.ts` + spec, `pages/symbol/symbol.ts` + spec,
`styles.scss`.

Results (after `npm ci` finished, 335 packages):
- `npm test`: 21 files, 177 passed. `npm run build`: ok. `npm run e2e`: 15 passed (audit test clean).
- Mutation checks on `core/lines.ts` (reverted): removing `.toLowerCase()` -> 2 failures; removing the
  zero-cost guard -> 3 failures.

## Still to do
- Real-browser look at Home with the overlapping seed (single scrollbar, narrow screen) and at /symbol/MSFT
  with an account unticked: not done; jsdom cannot show layout. Added to TODO.md.
- Ticker position following the Home selection would need a backend `accounts` param (not done, by decision).
- Per-line day change / weight (needs API data).

## Gotchas
- jsdom has no layout, so the one-scroller change is only unit-tested structurally.
