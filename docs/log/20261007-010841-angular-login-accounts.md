# Angular login, setup and accounts screens

## Why
The auth backend (3a96f3d) was unusable from a browser. Phase 2 needs a UI: first-run setup,
login/logout, and account management.

## Pre-flight findings
- `git push` of 3a96f3d: `391e830..3a96f3d main -> main`.
- Frontend had only the health-check shell; `app.routes.ts` was empty; Angular 21, vitest runner.

## Design
- `core/`: `AuthService` (signal `user`, `ensureLoaded()` caches `/auth/me` once per page load),
  `authGuard` (signed out -> `/setup` if `setup_required` else `/login`), `guestGuard`
  (signed in -> `/accounts`), `authInterceptor` (401 on non-`/api/auth/*` call -> clear + `/login`;
  auth endpoints exempt so a wrong password isn't treated as an expired session),
  `AccountsService`, `apiError()` mapping FastAPI `{detail}` to UI text.
- Pages are lazy-loaded standalone components with reactive forms and signals.
- Platform field is a free-text input with a datalist (robinhood, m1) because the backend only
  slug-validates it until the connector registry exists. Rejected: hard-coded `<select>`.
- Not built (not asked): admin Users page. Backend endpoints exist; TODO.md has it.
- Removed the `/api/health` status indicator from the shell; its test was replaced.

## What was done
- Unit tests: `ng test` -> first run `18 passed, 1 failed`.
  Failure: `NG0203 Router token injection failed` in `guestGuard`. REAL bug: it called
  `inject(Router)` after `await`, outside the injection context, so a signed-in user opening
  `/login` would have thrown instead of redirecting. Fixed by injecting before the await. Then `19 passed`.
- Real-browser E2E (agent-browser, fresh SQLite DB via alembic, `ng serve` + uvicorn):
  - `/` -> redirected to `/setup`; short password keeps button disabled.
  - setup -> `/accounts`; add account; reload keeps the session; `document.cookie` is `""` (HttpOnly).
  - duplicate nickname -> alert "You already have an account with that nickname".
  - Sign out -> `/login`; `/accounts` while signed out -> `/login`; wrong password stays on `/login`
    with "Invalid username or password"; right password -> `/accounts`;
    signed-in visit to `/login` -> `/accounts` (confirms the guestGuard fix live).
  - Delete showed `confirm("Delete "Main brokerage"? ...")`; after accepting, empty state appeared; adding "Retirement"/m1 worked.
  - Screenshot showed "poojan(admin)" with no space; fixed in `app.html`.

## Still to do
Admin Users page, in-app delete dialog, rebuilding/verifying the Docker image with the UI, CI. See `docs/TODO.md`.

## Gotchas
- `pkill -f` in the same shell command killed my own shell twice (exit 144); the first time the
  cleanup never ran, leaving servers down and the dialog open. Use saved PIDs instead.
- `agent-browser dialog accept` must run AFTER the click that opens the dialog; before it, it is a no-op
  and the page stays blocked.
- Angular CLI 22 needs Node >= 24.15; staying on 21 (see earlier log).
