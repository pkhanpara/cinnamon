# 0014. Angular Material (M3) for the UI, light theme

Status: Accepted (2026-10-08)

## Context

The UI was styled by one 287-line `frontend/src/styles.scss`. It had three colour variables, native `ButtonFace` buttons and inputs, and the system font. It worked, but looked unfinished. About 20 standalone components keep their templates inline in their `.ts` files. Unit specs and Playwright mostly find elements by role and label (`getByRole` 51 times, `getByLabel` 23), plus a few CSS selectors.

Options weighed:

1. **Our own token system in `styles.scss`**: no dependencies and almost no template churn, but every component (dialog, menu, tabs, snackbar) has to be built and kept accessible by hand.
2. **Angular Material (M3)**: the official, accessible components (menu, dialog, tabs, snackbar, button-toggle). M3 theming exposes `--mat-sys-*` CSS variables. Costs: bundle weight and a recognisable Material look.
3. **Tailwind CSS v4**: fast to reach a modern look, but means rewriting ~2.8k lines of inline templates into long class strings.
4. **Spartan/ui (shadcn for Angular)**: the sleekest look, but it brings Tailwind too, is young, and needs a template rewrite like Material.

## Decision

- Use **Angular Material 21 (M3)**, with a single **light** theme: azure primary, Inter Variable (self-hosted through `@fontsource-variable/inter`, no Google Fonts call), density -1.
- Build the app tokens (`--surface`, `--border`, `--muted`, `--gain`, `--loss`, `--radius`, `--shadow`) in `styles.scss` next to the `--mat-sys-*` ones.
- Use Material components where they add behaviour: toolbar, menu, dialog, tabs, button-toggle, snackbar, form fields, checkboxes, chips.
- Restyle native elements to match:
  - **Tables** stay native `<table>`s. Holdings has custom sort and expandable `tr.subrow`s that would be costly to move to `mat-table`.
  - The **symbol-search combobox** stays custom, because it is tested and already accessible.
  - The **charts** read `--gain` / `--loss` / `--muted` at creation time.
- Native buttons and inputs are styled by selectors that skip Material's elements (`:not([class*='mat-'], [class*='mdc-'])`), so both can sit side by side during a gradual migration.
- Roll out in four PRs: shell and theme, forms and Settings, Home, ticker and watchlists.

## Consequences

- The initial bundle goes from 293 kB to 444 kB raw (85 kB to 115 kB transfer) after phase 1, still under the 500 kB warning budget. Later phases add per-route Material modules to lazy chunks.
- Sign out moved into a user menu (`button.who`, then the `Sign out` menuitem). The e2e and shell specs were updated.
- Dark mode is deferred. `color-scheme: light` is forced and the tokens are light-only. A dark theme means a second `mat.theme` block plus a dark copy of the app tokens.
- The Material look carries some "Google" flavour. The custom tokens (radius, shadow, palette) soften it.
