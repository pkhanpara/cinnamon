# Broker CSV connectors: M1 open tax lots (Robinhood deferred)

Status: done (2026-10-07)

## Why
TODO: "Real Robinhood / M1 CSV parsers (need real sample exports from user)". Only cinnamon's own
`snapshot` CSV layout could be imported (ADR 0002), so users had to hand-convert broker data.

## Pre-flight findings
Research (2026-10-07):
- M1 help center ("Download and view your Realized Gains on M1", help.m1.com/en/articles/9331949): web only,
  Invest > Holdings > Download > Open tax lots / Closed tax lots, CSV. The page is marked AI-generated, and its
  column list turned out to be wrong (see below).
- Robinhood ("Finding your reports and statements", robinhood.com/us/en/support/articles/finding-your-reports-and-statements/):
  Account activity report = CSV of transactions (2-24 h to generate; no crypto/futures/spending); monthly
  statements = PDF; realized gain/loss CSV on request through support. **No holdings/positions export.**
  Activity columns per third-party importers (Ghostfolio, BullBenchmark, unverified): `Activity Date, Process
  Date, Settle Date, [Account Type], Instrument, Description, Trans Code, Quantity, Price, Amount, [Suppressed]`.

Real files from the user, in the main checkout's git-ignored `seed/private/` (read in place, never copied, and never
printed: inspected with a script that masks digits to 9 and letters to A/a):
- **M1 Open tax lots** (`<account number>-Open-tax-lots <Mon-DD-YYYY>.csv`):
  - lines 1-2 are single-cell disclaimers ("**This data is being provided for general and reference purposes
    only. This report reflects current data available from prior trading day close..."), and **line 3 is the header**;
  - header: `Symbol, Cusip, Acquisition Date, Quantity, Cost Basis, Short/Long Term Holding, Unrealized Gain/Loss,
    Close Date, Short Term Realized Gain/Loss, Long Term Realized Gain/Loss, Wash Sale Indicator,
    Disallowed Wash Sale Amount, M1 Tax Lot Id`, which is not the `SYMBOL, QTY, UGL, ...` the help page lists;
  - one row per lot (a few hundred lots, about 20 symbols); quantities up to 5 dp; plain decimals with no `$`/`,`;
    negatives as `-12.34`; dates `YYYY-MM-DD`; `Close Date` and the realized columns are blank; LF, no BOM, UTF-8;
    every symbol matches the existing `SYMBOL_RE`.
- **Robinhood**: a **1099 consolidated-tax CSV**, with record types `1099-DIV` (35 cols), `1099-INT` (31), `1099-B` (40:
  `DATE ACQUIRED, SALE DATE, DESCRIPTION, SHARES, COST BASIS, SALES PRICE, TERM, ...`). That is one tax year of
  realized sales, dividends and interest, plus account number and payer address. It has no current holdings.

## Design
See ADR 0011. M1: aggregate lots per symbol; market value = sum of (cost basis + unrealized G/L); price derived;
no as_of (the file has none). The disclaimer lines are skipped by searching the first lines for the header.
Rejected:
- Robinhood from the 1099 CSV: realized sales only, it can't give positions.
- Robinhood activity-report replay: needs full history since account open, plus splits/transfers/options and a
  cost-basis method (ADR 0007 still open). That is the transactions feature, not a parser. The user chose to defer (2026-10-07).
- Robinhood statement PDF: no stable column contract, and it would add a PDF dependency.
- Treating repeated symbols as duplicate errors (as snapshot does): M1 lots repeat symbols by design.

## What was done
Baseline: `cd backend && uv run pytest -q` -> `315 passed`.
1. `refactor(connectors): extract shared CSV helpers` (2eb6b9b): new `backend/app/connectors/_csv.py`
   (`decode`, `parse_decimal`, `is_blank`, `SYMBOL_RE`, `MAX_ROWS`), and `snapshot.py` now uses it.
   `parse_decimal` also reads `(5.00)` as -5.00, so a snapshot `cost_basis` of `(5)` now reports "cannot be
   negative" instead of "not a number" (test added). `tests/test_snapshot_connector.py`: 29 passed.
2. `feat(connectors): M1 Finance open tax lots connector` (1fed1e4): `backend/app/connectors/m1.py`
   (`M1TaxLotsConnector`, slug `m1-tax-lots`, platforms `{"m1"}`), registered in `connectors/__init__.py`.
   Fabricated fixture `seed/sample/m1_open_tax_lots.csv` in the real layout; its lots sum to the same per-symbol
   totals as `seed/sample/m1_positions.csv`. Tests: `backend/tests/test_m1_connector.py` (33) and 3 API tests in
   `test_imports.py` (m1 account lists `["m1-tax-lots", "snapshot"]`, preview totals `14400.00` / `16200.00`, commit,
   400 for a robinhood account).
   - Mutation checks, each reverted (backup in the scratchpad, `diff` clean afterwards):
     - not dropping a symbol with a bad lot: 12 failures;
     - removing the closed-lots check: `test_closed_lots_file_rejected_with_hint` failed;
     - treating a missing UGL as 0: 2 failures;
     - widening the header window to 100 lines: `test_not_an_m1_export[...]` failed.
   - Real file, read in place from the main checkout and printing only counts:
     `positions: 19 errors: 0`, `all have market_value: True`. The 19 matches the distinct symbols in the file.
     Totals were not printed; the user compares them against M1's Holdings page.
   - Full suite `352 passed`; `ruff check .` all passed; `ruff format --check .` clean after formatting `test_imports.py`.
   - `grep -rIl` for the real files' account number / uuid over the worktree: no matches. Only `.env` is ignored-and-present.
3. Docs: ADR 0011 (new), with a one-line pointer from ADR 0002's consequences; `docs/TODO.md`; this log.
No frontend change (`pages/import/import.ts` lists whatever `/api/accounts/{id}/connectors` returns). No e2e run:
the e2e specs only create `robinhood` accounts, whose connector list is unchanged (`["snapshot"]`).

## Still to do
- Robinhood import: needs an Account activity report CSV and the cost-basis method (ADR 0007). Added to TODO.
- Real-browser check of an M1 import (default format for m1 accounts; preview totals vs M1's Holdings page). Added to TODO.
- e2e M1 workflow is already in TODO ("E2E: more workflows ... M1 connector").

## Gotchas
- M1's export filename contains the **account number**. Cinnamon stores the upload filename in `imports.filename`
  and shows it in the UI.
- M1's help page lists column names that don't match the real export. Trust the file, not the doc.
- Platform match is exact: an account created as `m1finance` or `m1-finance` does not get the connector.
- The user's real files live in the main checkout (`~/repo/cinnamon/seed/private/`), not in this worktree.
