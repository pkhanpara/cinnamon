# Principles panel: insider "All trades" toggle, Net in $M, yearly cash-flow bar charts

Status: done, PR open. Branch `feat/insider-cashflow-charts`, worktree `~/.herdr/worktrees/cinnamon/feat-insider-cashflow-charts`.

## Why

On the ticker page the principles panel (`frontend/src/app/components/principles-panel/principles-panel.ts`) lists every insider trade in an "All trades" table under the summary. For an active name that is hundreds of rows, and it pushes the cash-flow evidence far down the page. The Net line prints whole dollars (`-$27,631.00`, or `-$1,234,567,890.00` for a big seller), which is hard to read at a glance. The "Cash flows, acquisitions and R&D by year (10-K)" section is a table with 8 columns and up to 10 rows; a trend (rising buybacks, shrinking operating cash) cannot be seen without reading every cell.

## Pre-flight findings

Resumed from the plan of 2026-10-09 (session hit a usage limit before editing). Re-checked on `dcdd1e1`:

- Year order the backend sends is **newest first**:
  - `backend/app/fundamentals.py:112` `years: tuple[YearFacts, ...] = ()  # newest first`
  - `backend/app/fundamentals.py:239` `years=tuple(year_facts(r) for r in sorted(reports, key=lambda r: r.year, reverse=True))`
  - `backend/app/api/principles.py:200` `for y in core.years[:10]`
  So the charts reverse a copy (oldest left, newest right); the table keeps newest first.
- All 7 series are already in `CashYear` (`frontend/src/app/core/models.ts:277`): `net_income, owner_earnings, cfo, cff, acquisitions, buybacks, rnd`. No backend or API change.
- `core/format.ts` has `fmtSigned`, `fmtCompactMoney` (consts), no signed-millions formatter.
- localStorage pattern to follow: `core/account-selection.ts` (try/catch around get/set).

## Design

- **Inline SVG rendered by an Angular component**, geometry in a pure helper `core/bar-chart.ts`.
  - Rejected: lightweight-charts (`components/price-chart`, `CHART_FACTORY`). Canvas, so untestable in jsdom; lazy-loaded; built for time series with zoom/crosshair, which 7 charts of ≤10 bars don't need.
  - Rejected: CSS-width bars. Negative values below a zero baseline and null gaps are simpler with SVG coordinates.
  - Rejected: a chart library (Chart.js etc.): a new dependency for static bars; also npm lockfile churn (see memory note on npm 10 lockfile).
- Domain is `[min(0, min), max(0, max)]` so the zero line is always visible; null keeps its slot (a gap, "n/a" label) so years line up across the 7 charts.
- Accessibility: `<figure>`/`<figcaption>`, SVG `role="img"` with an aria-label listing every year's value, `<title>` per bar for hover, gain/loss colour plus printed sign.
- Insider Net: `fmtSignedMillions` (1 decimal, always M, sign except zero), full value in the `title` attribute.
- "All trades (N)" toggle: a `<button aria-expanded aria-controls>`, collapsed by default, table not rendered while collapsed. Persisted globally (not per symbol) at `localStorage['cinnamon.principles.allTrades']`; storage failures fall back to in-memory.
- No ADR: a component-local UI change with no new dependency or data model.

## What was done

Files touched: `frontend/src/app/core/format.ts` (+spec), `frontend/src/app/core/bar-chart.ts` (+spec, new), `frontend/src/app/components/principles-panel/year-bars.ts` (new), `principles-panel.ts` (+spec), `docs/TODO.md`.

1. `fmtSignedMillions` in `core/format.ts`. Checked Intl first:
   ```
   $ node -e '...signDisplay:"exceptZero",min/maxFractionDigits:1... f.format(v/1e6)+"M"'
   -27631 $0.0M        <- sign lost, see Gotchas
   450000 +$0.5M
   -1234500000 -$1,234.5M
   12300000 +$12.3M
   ```
   So a non-zero amount under $50K prints `-<$0.1M` / `+<$0.1M`.
