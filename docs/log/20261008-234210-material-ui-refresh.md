# Material UI refresh (ADR 0014)

Status: *done* (all four phases on branch `feat/material-ui`). Follow-ups are listed under Still to do.

## Why

The user said the app "looks hideous, UI looks like barebones". All styling was one 287-line `frontend/src/styles.scss`: three colour variables (`--border`, `--muted`, `--danger`), native `ButtonFace` buttons and inputs, the system font, and no page background. TODO also tracked two related UI issues:

- The header overflowed at phone width (scrollWidth ~690 px at a 390 px viewport).
- `window.confirm` was used for deletes.

## Pre-flight findings

- `npm run build` before any change: initial total **292.96 kB** raw / 85.02 kB transfer; `styles.css` **3.52 kB**.
- About 20 components, all with inline templates (~2.8k lines in total).
- Test selectors:
  - e2e and specs use `getByRole` 51×, `getByLabel` 23×, `getByText` 12×, `locator` 14×.
  - Spec CSS selectors that the shell change affects: `.who`, `header nav a`, the first `button` in the shell being Sign out.
- `@angular/material@21.2.14` matches Angular 21.2. v21 needs no animations package.
- Four options were presented to the user (own tokens, Material, Tailwind, Spartan). The user chose **Angular Material (M3)**, with a **clean fintech light** style.

## Design

See ADR 0014. In short:

- An M3 `mat.theme` (azure, Inter, density -1), with app tokens on top.
- Native controls are restyled with selectors that skip `mat-`/`mdc-` classes, so pages can move to Material one PR at a time.
- Tables, the symbol-search combobox and the charts stay custom (restyled).

Rejected options:

- **Tailwind:** a 2.8k-line template rewrite.
- **Spartan:** young, and needs Tailwind too.
- **`mat-table` for holdings:** custom sort and expandable subrows; high risk for little visual gain.
- **Material Symbols icon font:** the full font is several hundred kB; small inline SVG/CSS glyphs are enough for now.

The plan said "user `mat-menu`". It was kept as planned: avatar + username + admin badge open a menu with *Change password* and *Sign out*.

## What was done

Phase 1:

```
git checkout -b feat/material-ui
cd frontend && npm i @angular/material@~21.2 @angular/cdk@~21.2 @fontsource-variable/inter
# -> @angular/material@21.2.14, @angular/cdk@21.2.14, @fontsource-variable/inter@5.3.0
```

Files changed:

- `src/styles.scss`: rewritten. The M3 theme and tokens (`--bg #f6f7f9`, `--surface`, `--surface-2`, `--border #e4e7ec`, `--text #101828`, `--muted #667085`, `--gain #0f8a4f`, `--loss #d92d20`, `--radius 12px`, `--shadow`).
  - Native buttons get outlined styling; `type=submit` buttons are filled with the primary colour.
  - Inputs, selects and textareas get a focus ring.
  - Cards, tiles and tables are white with soft shadows.
  - Table headers are uppercase and muted, with row hover.
  - `.ranges` becomes a segmented control.
  - The accounts-filter legend becomes a small caps label.
- `angular.json`: adds `node_modules/@fontsource-variable/inter/index.css` to `styles`. The fonts are split by unicode-range, so only the latin woff2 (48 kB) loads for English.
- `src/app/app.html`, `app.ts`, `app.scss`:
  - A `<header>` wrapping a sticky, translucent `mat-toolbar`: brand mark plus "Cinnamon", nav links styled as tabs with the active one underlined, symbol search, and a user `mat-menu`.
  - At 640 px and below the toolbar wraps: brand and user on row 1, nav on row 2, full-width search on row 3.
  - `main` max-width goes from 56rem to 72rem.
- `components/symbol-search`: search icon, rounded panel, accent hover.
- `components/price-chart/lightweight.ts`: gain, loss and compare colours come from CSS tokens via a `token()` helper with fallbacks for jsdom. Grid and crosshair are softer, axis text uses `--muted`.
- `core/donut.ts`: new slice palette led by azure. `Other` stays `#9ca3af`, which `donut.spec` asserts.
- `components/portfolio-chart`: the SPY swatch uses `var(--muted)`.
- Specs:
  - `app.spec.ts`: opens the menu, expects the menuitems `Change password` and `Sign out`.
  - `e2e/{first-login,returning-user}.spec.ts`: Sign out is `button.who`, then `menuitem` "Sign out".

