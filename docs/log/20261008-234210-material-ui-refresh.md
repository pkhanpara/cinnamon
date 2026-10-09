# Material UI refresh (ADR 0014)

Status: *in progress*. Phases 1 (theme and shell) and 2 (forms, Settings tabs, confirm dialog) are done on branch `feat/material-ui`. Phases 3–4 are pending.

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

## Still to do

- Phase 2 leftovers:
  - Snackbars were **not** adopted. The transient notices (`Password changed.`, `Created bob…`, `Imported N position(s)`) are inline `role=status` text that 5 unit specs and the e2e suite assert on, and they read fine inline. Revisit if a toast is wanted.
  - The rename and reset-password inline inputs are still native inputs (styled).
- Phase 3 (Home):
  - Account filter with `mat-checkbox`.
  - Chart and donut in cards.
  - Ranges as `mat-button-toggle-group`, and SPY as `mat-slide-toggle`.
  - Expand toggle as an icon button.
  - The holdings symbol column wraps a lot at 390 px.
- Phase 4:
  - Ticker page: header card and range toggle.
  - The `Ask AI` floating button.
  - News-chat panel, principles chips, watchlist cards and filter chips.
  - Fix the 10 px overflow on watchlists at 390 px.
- Follow-ups: a dark theme (a second `mat.theme` block and dark tokens); optionally `mat-table` for holdings.

## Gotchas

- `mat-toolbar` styles `h1` through its own title token, so a plain `h1 {}` rule in `app.scss` lost on weight. It needs `.bar .brand h1`.
- The global `input:not(...)` selector has the same specificity as component-scoped `input[_ngcontent]`, so `symbol-search` uses `!important` for its padding and icon background.
- A brand link whose accessible name contains "Home" breaks `getByRole('link', { name: 'Home' })` (substring match). Keep the brand's name "Cinnamon".
- ADR number clash: written as 0013, but #22 (Robinhood import) landed ADR 0013 on main first; renumbered to 0014 when rebasing.
- Anything imported from `@angular/material/*` in `app.config.ts` (even just an InjectionToken) moves that entry point into the initial bundle. Provide Material config from lazy components instead (`core/material.ts`).
- `mat-tab-nav-bar` stretches tabs by default (`mat-stretch-tabs="false"` turns it off) and paginates with arrows at 390 px unless the tab padding is reduced.
- Without `FINNHUB_API_KEY`, `/symbol/<ticker>` only renders for symbols you hold. Use a held symbol (ORCL in the sample seed) for screenshots.
