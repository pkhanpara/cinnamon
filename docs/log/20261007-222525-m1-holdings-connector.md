# M1 Finance "Holdings" CSV connector

Status: done (branch `feat/m1-holdings-connector`)

## Why
Importing the real M1 download `~/Downloads/Holdings-Oct-07-2026.csv` (19 symbols) failed in the UI with
`File: Missing required column(s): cost_basis`. The file was run through the generic `snapshot` connector.

## Pre-flight findings
- `head ~/Downloads/Holdings-Oct-07-2026.csv`: header
  `Symbol,Name,Quantity,Avg. Price,Cost Basis,Unrealized Gain ($),Unrealized Gain (%),Value`, no preamble,
  money values quoted with thousands separators (`"65,030.11"`), 20 lines = header + 19 symbols.
- That is M1's *Holdings* download, not the *Open tax lots* download that `m1-tax-lots` (ADR 0011) parses.
- Landmine: `M1TaxLotsConnector` finds its header by `Symbol/Quantity/Cost Basis` only, so it **accepted** this file
  and would have imported it with `market_value=None` (no `Unrealized Gain/Loss` column).
- Frontend `pages/import/import.ts:121` picks `connectors[0]` as the default, so registration order sets the default.
  No e2e spec touches M1.

## Design
- New `M1HoldingsConnector` (`backend/app/connectors/m1.py`, slug `m1-holdings`, platform `m1`), registered first so it
  is the default for M1 accounts. `Value` becomes market_value, price = value/quantity (4 dp), `Name` kept.
- Shared header scan (`_find_header`) and the quantity/cost validation (`_check_quantity_and_cost`) are factored out
  for both M1 connectors.
- Each M1 connector refuses the other's file with a hint. Rejected alternative: making `Unrealized Gain/Loss`
  required for tax lots. That breaks the existing, documented "optional" behaviour
  (`test_unrealized_column_is_optional`). The check is narrower: refuse a header that has `Value` but no
  `Unrealized Gain/Loss`.
- Rejected: a one-off conversion of the file into the snapshot format. The next monthly download would fail again.
- ADR: an addendum to 0011 rather than a new ADR, since this extends that decision.

## What was done
- `backend/app/connectors/m1.py`, `connectors/__init__.py`: new connector, registered before tax lots.
- `seed/sample/m1_holdings.csv` (fabricated, same totals as `m1_positions.csv`) + README note.
- Tests: `backend/tests/test_m1_holdings_connector.py` (new), `test_m1_connector.py` (Holdings file refused,
  registry order), `test_imports.py` (m1 connector order, holdings preview+commit, not offered to robinhood).
- `uv run ruff check . && uv run ruff format .` → `All checks passed!`
- `uv run pytest -q` → `381 passed, 1 warning`
- Real file, parsed read-only from `~/Downloads` (not copied into the repo):
  `errors [] positions 19`, `value sum 416671.04 file 416671.04`, and tax-lots connector on the same file →
  `This looks like the M1 Holdings file; choose the M1 Finance Holdings CSV format`.

## Still to do
- Real-browser import of the Holdings file (account platform must be `m1`), with preview totals compared to M1's
  Holdings page. Added to TODO.

## Gotchas
- `csv.Reader` does not exist at runtime (only in typeshed); the annotation imports `_csv.Reader` under `TYPE_CHECKING`.
- Account platform must be exactly `m1` for any M1 format to be offered (ADR 0011).
- The `Holdings` file has no date, so `as_of` is empty, as with tax lots.
