# Principles panel: cash-flow charts in cards with year and value labels

Status: done, PR open. Branch `feat/cashflow-chart-cards`, worktree `~/.herdr/worktrees/cinnamon/feat-cashflow-chart-cards`.

## Why

TODO (Ticker page and watchlists): under "Cash flows, acquisitions and R&D by year (10-K)" the 7 bar charts from `20261010-023028-insider-cashflow-charts.md` could not be read year over year, and they sat loosely in a grid.

Cause, in `components/principles-panel/year-bars.ts`: the whole chart, text included, was a 320x140 SVG `viewBox` scaled to the cell width. In a 16rem cell the 10-unit labels rendered at about 8 px, and past 6 years they became `'21`. The only way to see a bar's value was to hover over it (`<title>`) or read the "latest" caption. The charts had no frame of their own.

## Design

- **Bars and labels are HTML/CSS, not SVG.** `barChart()` (`core/bar-chart.ts`, unchanged) is called with a 100x100 box, so its `zeroY` and `h` are percentages. Positive bars get `bottom: (100 - zeroY)%` and grow up from the zero line, so a 1 px minimum height also grows up. Negative bars get `top: zeroY%`. Labels are absolutely positioned spans at real CSS size (0.7rem, 0.62rem below a 19rem card width via a container query). They never scale down with the chart.
  - Rejected: keep the SVG and measure the card (ResizeObserver) to draw text in real pixels. That adds more code, and jsdom has no ResizeObserver.
- **Each series is a card** (`figure.chart-card`): title, the latest value in compact money (`2025: -$95B`), a unit line, bars with a value label each, and a year row with full 4-digit years. Only local CSS with the existing tokens (`--surface`, `--border`, `--radius-sm`). No shadow, because the panel is already a `card-block`, and no Material.
- **One unit per chart** (`value-unit.ts`, new): picked from the largest |value| (USD trillions/billions/millions/thousands/USD). Labels show one decimal below 10 and whole numbers from 10 (`-2.3`, `27`, `110`). A non-zero value that rounds to nothing prints `<0.1` / `-<0.1`. Exact amounts stay in the column's hover title, the aria-label and the table.
  - First tried one decimal below 100: at 390 px, `-50.0`-style labels in the Financing card touched (see Results), so whole numbers start at 10.
  - The `Intl.NumberFormat` pins both min and max fraction digits (the Node 22 ICU gotcha from the previous log).
- Accessibility: the plot is `role="img"`, and its aria-label is the same string as before (every year, compact money). Value and year labels are `aria-hidden`. The minus sign is printed, so colour is not the only cue.
- Grid: `minmax(min(19rem, 100%), 1fr)`, gap 1rem. That gives 3 cards per row at 1280 px and 1 per row on a phone.
- No ADR: a component-local UI change with no new dependency or data model.

## What was done

Files: `frontend/src/app/components/principles-panel/year-bars.ts` (rewritten), `value-unit.ts` (new), `value-unit.spec.ts` (new), `year-bars.spec.ts` (new), `principles-panel.ts` (grid CSS), `principles-panel.spec.ts` (chart test rewritten for the new DOM), `docs/TODO.md`.

Edge cases covered by specs: a whole series null ("No data" card, no unit), one year, all zero (baseline at the bottom, no 1 px minimum, labels `0`), mixed signs (positions and label offsets asserted), a null year inside a series (slot kept, `n/a`, "no data" in aria, latest skips it), a tiny value next to a huge one (1 px minimum, `<0.1` / `-<0.1`), ten 4-digit years, unit per magnitude, and the rounding boundary 9.96 -> `10`.

## Results

```
npm run format:check                         All matched files use Prettier code style!
npm run typecheck                            exit 0
npm run test:ci                              Test Files 32 passed (32)  Tests 286 passed (286)
node@22 (v22.23.3) ng test --watch=false     Test Files 32 passed (32)  Tests 286 passed (286)
npm run build                                Application bundle generation complete (Initial total 474.82 kB, no warnings)
e2e (8321/4321, /tmp/cinnamon-e2e-8321)      23 passed (23.8s)
```

Visual check: headless Chromium against `ng serve --port 4320` (`CINNAMON_BACKEND_PORT=8320`), every `/api` call mocked: 10 years, a negative 2020 net income, a null 2022 R&D, all-null acquisitions, values from $2.3B to $110B. The script measured label boxes:

```
first try (1 decimal below 100):
  wide   1280px overflow 0, 7 cards, 3 per row, card 349px, labels 11.2px, no overlaps, no errors
  narrow  390px overflow 0, 7 cards, 1 per row, card 285px, labels 9.92px, valOverlap in card 4 (Financing: "-50.0" ... "-95.0")
after (1 decimal below 10):
  wide   overflow 0, valOverlap none, yearOverlap none, clipped none, errors []
  narrow overflow 0, valOverlap none, yearOverlap none, clipped none, errors []
  net income labels: 27 34 41 48 -2.3 62 69 76 83 90; years 2016 ... 2025
```

Screenshots showed oldest year on the left, the negative 2020 bar under the zero line with its label below, red financing bars hanging from the top line with labels underneath, `n/a` in the 2022 R&D slot, and the Acquisitions card with "No data".

## Still to do

- Look at the charts with real Finnhub data (only mocked data so far). Already in TODO.md.
- Optional Revenue chart and a Playwright case with a mocked principles API. Already in TODO.md.

## Gotchas

- `pkill -f "ng serve --port 4320"` in a Bash call kills that call's own shell, because its command line contains the pattern (exit 144). Stop the background task another way.
- Element screenshots of a tall element at 390 px overlap the sticky header. That is a screenshot artefact; the page itself had no horizontal overflow.
