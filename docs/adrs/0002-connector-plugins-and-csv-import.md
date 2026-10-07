# 0002 - Connector plugins and CSV-first import

Status: Accepted (2026-10-07)

## Context
Robinhood and M1 Finance (to our knowledge) have no official public retail API; unofficial APIs
need stored credentials and may break ToS. More platforms are expected. We have no real broker
exports yet, only a PDF-derived "positions snapshot" layout of our own.
Alternatives considered: unofficial live APIs, a third-party aggregator, manual entry only.

## Decision
- A **connector** only parses a file into normalized positions (`app/connectors/base.py`); it never
  touches the DB or network. Connectors register in `app/connectors/__init__.py`; a connector lists the
  `platforms` it is specific to (empty = generic). The import form offers the connectors for the account's
  platform, specific ones first. Today only the generic `snapshot` connector exists.
- Import is **preview then confirm**: `POST /accounts/{id}/imports/preview` parses and writes nothing;
  `POST /accounts/{id}/imports` re-parses the uploaded file (nothing from the preview is trusted) and refuses
  any file with errors. No server-side temp state; the browser re-sends the file.
- **Re-import replaces** the account's positions in one transaction and discards the old rows (user choice).
  An `imports` row (filename, sha256, row count, time) is kept as an audit log, and an identical re-upload
  is flagged in the preview. One row per symbol per file; duplicates are errors.
- The file's `market_value` / `price_used` / `as_of` are stored as given; live prices overlay later.
- Decimals are stored as TEXT via `DecimalText` (SQLite has no exact decimal type) and sent to the UI as strings.
- Limits: 2 MB upload, 5000 rows, UTF-8 (BOM ok). Filenames are stripped to a basename and control characters.

## Consequences
+ No broker credentials, new platforms are one module, bad files can't half-import (atomic).
- Replace-and-discard means **imports are not history**: the performance-over-time chart must come from the
  daily portfolio snapshot job, not from old imports (decided with the user; revisit if history is wanted).
- SQL cannot SUM/ORDER BY the decimal columns correctly; aggregate in Python.
- The snapshot layout is ours. Real Robinhood/M1 parsers need real sample exports.
- Preview and commit both parse the file, so a file changed between the two steps imports the new content
  (the user's UI re-sends the same File object, which the browser snapshots at selection).
