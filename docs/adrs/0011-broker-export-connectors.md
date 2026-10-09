# 0011 - Broker export connectors: M1 open tax lots; Robinhood deferred

Status: Accepted (2026-10-07)

## Context
ADR 0002 built a connector seam but shipped only cinnamon's own `snapshot` layout, pending real broker exports.
The user supplied one real export from each broker (kept in the git-ignored `seed/private/`, never committed).
- **M1 Finance** offers a holdings export: web Invest > Holdings > Download > *Open tax lots* (CSV). The real file
  starts with two single-cell disclaimer lines, then a 13-column header (`Symbol, Cusip, Acquisition Date, Quantity,
  Cost Basis, Short/Long Term Holding, Unrealized Gain/Loss, Close Date, ..., M1 Tax Lot Id`) and **one row per
  tax lot**. There is no price, market value, security name or date column. M1 says the data is as of the prior
  trading day close. M1's help page lists different column names (`QTY`, `UGL`, ...) than the real file.
  The *Closed tax lots* download has the same header with `Close Date` filled.
- **Robinhood** has **no holdings export**. Its CSVs are the *Account activity report* (transactions over a chosen date
  range) and a 1099 tax CSV (one year of realized sales, dividends and interest). The file the user supplied was the
  1099 CSV. Monthly statements, which do list positions, are PDF only.

Robinhood options considered:
- **Replay the activity report** into positions. This needs the full history since the account opened, handling of
  splits, ACATS transfers (no basis), options and DRIP, and a cost-basis method, which is still undecided (ADR 0007
  is reserved for it). That is the transactions feature, not a parser.
- **Parse the statement PDF.** It has no stable column contract and adds a PDF dependency.
- **The 1099 CSV.** It contains realized sales only, so it cannot give current positions.
- **Defer** (chosen by the user).

## Decision
- New connector `m1-tax-lots` (`app/connectors/m1.py`), specific to platform `m1`, so it is listed before `snapshot`
  and becomes the default format for M1 accounts. No frontend change: the import page already lists the
  connectors the API returns.
- The header is found in the first 10 lines by its `Symbol`, `Quantity` and `Cost Basis` cells (case/space-insensitive),
  which skips the disclaimers without hard-coding their count. Error line numbers stay physical.
- Lots are summed per symbol in Decimal. `market_value` = sum of (cost basis + unrealized gain/loss), or None if any lot
  of the symbol lacks it. `price` = market value / quantity (4 dp). `name` and `as_of` are left empty.
- Repeated symbols are expected (lots), so they are not duplicate errors. A symbol with any bad lot is dropped and the
  error reported, so the file cannot be committed with an understated position (ADR 0002 refuses files with errors).
- A file with any filled `Close Date` is refused as the closed-lots download.
- Shared parsing (UTF-8/BOM, decimals incl. `(1.23)` negatives, symbol pattern, row limit) moved to `connectors/_csv.py`.
- Robinhood keeps using the `snapshot` connector. A Robinhood import waits for the transactions/cost-basis work.

## Consequences
+ M1 users import M1's own file without hand-converting; the value shown before live quotes is M1's prior-close value.
- M1 positions carry no `as_of`, so the "file" value source has no date in the UI.
- The parser relies on M1's header names, which already differ from M1's own documentation. A rename breaks the
  import, but loudly ("Not an M1 Open tax lots export"), not silently.
- M1's export filename contains the account number, and cinnamon stores and shows upload filenames (`imports.filename`).
- Account platform matching is exact: an account created as `m1finance` does not see the connector.
- Robinhood users still need the snapshot format until transactions exist.

## Addendum (2026-10-07): M1 "Holdings" download
The user's first real import attempt used M1's other download, Invest > Holdings > Download > *Holdings*: no preamble,
header `Symbol, Name, Quantity, Avg. Price, Cost Basis, Unrealized Gain ($), Unrealized Gain (%), Value`, **one row per
symbol**. It was run through `snapshot` and failed with "Missing required column(s): cost_basis".
- New connector `m1-holdings` (same module), registered before `m1-tax-lots`, so it is the **default** for M1 accounts.
  `Value` becomes `market_value`, `price` = value / quantity (4 dp), and `Name` is kept (cut to 200 chars). The avg-price and
  gain columns are ignored because they can be derived. A repeated symbol is an error.
- Each M1 connector refuses the other's file with a hint. The tax-lots header check (`Symbol/Quantity/Cost Basis`) also
  matched the Holdings header and would have imported it with **no market value**. It now refuses a header that has
  `Value` but no `Unrealized Gain/Loss`. `Unrealized Gain/Loss` stays optional for tax lots.
- Trade-off: the Holdings file is simpler and carries names, but it has no per-lot detail. Nothing uses lots yet, so
  nothing is lost today.

## Addendum (2026-10-08): Robinhood
Superseded for Robinhood by ADR 0013: the Account activity report is replayed into positions (average cost; the
user types the app's average cost for shares transferred in), with a hand-made `robinhood-positions` template as a
fallback. The 1099 CSV is recognized and refused with an explanation.