The first e2e run after the shell change failed 2 tests:

- `header nav a` → 0 elements, because there was no `<header>` any more. Fixed by wrapping the toolbar in `<header>`.
- `getByRole('link', { name: 'Home' })` resolved to 2 elements: the brand link had `aria-label="Cinnamon home"`. Fixed by dropping the aria-label, so the brand's accessible name is "Cinnamon".

Results:

```
npm run format:check   # All matched files use Prettier code style!
npm run typecheck      # ok
npm run test:ci        # 231 passed (27 files)
npm run e2e            # 19 passed (incl. the first-login console/HTTP audit)
npm run build          # styles 18.15 kB; Initial total 444.26 kB raw / 115.30 kB transfer (budget warn 500 kB)
```

Real-browser check: a throwaway stack (backend :8340, empty SQLite in the scratchpad, `ng serve` :4340 with `e2e/proxy.e2e.mjs`, no Finnhub key), seeded with `seed/sample/robinhood_positions.csv` and `m1_positions.csv` plus a watchlist. Screenshots at 1280×900 and 390×844 of login, home, `/symbol/ORCL`, watchlists, accounts and users. `scrollWidth/innerWidth`:

| page | desktop | phone |
|---|---|---|
| home | 1280/1280 | 390/390 (was ~690 from the header) |
| symbol | 1280/1280 | 390/390 |
| watchlists | 1280/1280 | **400/390** (page content, not the header; phase 4) |
| accounts / users | 1280/1280 | 390/390 |

### Phase 2 (2026-10-08 23:55)

Files changed:

- `components/confirm-dialog/confirm-dialog.ts` (new): `ConfirmService.ask({ title, message, confirm, danger })` resolves `true` only on confirm. It is a `MatDialog` with Cancel and a red confirm button for destructive actions. The new spec opens it and clicks each button (2 tests).
  - It replaces `confirm()` in `pages/accounts/accounts.ts` (delete account) and `pages/watchlists/watchlist.ts` (delete list).
  - Specs now spy on `ConfirmService.ask` instead of `window.confirm`.
  - E2E clicks `getByRole('dialog').getByRole('button', { name: 'Delete' })` instead of `page.once('dialog')`.
- `pages/login`: a centred card with a logo, `mat-form-field`s and a full-width `mat-flat-button`.
- `pages/change-password`: `mat-form-field`s and a `mat-flat-button`.
- `pages/settings`: the sidebar becomes a `mat-tab-nav-bar` (not stretched, start-aligned, with tighter tab padding at 640 px or less so all three tabs fit at 390 px).
- `pages/accounts`, `pages/users`:
  - Material fields.
  - Import as a filled button, Rename / Reset password / Make admin as stroked buttons, Delete / Deactivate as red text buttons.
  - Administrator is a `mat-checkbox`.
- `pages/import`:
  - Format becomes a `mat-form-field` with `select matNativeControl` (spec `querySelector('select')` still works). The connector description is shown as `mat-hint`.
  - The file input becomes a dashed drop zone, with the native input stretched transparently over it so `input[type=file]` stays in place for e2e.
  - Average-cost inputs get a `$` prefix.
- `core/material.ts` (new): `FORM_FIELD_DEFAULTS` (outline, dynamic subscript, no required asterisk), provided by `Login` and the `Settings` shell. Routed children inherit it through the outlet.
- `styles.scss`:
  - Button/form-field/dialog/tabs overrides: 8 px corners, 2.5 rem buttons, `#d0d5dd` outlines, white dialog surface, no tab divider.
  - The global `label` rule skips Material labels.
  - Card spacing tweaks; muted `mat-hint`.

Bundle: providing `MAT_FORM_FIELD_DEFAULT_OPTIONS` in `app.config.ts` pushed the initial bundle to **528.39 kB**, which triggered the 500 kB budget warning. The import drags Material's form-field code into the initial chunks. Removing it measured **468.54 kB**. The token now lives in `core/material.ts`, and only lazy pages provide it. Final initial total: **468.54 kB raw / 124.69 kB transfer**.

Results:

```
npm run format:check   # All matched files use Prettier code style!
npm run typecheck      # ok
npm run test:ci        # 235 passed (233 + 2 ConfirmService)
npm run e2e            # 20 passed (2 failed first: both waited for a native dialog event; fixed as above)
npm run build          # 468.54 kB initial, no budget warning
```

