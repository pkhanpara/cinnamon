# 0013 - Robinhood: hand-made positions template; Robinhood's own exports recognized and refused

Status: Accepted (2026-10-08)

## Context
ADR 0011 deferred Robinhood: it has no holdings export, so Robinhood accounts could only use cinnamon's `snapshot`
layout. The user's real Robinhood file (`seed/private/robinhood_1099tax_activity.csv`, git-ignored) is the **1099
consolidated tax CSV**: stacked 1099-DIV (35 cols), 1099-INT (31) and 1099-B (40) sections, each with its own header.
It has one tax year of realized sales, dividends and interest, and no current holdings. Uploading it gave only
"Missing required column(s): cost_basis", which didn't say why.

The user also has an **Account activity report** (2026-10-08 pre-flight, counts only): 138 rows from 2025-06-04 to
2026-10-01, newest first, multi-line descriptions and a disclaimer footer. Codes: Buy 56, Sell 34, CDIV 27, SLIP 5,
ACATI 5 (share transfers with no price), DTAX 4, BTO 2, STC 2, MTCH 2. Replaying it yields only 5 open positions,
because holdings bought before the window and not traded since are invisible.

Options:
- **Replay the activity report.** Needs the account's full history, plus transfers without a basis, options and a
  cost-basis method. Rejected for now by the user.
- **Activity report plus an anchor snapshot.** Two-file flow and more UI. Rejected for now.
- **Hand-made template from the app** (chosen by the user).

## Decision
- New connector `robinhood-positions` (`backend/app/connectors/robinhood.py`), registered for `robinhood` accounts and
  therefore their default; `snapshot` stays selectable. Columns: `Symbol, Shares, Average cost` required,
  `Name, Market value, As of` optional. These are the labels the Robinhood app shows on a position.
  Cost basis = shares x average cost, rounded half-up to cents; price = market value / shares (4 dp).
- Robinhood's 1099 CSV (first cell `1099-...`) and activity report (`Activity Date` + `Trans Code` header) are
  recognized and refused with a whole-file message that says what the file is and to use the template.
- Recorded for when activity replay is built: shares transferred in (ACATI) with no basis are an **error on that
  symbol**, never a guessed basis; **average cost** (what the app shows); **options are skipped** and reported.

## Consequences
+ Robinhood users have a format they can fill from the app without converting to cinnamon's own column names.
+ Uploading a Robinhood export now explains itself instead of reporting missing columns.
- Manual entry: it has to be refreshed by hand whenever positions change.
- The app's average cost is rounded to cents, so the basis can be off by up to half a cent per share.
- The activity-report replay is still open; it depends on the cost-basis decision (ADR 0007, reserved).
