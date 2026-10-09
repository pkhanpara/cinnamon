# Robinhood activity-report replay (average cost, typed-in cost for ACATS transfers)

Status: done (2026-10-08), branch `feat/robinhood-positions-connector` (PR #22), worktree `../cinnamon-robinhood`.
Follows docs/log/20261008-225955-robinhood-positions-connector.md. See ADR 0013 (amended, renamed to
`0013-robinhood-import.md`).

## Why
The user tried the hand-made-template build with their real activity report
(`seed/private/robinhood_activity_report_generated.csv`) and got "This is a Robinhood Account activity report.
Turning transactions into positions is not supported yet". They wanted that file to import.

## Pre-flight findings
Private files were read in place. Only counts, and the user's own symbols in this local terminal, were printed.
- `robinhood_activity_report_generated.csv` md5 `15c12ab2…` is byte-identical to `~/Downloads/95ad2726-…csv`, which
  was profiled in the previous log.
- 137 transactions, 2025-06-04 .. 2026-10-01. **The first row is `ACATI` "ACAT IN" on 2025-06-04**: the account was
  opened by an ACATS transfer.
- Replay of Buy/Sell/ACATI: GOOG 124.628533 (130 transferred in), MSFT 97.640505 (49), NVDA 320.935396 (545),
  TSM 169.513834, RVMD 74.629959, BND 0. None went negative. **The user confirmed these match the app.**
- That corrects the previous log and the first ADR 0013 draft ("only 5 positions, history missing"). The comparison
  used `seed/private/robinhood_positions.csv`, a synthetic split of `holdings.json`.

## Design
User choices (2026-10-08): average cost; the app's average cost for transferred symbols, entered in boxes in the
preview. See ADR 0013 for the replay rules.
- Rejected: per-lot transfer cost (data the user would have to dig up); refusing transferred symbols (they would need
  a second import, but an import replaces the account's positions); a second uploaded file; appending rows to
  Robinhood's CSV.
- Connector contract: `ParseResult.needs_average_cost`, plus `accepts_average_costs = True` and
  `parse(data, average_costs=...)` on the connector, rather than changing the `Connector` Protocol for every connector.
  `api/imports.py` checks the flag and answers 400 if costs are sent to a connector without it.
- The UI sends the costs the current preview used (`appliedCosts`), so an edit after "Apply costs" can't change what
  is imported without a new preview.
- Error lines are the line where each record **starts** (descriptions span lines; `DictReader.line_num` is the end).
- The replace warning is suppressed when the preview has errors (the user found it confusing on a refused 1099).
- `robinhood-activity` is registered before `robinhood-positions`, so it is the default for robinhood accounts.

## What was done
Files: `backend/app/connectors/robinhood_activity.py` (new), `base.py` (`needs_average_cost`), `__init__.py`,
`robinhood.py` (hints and description), `api/imports.py` (`average_costs` form field, `_average_costs` validation,
warning only without errors), `schemas.py` (`ImportPreview.needs_average_cost`);
`frontend/src/app/core/{models,imports.service}.ts`, `pages/import/import.ts` (boxes + Apply costs);
`seed/sample/robinhood_activity.csv` (fabricated) + README; tests `test_robinhood_activity_connector.py` (new),
`test_imports.py`, `test_robinhood_connector.py`, `test_m1_connector.py`, `import.spec.ts`; e2e `first-login.spec.ts`
(selects `robinhood-positions`), `returning-user.spec.ts` (new activity-report test).

Results:
- Real report, connector only: without costs, `needs ['GOOG','MSFT','NVDA']`, 3 whole-file errors, rows RVMD and TSM.
  With a cost for each of the three: 0 errors, 5 positions.
- Same through the running worktree stack (`POST /api/accounts/{id}/imports/preview`, `connector=robinhood-activity`):
  `needs ['GOOG','MSFT','NVDA'] rows ['RVMD','TSM'] errors 3 warnings []`.
- `uv run ruff check .` clean (one DTZ007, the naive `strptime`, fixed with `.replace(tzinfo=UTC)`);
  `uv run pytest -q` → `508 passed`.
- Mutation checks (each reverted, `diff` clean): no `rows.reverse()` → 1 failure; sells not reducing cost → 5;
  ACATI not marking transferred → 5; options counted as shares → 5; no oversell check → 1; keeping fully sold symbols
  → 1.
- Frontend: typecheck clean, `format:check` clean, `test:ci` → 233 passed, `build` complete.
- e2e (8337/4337): the first run failed the audit test on Angular warning NG8102 (`costs()[s] ?? ''` on a non-null
  type). Changed to `||`. Rerun → `20 passed`.

## Still to do
In TODO under "Robinhood replay follow-ups":
- The user's real import with their GOOG/MSFT/NVDA average costs, compared per symbol with the app.
- Warn when the report doesn't start at the account's first activity (a holding never traded in the range is silently
  missing).
- Report skipped open option contracts (needs a warnings channel on `ParseResult`).
- Check SPL/ACATO/reverse-split codes against a real report. They are implemented from documentation only.

## Gotchas
- Compare replays only against real broker data. `seed/private/*_positions.csv` are synthetic splits.
- The e2e audit fails on Angular **warnings** in the dev-server log, not only errors.
- `DictReader.line_num` is the last physical line of a multi-line record.
- The worktree test backend on :8338 runs without `--reload`. Restart it after backend changes (see the
  dev-backend-restart memory).
