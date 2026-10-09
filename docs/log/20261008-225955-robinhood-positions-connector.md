# Robinhood positions connector (hand-made template) + recognition of Robinhood's exports

Status: done (2026-10-08), branch `feat/robinhood-positions-connector`, worktree `../cinnamon-robinhood`

## Why
User: "can we build robinhood importer, I dont think its working correctly". There was no Robinhood importer.
ADR 0011 deferred it, and robinhood accounts offered only `snapshot`. The user's real file,
`seed/private/robinhood_1099tax_activity.csv`, failed with "Missing required column(s): cost_basis".

## Pre-flight findings
All private files were read in place, and only counts and shapes were printed.
- `seed/private/robinhood_1099tax_activity.csv` = `~/Downloads/robinhood_1099tax_activity.csv` (md5 `14741f91…`), and
  `cmp` says it is **byte-identical** to `~/Downloads/54c18471-…csv`, the 1099 file analyzed in ADR 0011. It has 30 rows:
  1099-B 26 rows/40 cols, 1099-DIV 2/35, 1099-INT 2/31. Each section has its own header row. No BOM.
  Exactly 8192 bytes, ends with `\n` on a complete row. The round size looked like truncation, but the user
  confirmed (2026-10-08) that it is the complete file.
- `~/Downloads/95ad2726-…csv` = **Account activity report**: 17123 bytes, 140 records (138 x 9 cols, a 1-cell blank,
  and a 10-cell disclaimer footer), dates 2025-06-04 .. 2026-10-01 newest first, 93 multi-line descriptions. Codes:
  Buy 56, Sell 34, CDIV 27, SLIP 5, ACATI 5 (shares with qty but no price; also cash residuals), DTAX 4, BTO 2, STC 2,
  MTCH 2. Replaying Buy/Sell/ACATI gives **5** open symbols, none negative. Positions older than the window are invisible.
  (`seed/private/robinhood_positions.csv` is a synthetic split from `holdings.json`, not ground truth.)
- The UI picks the first connector as the default (`frontend/src/app/pages/import/import.ts:121`). Both e2e specs
  import a snapshot-format file into a robinhood account.

## Design
User choices (2026-10-08): no replay; a hand-made template; for future replay, ACATI = error, avg cost, skip
options. See ADR 0013.
- `robinhood-positions`: `Symbol, Shares, Average cost` (+ `Name, Market value, As of`). Basis = shares x avg cost
  half-up to cents; price = market value / shares (4 dp), none when the market value is 0.
- Recognition runs before the missing-column check: first header cell `1099-*` → tax-CSV hint;
  `activity date` + `trans code` → activity hint.
- Rejected: activity replay (partial history, ACATI with no basis, options, ADR 0007 open); activity + anchor
  snapshot (two-file flow); a hint inside `snapshot` (that's a generic connector and shouldn't know brokers).

## What was done
1. `git worktree add ../cinnamon-robinhood -b feat/robinhood-positions-connector main`
2. `backend/app/connectors/robinhood.py` (new), registered in `backend/app/connectors/__init__.py`.
3. `seed/sample/robinhood_app_positions.csv` (fabricated; same totals as `robinhood_positions.csv`; a test asserts the
   two parse to identical positions) + README note.
4. Tests: `backend/tests/test_robinhood_connector.py` (new); `test_imports.py` (schwab for the snapshot-only list;
   robinhood list; 1099 preview via the API); `test_m1_connector.py`, `test_snapshot_connector.py` registry asserts.
5. e2e: `first-login.spec.ts` imports the new sample through the default `robinhood-positions` (asserts the Format
   select); `returning-user.spec.ts` selects `snapshot` explicitly.

Results:
- `uv run pytest -q` → `479 passed` (first run: 2 failures, the old registry asserts listing only `snapshot` for robinhood; updated).
- `uv run ruff check .` → clean; `ruff format` reformatted 3 new/edited files.
- Real files: 1099 → `(0, "This is Robinhood's 1099 tax CSV: …")`; activity → `(0, "This is a Robinhood Account
  activity report. …")`; 0 positions each.
- Mutation checks (each reverted, `diff` clean): ROUND_DOWN for basis → 1 failure; `1099-` → `1099-X` → 1 failure;
  always deriving price → 1 failure; dropping the `activity date` half of the check **survived**. That's harmless:
  `Trans Code` alone still identifies the file.
- Frontend: `npm run format:check` clean; `npm run test:ci` → 231 passed; `npm run e2e` (ports 8337/4337,
  `/tmp/cinnamon-e2e-8337`) → 19 passed.

Real-browser check (2026-10-08, agent-browser, worktree stack on :8338/:4338, fresh SQLite in the scratchpad, no
Finnhub key): admin first login → password change → add a `robinhood` account → Import. Format defaults to
"Robinhood positions (from the app)". The real 1099 file previews as `File: This is Robinhood's 1099 tax CSV: …` with
Import **disabled**. `seed/sample/robinhood_app_positions.csv` previews `3 valid row(s) · cost basis 10,700.00 · market
value 12,050.00`, then "Imported 3 position(s)". Home: total $12,050.00, cost $10,700.00, gain +$1,350.00 +12.62%, rows ORCL
40 @ $170.00 / DIS 25 @ $110.00 / INTC 100 @ $25.00. No browser console errors; the only 4xx in the backend log is the
expected pre-login `GET /api/auth/me 401`. (The Portfolio-value chart shows ~$18.8k: that's current holdings at real
yfinance prices vs the sample's made-up prices, not a connector issue.)

## Still to do
- Activity-report replay (ADR 0013 rules, ADR 0007) – TODO.
- "Download template" link on the import page – TODO.
- Real-browser import with the user's own positions, totals vs the Robinhood app (needs their numbers) – TODO.

## Gotchas
- The user's "1099tax_activity" file is the 1099 CSV, not the activity report; the name suggests both.
- I nearly used a quantity from the private seed as a test value. Test numbers must be fabricated (public repo).
- A new platform-specific connector changes the UI default for that platform, so check the e2e specs.
- `pkill -f "uvicorn ... --port 8338"` inside a compound Bash command matches that shell's own command line and kills it
  (exit 144). Stop dev servers by PID from `ss -ltnp` instead.