Screenshots (same throwaway stack, port 4340) of login, accounts, users, change-password, import, the import preview and the delete dialog, at 1280 and 390 px: no horizontal scroll on any of them.

### Phase 3: Home (2026-10-09 00:04)

Files changed:

- `pages/holdings`:
  - The account filter uses `mat-checkbox`. Its `aria-label` input lands on the inner `<input type=checkbox>`, so the spec's `input[type=checkbox]` lookup and e2e `getByRole('checkbox', { name })` are unchanged. "All" keeps `indeterminate`.
  - The chart and a new **Allocation** card (the donut) sit side by side in a `.dash` grid: 2fr / ≥16rem, one column below 56rem.
  - The expand toggle becomes a small square icon button.
  - The symbol column gets a 10rem minimum width, so phones scroll the table sideways instead of wrapping each name over 4–5 lines.
- `components/portfolio-chart`:
  - Ranges become a `mat-button-toggle-group.ranges.seg`. Its buttons have role `radio` (not `button`) and are found by `.ranges button`, as before.
  - "Compare with SPY" becomes a `mat-slide-toggle` (`button[role=switch]`); the spec clicks `.spy button[role=switch]`.
  - The title, hint and toggle share one header row.
- `styles.scss`:
  - `button-toggle-overrides` for a quiet segmented control (transparent, 8 px corners, selected = accent tint).
  - The old `.ranges` rules are scoped to `:not(.seg)` (the ticker page still uses them until phase 4).
  - Slide-toggle label gap.

**Bug found and fixed (pre-existing on `main`).** With "Compare with SPY" on, switching range (1M → 6M) blanked the portfolio chart. The browser console showed `ERROR Error: Value is null` from lightweight-charts' `Area` style getter (`ensureNotNull(findBar(...))`).

- Reproduced on `main` in a temporary worktree (`git worktree add <scratch>/wt-main main`, `ng serve --port 4341` against the same throwaway backend). Same two errors, so the restyle did not cause it.
- The API returns identical times for the portfolio and SPY points, so the data is not the problem.
- Cause: the overlay line series still held the previous range's times when the area series received the new ones.
- Fix in `components/price-chart/lightweight.ts` `setData`: `compare?.setData([])` before `series.setData(...)`. The caller (`portfolio-chart`) sets the overlay again straight after.
- Re-ran the repro: no console errors, and both lines draw at 6M.
- The ticker page uses the same wrapper but never sets an overlay, so it is unaffected.
- jsdom has no canvas, so this has no unit test. It belongs in the Playwright chart case still listed in TODO.

Results:

```
npm run format:check   # All matched files use Prettier code style!
npm run typecheck      # ok
npm run test:ci        # 235 passed
npm run e2e            # 20 passed
npm run build          # 469.64 kB initial / 125.11 kB transfer
```

Screenshots of Home at 1280 and 390 px, plus SPY on at 6M: 1280/1280 and 390/390.

### Phase 4: ticker page, Ask AI, principles, watchlists (2026-10-09 00:08)

Files changed:

- `pages/symbol`:
  - The name, price, a new delta pill (tinted green or red), add-to-watchlist, warnings, ranges and chart sit in one `.hero` card.
  - Ranges become the same `mat-button-toggle-group.seg` as Home. Its buttons are radios, so the spec now checks `aria-checked` instead of `aria-pressed`.
  - The principles panel and News are card blocks; news items get dividers and a small Refresh button.