2. `core/bar-chart.ts`: pure layout (`barChart(points, {width,height,top,bottom})` -> bars, zeroY, empty). 8 specs: all positive, mixed signs (zero line at 85 of 10..110 for 300/-100), all negative, slot spacing, null gap, all null, all zero, one year.
3. `year-bars.ts` (`app-year-bars`): viewBox 320x140 scaled to 100% width, `role="img"` + aria-label with every year, `<title>` per bar, zero line, year labels (`'21` style past 6 years), "n/a" for gaps, "No data" when the whole series is null, latest value in the caption.
4. Panel: Net line above the toggle in $M with the full amount as `title`; "All trades (N)" `<button aria-expanded aria-controls="pr-all-trades">`, table rendered only when open, persisted at `localStorage['cinnamon.principles.allTrades']` ('1'/'0'); 7 charts in an auto-fill grid (`minmax(min(16rem, 100%), 1fr)`) above the unchanged table, fed by a `computed` that reverses the newest-first years.
5. Results:
   ```
   npm run test:ci        Test Files 29 passed (29)  Tests 249 passed (249)   (+1 SVG-namespace assertion added after, panel spec 12/12)
   npm run format:check   All matched files use Prettier code style!
   npm run typecheck      clean
   npm run build          Application bundle generation complete, no warnings
   backend: ruff check    All checks passed!   ruff format --check  82 files already formatted
            pytest        508 passed, 1 warning in 49.12s
   e2e (8341/4341, /tmp/cinnamon-e2e-8341)   20 passed (17.3s)
   ```
6. Real browser (headless Chromium via Playwright, `ng serve --port 4342`, every `/api` call mocked with route interception: 10 years incl. a negative net income, a null R&D year, acquisitions in 2 years; 40 insider trades, net -12,345,678.90):
   ```
   wide   1280px { overflow: 0, tableRows: 40, figures: 7, errors: [] }
   narrow  390px { overflow: 0, tableRows: 40, figures: 7, errors: [] }
   aria-expanded after reload: true   (toggle remembered)
   ```
   Screenshots showed oldest year on the left, the negative bar below the zero line, red financing bars, "n/a" gaps, Net `-$12.3M`, a single chart column at 390px.

7. CI fix (PR #25 run 38042056502, Frontend test:ci, 1 failed / 248 passed):
   ```
   Expected: "Financing cash by fiscal year, oldest first: 2023 -$400M, 2024 -$400M, 2025 -$1.5B"
   Received: "... 2023 -$400.00M, 2024 -$400.00M, 2025 -$1.50B"
   ```
   CI uses Node 22 (`NODE_VERSION: '22'` in ci.yml), local is Node 24.4.1 / ICU 77.1. Reproduced locally:
   ```
   $ npx -y node@22 -e '...notation:"compact",maximumFractionDigits:2...'
   v22.23.3 78.3 -$400.00M -$1.50B | fixed: -$400M -$1.5B $2B $5.77T
   ```
   Fix: `minimumFractionDigits: 0` on `compactMoney` and `compactNumber` in `core/format.ts` (`signedMillions` already pins 1/1). New format spec with exact strings (`-$400M`, `-$1.5B`, `$2B`, `$0`, `2M`) that fail on the old options under Node 22. Full suite under Node 22 (`npx -y node@22 node_modules/@angular/cli/bin/ng.js test --watch=false`): 250 passed; under Node 24 `test:ci` 250 passed, format:check, typecheck, build clean.

## Still to do

- Look at the charts with real Finnhub data in the dev app (only mocked data so far). In TODO.md.
- Optional: Revenue chart, Playwright case with a mocked principles API. In TODO.md.

## Gotchas

- Intl `signDisplay: 'exceptZero'` drops the sign when the value *rounds* to zero, so a -$27,631 net sale read `$0.0M`. Hence the `<$0.1M` branch.
- jsdom's `querySelectorAll('rect')` also matches an HTML-namespaced `<rect>`, so a test that only counts rects would not catch an SVG namespace bug; the spec asserts `namespaceURI` is SVG.
- `preserveAspectRatio="none"` with a fixed CSS height stretched the year labels; uniform scaling (`height: auto`) instead.
- The symbol page renders the panel only after `/api/symbols/<sym>` loads, so a mocked check must mock that too.
- The app has no dark theme (no `prefers-color-scheme` in `styles.scss`), so `colorScheme: 'dark'` screenshots are the same as light.
- `Intl.NumberFormat` with `style: 'currency', notation: 'compact'` and only `maximumFractionDigits` is not deterministic across Node/ICU builds: Node 22 (ICU 78.3) pads to the currency's 2 digits (`$400.00M`), Node 24 (ICU 77.1) does not. Always pin `minimumFractionDigits` too. This also changed what real users see in the existing cash-flow table and market-cap cells on such engines.
- Running two Bash calls in parallel that each `cd` raced on the shared shell: the e2e run started in `backend/` and failed with ENOENT on package.json. Run it alone.
