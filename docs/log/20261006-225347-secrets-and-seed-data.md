# Secrets hygiene and seed data (in progress)

## Why
New public repo `pkhanpara/cinnamon` (no commits). User supplied a Finnhub key and a real
portfolio PDF (`~/Downloads/holdings.pdf`). Both must stay out of git.

## Pre-flight findings
- `git log`: no commits; `git remote -v` empty before `gh repo create`.
- The pasted Finnhub key is one 40-char string. I first assumed it was two 20-char keys
  (live + sandbox) and tried the first half: `{"error":"Invalid API key."}`; second half
  also invalid; the full 40 chars returned a GOOG quote (`c=344.59, dp=0.221`). Wrong guess, fixed.
- PDF has 20 holdings (I first said 18; miscounted). Columns: symbol, name, exposure,
  cost basis, market value, day change, unrealized G/L. No quantities/accounts/dates.
- Validation: sum(market_value)=685,600.54; +cash 14,177.37 = 699,777.91 (matches PDF exactly).
  Cost 409,630.85 -> unrealized 275,969.69 vs PDF 275,969.66 (PDF rounding, $0.03).
  Exposure % is relative to total incl. cash (GOOG 51,997.94/699,777.91 = 7.43%).

## Design
- Quantity = market_value / live Finnhub price (user choice); price + timestamp recorded per row.
  Rejected: invent quantities, positions-without-quantity, wait for user-supplied quantities.
- Account split arbitrary: VOO/VTV/VXUS -> m1, rest -> robinhood (17 + 3 rows).
- Privacy: real-derived data in git-ignored `seed/private/`; committed `seed/sample/` is fabricated.
  Rejected: commit scaled/real data (tickers still reveal holdings).

## What was done
- Wrote `.gitignore` before any data file; `git check-ignore -v .env seed/private/x.csv` confirmed both.
- `.env` (git-ignored) holds `FINNHUB_API_KEY`; `.env.example` has it blank.
- `seed/private/holdings.json` hand-transcribed; `python3 scripts/make_seed.py` ->
  `robinhood_positions.csv: 17 rows`, `m1_positions.csv: 3 rows`. `git status` shows neither.
- Added `seed/sample/*`, `docs/TODO.md`, `docs/adrs/0001-*.md`.

## Still to do
See `docs/TODO.md`: app scaffolds, auth, importer, real broker parsers, providers, charts.
Not committed or pushed yet (awaiting user request).

## Gotchas
- Derived quantities use today's price vs. the PDF's earlier market value, so qty*price != MV
  exactly; `price_used` is kept for auditing.
- Key was pasted in chat, so it exists in the session transcript (Hindsight may retain it).
- Seed layout is cinnamon's own, not Robinhood/M1 native exports.