- `components/news-chat`:
  - "Ask AI" is a floating `mat-flat-button` pill (✦).
  - The panel gets the surface, shadow and header rule; presets are pill buttons; the log is a grey well with chat bubbles (the user's turns on the right in the accent colour).
  - Native textarea, checkbox and buttons are kept: the 26 specs query them.
- `components/principles-panel`: statuses become tinted pills (pass green, fail red, warn/unsure amber, others grey) built from the tokens; `details` sections become bordered boxes.
- `components/add-to-watchlist`: spacing only. The native `select` + button are kept, because the spec queries `select`/`option`.
- `pages/watchlists`:
  - The create form wraps.
  - Lists show as cards, the whole card being the link, with the symbols as tags.
  - This fixes the 10 px overflow at 390 px: it was the unwrapped `Name` label + input + button row.
- `pages/watchlists/watchlist`:
  - Rename and Delete become real buttons (Delete in red) on the right of the title.
  - The "Show only symbols that pass" checkboxes become toggle chips. The native checkbox is visually hidden inside each label, so `fieldset label` and the checkbox semantics stay.
  - Status colours come from the tokens.
- `styles.scss`: removed the now-unused `.ranges:not(.seg)` button rules.
- e2e `watchlists.spec.ts`: the overview text `2 symbols · JNJ, KO` became `2 symbols` plus tags `JNJ`, `KO`.

Deviation from the plan: no `mat-chip` or `mat-menu` here. The status pills are static labels and the filter chips are plain checkboxes. Material chips would add listbox/grid semantics, and spec churn, for no visual gain. Add-to-watchlist stayed a select, because its spec is built around it.

Results:

```
npm run format:check   # All matched files use Prettier code style!
npm run typecheck      # ok
npm run test:ci        # 235 passed
npm run e2e            # 20 passed (1 failed first: the watchlist overview text, updated as above)
npm run build          # 469.29 kB initial / 125.08 kB transfer
```

Screenshots (throwaway stack started with `LLM_BASE_URL`/`LLM_MODEL` so Ask AI shows; no question was sent): `/symbol/ORCL`, `/watchlists`, `/watchlists/1` and the open Ask AI panel at 1280 and 390 px. 1280/1280 and 390/390 on every page.

## Still to do

- Phase 2 leftovers:
  - Snackbars were **not** adopted. The transient notices (`Password changed.`, `Created bob…`, `Imported N position(s)`) are inline `role=status` text that 5 unit specs and the e2e suite assert on, and they read fine inline. Revisit if a toast is wanted.
  - The rename and reset-password inline inputs are still native inputs (styled).
- Chat bubbles were not seen with real messages: no question was sent to the model during the check. Look once in the dev app.
- Principles table, watchlist scores and News were only seen in their no-Finnhub-key state. Check the pills and table with real data in the dev app (which has a key).
- On the ticker page the floating Ask AI button can sit over the bottom-right of a card while scrolling. That is acceptable for a floating button; add bottom padding if it bothers.
- Follow-ups: a dark theme (a second `mat.theme` block and dark tokens); optionally `mat-table` for holdings.

## Gotchas

- `mat-toolbar` styles `h1` through its own title token, so a plain `h1 {}` rule in `app.scss` lost on weight. It needs `.bar .brand h1`.
- The global `input:not(...)` selector has the same specificity as component-scoped `input[_ngcontent]`, so `symbol-search` uses `!important` for its padding and icon background.
- A brand link whose accessible name contains "Home" breaks `getByRole('link', { name: 'Home' })` (substring match). Keep the brand's name "Cinnamon".
- ADR number clash: written as 0013, but #22 (Robinhood import) landed ADR 0013 on main first; renumbered to 0014 when rebasing.
- **Lockfile and npm versions.** The first CI run of PR #23 failed `npm ci` in seconds on both frontend jobs: `Missing: @emnapi/core@1.11.3 from lock file`, `Missing: @emnapi/runtime@1.11.3`. The lockfile came from local `npm i` with **npm 11.6.2** (Node 24.4.1), which dropped those two optional peer entries that `main`'s lockfile had. CI runs Node 22 / **npm 10**, which requires them.
  - Fix: restore `main`'s lockfile, then `npx -y npm@10 install --package-lock-only --ignore-scripts` (+45/−2 lines; only cdk, material and fontsource added).
  - Verified with `npm@10 ci` and `npm@11 ci` in clean scratch copies: both `added 480 packages`.
  - Next time, add dependencies with `npx npm@10 install …` or check with `npx npm@10 ci` before pushing.
- Anything imported from `@angular/material/*` in `app.config.ts` (even just an InjectionToken) moves that entry point into the initial bundle. Provide Material config from lazy components instead (`core/material.ts`).
- `mat-tab-nav-bar` stretches tabs by default (`mat-stretch-tabs="false"` turns it off) and paginates with arrows at 390 px unless the tab padding is reduced.
- `mat-button-toggle` buttons have role `radio` in a single-select group: Playwright needs `getByRole('radio', { name: '6M' })`.
- lightweight-charts: replacing an area series' data while a second series on the same chart still holds other times throws `Value is null` at paint time. Clear the other series first.
- Without `FINNHUB_API_KEY`, `/symbol/<ticker>` only renders for symbols you hold. Use a held symbol (ORCL in the sample seed) for screenshots.
