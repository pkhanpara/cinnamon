# 0017. SEC EDGAR as a fundamentals provider

Status: Accepted (2026-10-10)

## Context

The principles scorecard (ADR 0012) reads 10-K figures from Finnhub `/stock/financials-reported`, which wraps the same XBRL that companies file with the SEC. That works, but:

- It gives about 16 years and goes through the shared Finnhub budget (55 calls/min for quotes, profiles, news, metrics and fundamentals together).
- EPS is as reported, not split-adjusted, and owner-earnings adjustments need tags Finnhub's flattened report doesn't always keep.
- The watchlists phase 2 screener would need one Finnhub call per symbol per metric (hundreds of calls).

ADR 0012 already named SEC EDGAR as the fallback if Finnhub's free tier shrinks. EDGAR's JSON APIs are free and keyless:

- `companyfacts`: every XBRL fact a filer ever reported, per concept and unit, with fiscal year/period, form and filing date.
- `frames`: one concept for all filers in one call.
- `submissions`: the filing index.

EDGAR's conditions (SEC "Accessing EDGAR Data"):

- A `User-Agent` naming the requester with a contact email. Generic agents get HTTP 403.
- At most 10 requests per second.
- Lookups are by CIK, not ticker. The ticker -> CIK map is `https://www.sec.gov/files/company_tickers.json`, and the APIs live on `data.sec.gov`.

## Decision

- **Opt-in through `SEC_USER_AGENT`** (`config.py`, `.env.example`).
  - `get_edgar_provider()` returns None when it is unset, as Finnhub providers do without a key.
  - A value that isn't printable ASCII (1-200 characters) containing an `@` also disables EDGAR, with one warning in the log.
  - There is no built-in default. A shared string across every install would get all of them blocked together, and the contact must be the operator's own.
- **`providers/edgar.py` `EdgarProvider`**, behind a new `SecFilingsProvider` Protocol in `providers/base.py` (`cik_for`, `get_company_facts`). Like the other providers it never touches the database.
  - **Ticker -> CIK:**
    - `company_tickers.json` is cached for 24 h in an in-process `TTLCache` (stale-on-error, single-flight).
    - Symbols are normalized to SEC's form (upper case, `BRK.B` -> `BRK-B`) and validated before any lookup, so a bad symbol never reaches a URL.
    - For a ticker listed twice, the first row wins (SEC orders the file by size).
    - A map with no valid rows is an error and is never cached.
  - **Company facts:** `get_company_facts(symbol)` fetches `CIK##########.json` and keeps only annual us-gaap data:
    - forms 10-K and 10-K/A with `fp == "FY"`;
    - units `USD`, `USD/shares` and `shares`;
    - typed `Fact`s (end, start, Decimal value, fy, fp, form, filed, frame), newest period end first, then newest filing.
    - Rows with bad dates, non-numeric or non-finite values are dropped.
    - A filer without us-gaap facts (IFRS 20-F filers) gives empty facts.
    - The provider does not cache facts. The caller stores them like other fundamentals (`fundamentals_cache`, 24 h).
  - **Throttle:** at least 1/8 s between requests (≤ 8 req/s, under SEC's 10), as a process-wide slot reservation on the one provider instance.
    - It is precise below a second, unlike `SlidingWindowLimiter`'s whole-second `retry_after`.
    - A caller that would wait more than 10 s gets a ProviderError instead of hanging a page.
  - **HTTP:**
    - One pooled `httpx` client with the User-Agent and `Accept-Encoding: gzip, deflate`, a 15 s timeout, and two connect retries.
    - Responses map to ProviderError: 403 (with a hint to check `SEC_USER_AGENT`), 429, other non-200s, network errors and invalid JSON. A 404 means "no data".
    - Decoded bodies are capped at 50 MB. Large filers' companyfacts run to several MB.
- **Precedence vs Finnhub (applied when `fundamentals.py` is wired, a later TODO item):**
  - For 10-K line items, EDGAR companyfacts wins when EDGAR is enabled and has the filer.
  - For the same fiscal period, an original 10-K is preferred over a 10-K/A. The amendment is used only when it is the only filing (the same rule ADR 0012 applies to Finnhub's reports). A later 10-K's restated comparative is not preferred over the original either.
  - Finnhub as-reported stays the fallback when EDGAR is disabled, errors, or has no CIK for the symbol (funds, most foreign listings).
  - Finnhub remains the source for `metric` ratios, peers and insider trades. yfinance remains the source for splits, which the wiring step uses to split-adjust EDGAR EPS.
- No schema change and no migration in this step.

## Consequences

- New outbound hosts `www.sec.gov` and `data.sec.gov`, used only when the operator opts in. The contact string is sent to the SEC with every request.
- The throttle and the ticker-map cache are per process, like the Finnhub budget and `cache.py`. That is fine for the single-process deployment, but several workers would each get 8 req/s.
- Nothing calls the provider yet: this PR is the client plus the decision. The next items are:
  - companyfacts into `fundamentals.py` (more years, split-adjusted EPS, owner-earnings tags);
  - `frames` for the screener;
  - a `submissions` filings list on the ticker page;
  - 13F holders.
- ETFs and funds have no companyfacts, so the scorecard keeps treating them as it does today.
- Fiscal years: `fy` is the fiscal year of the *filing*, so a 10-K's prior-year comparatives carry the later `fy`. Consumers should key on the period `end` (and `start` for duration facts), not on `fy` alone.
