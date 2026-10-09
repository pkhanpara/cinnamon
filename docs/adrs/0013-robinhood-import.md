# 0013 - Robinhood import: activity-report replay (average cost) and a hand-made positions template

Status: Accepted (2026-10-08; amended the same day: activity replay added once the report proved complete)

## Context
ADR 0011 put Robinhood off: it has no holdings export, so Robinhood accounts could only use cinnamon's `snapshot`
layout. The user's first real Robinhood file (`seed/private/robinhood_1099tax_activity.csv`, git-ignored) is the
**1099 consolidated tax CSV**: stacked 1099-DIV (35 cols), 1099-INT (31) and 1099-B (40) sections, each with its own
header. It has one tax year of realized sales, dividends and interest, and no current holdings. Uploading it gave only
"Missing required column(s): cost_basis", which didn't say why.

The user's **Account activity report** (`seed/private/robinhood_activity_report_generated.csv`; profiled with counts
only): 137 transactions from 2025-06-04 to 2026-10-01, newest first, multi-line descriptions, a blank line and a
disclaimer footer in a 10th cell. Codes: Buy 56, Sell 34, CDIV 27, SLIP 5, ACATI 5 (3 move shares, with no price or
cost), DTAX 4, BTO 2, STC 2, MTCH 2.
- First draft of this ADR: "replay yields only 5 positions, so history is missing". **Wrong.** That compared the replay
  with `seed/private/robinhood_positions.csv`, which is a synthetic split of `holdings.json`, not Robinhood data.
- The report's first row is an ACATS transfer in on 2025-06-04, i.e. the account was opened by moving shares in. The
  user confirmed the 5 replayed positions (GOOG, MSFT, NVDA, TSM, RVMD) match the app. The report is the full history.
- What the report cannot give is the cost of the transferred shares (GOOG 130, MSFT 49, NVDA 545).

Options for the transferred cost:
- **The app's average cost, typed into the preview** (chosen). Robinhood's average cost already includes the
  transferred basis, so one number per symbol is enough.
- Original cost per transferred lot from the old broker: exact, but needs per-lot data the user would have to find.
- Refuse transferred symbols: GOOG/MSFT/NVDA would then need the template, i.e. two imports, and an import replaces
  the account's positions, so they can't be combined.
- Second upload of a `Symbol,Average cost` CSV, or rows appended to Robinhood's file: more steps or hand-editing
  Robinhood's export.

## Decision
- **`robinhood-activity`** (`backend/app/connectors/robinhood_activity.py`), the **default for robinhood accounts**.
  The report is replayed oldest first (the file is newest first; within a day the file's order is kept, reversed)
  with **average cost**: Buy adds shares and `-Amount` (or `Price x Quantity`); Sell and ACATO remove shares at the
  current average; SPL adds shares at no cost; ACATI adds shares and marks the symbol as transferred.
  - Options (BTO/STC/STO/BTC/OEXP) are skipped. OASGN/OEXCS (which move shares) and any other unknown code with an
    instrument and a quantity are row errors. Rows with no instrument or quantity (dividends, interest, fees, cash)
    don't move shares.
  - Selling more than is held is an error naming the symbol: a symptom of a report that doesn't start at account
    opening.
  - A transferred symbol still held is listed in `ParseResult.needs_average_cost`. Without a cost it is a whole-file
    error (commit is blocked). With one, its basis is `shares x average cost` (cents, half-up) and replaces the
    replayed cost entirely.
- **`average_costs`** form field on `POST .../imports/preview` and `POST .../imports`: JSON `{"SYMBOL": "123.45"}`,
  positive numbers, at most 500 entries. Only connectors with `accepts_average_costs = True` take it, others answer 400.
  A cost for a symbol that doesn't need one is an error. `ImportPreview.needs_average_cost` lists the symbols.
- **UI**: the preview shows an "Average cost for transferred shares" box per listed symbol and an "Apply costs" button
  that previews again. Import sends the costs the current preview was made with, not whatever was typed afterwards.
- **`robinhood-positions`** (`backend/app/connectors/robinhood.py`) stays as the fallback: a file the user fills in
  from the app (`Symbol, Shares, Average cost`; optional `Name, Market value, As of`). It recognizes Robinhood's 1099
  CSV and activity report and refuses them with a message saying what the file is and which format to use.
- The "will replace N position(s)" preview warning is only shown when the file has no errors.

## Consequences
+ The user imports Robinhood's own file. The only manual input is one number per transferred symbol.
+ Commit re-parses the file with the same costs. Nothing from the preview is trusted.
- Replayed positions carry no market value or price (the report has none), so Home needs live quotes for values.
- Average cost is the method. FIFO/tax lots (to match a 1099) would need lot tracking (ADR 0007 is still open).
- The report must cover the account's whole history. A shorter range is caught only when it leads to selling more than
  is held. A symbol bought before the range and never traded inside it is silently missing.
- Robinhood's trans codes are known only from this one report and third-party importers. An unseen code that moves
  shares is refused rather than guessed. Splits (SPL) and transfers out (ACATO) are handled from documentation, not
  from a real file.
