# e2e: configurable ports and work dir

Status: done. Branch `chore/e2e-configurable-ports`. TODO item: "Make the e2e ports in
playwright.config.ts configurable #chore".

Touched: `frontend/playwright.config.ts`, `frontend/e2e/proxy.e2e.mjs` (new),
`frontend/e2e/proxy.e2e.json` (removed), `CLAUDE.md` (Testing notes), `docs/TODO.md`.

## Why

- `playwright.config.ts` hardcoded `BACKEND_PORT = 8310` / `FRONTEND_PORT = 4310`.
- `e2e/proxy.e2e.json` hardcoded the same `http://localhost:8310` separately. Changing only the
  config's port would have left the dev server proxying `/api` to the wrong backend.
- Parallel worktrees (several agents on this repo) can't run `npm run e2e` at the same time.
- The stack also uses a fixed `/tmp/cinnamon-e2e`, and the backend webServer command begins with
  `rm -rf /tmp/cinnamon-e2e`. Even on different ports, two runs would wipe each other's DB and
  logs, so the directory had to become configurable too (approved in planning).

## Pre-flight findings

- `@angular/build` 21.2.25 `src/utils/load-proxy-config.js:79-92` loads `.js`/`.mjs`/`.cjs`
  proxy configs and unwraps a `default` export. A JS proxy can therefore read env, and no file
  needs generating.
- `first-login.spec.ts` and `returning-user.spec.ts` import `E2E_DIR` from `../playwright.config`.
  Workers inherit the runner's env, so env-derived values resolve the same in both.
- README has no e2e section; the only docs were in `CLAUDE.md` line 48.
- ADR numbering: 0001–0006 and 0008–0010 exist; 0007 is missing (pre-existing gap). No ADR was
  written for this change: it is a test-harness chore with no architectural change.

## Design

| env var | default | drives |
|---|---|---|
| `CINNAMON_E2E_BACKEND_PORT` | 8310 | uvicorn `--port`, health URL, proxy target |
| `CINNAMON_E2E_FRONTEND_PORT` | 4310 | `ng serve --port`, `baseURL` |
| `CINNAMON_E2E_DIR` | `/tmp/cinnamon-e2e` | DB, logs, results (wiped each run) |

- The `CINNAMON_E2E_` prefix keeps tools that read a generic `PORT` from picking these up.
- `e2e/proxy.e2e.mjs` reads `CINNAMON_E2E_BACKEND_PORT` and **throws if it is unset**; it has
  no default of its own.
- The config passes the *resolved* port to the `ng serve` webServer through its `env`, so the
  default exists in exactly one place.
- Validation runs at config load:
  - An empty or unset value means the default.
  - Ports must be integers from 1024 to 65535, and the backend and frontend ports must differ.
  - The dir is normalised first, so `..` segments are resolved before checking. It must be
    absolute, match `^[\w/.-]+$` (it is interpolated into a shell command), and have a last
    segment starting with `cinnamon-e2e`. This guards the `rm -rf` against `/`, `/tmp`, `$HOME`
    or `/tmp/cinnamon-e2e/..`.

Rejected:
- Generating `proxy.e2e.json` at config load: it leaves a stray file behind and concurrent runs
  would race writing it.
- Inline proxy JSON on the CLI: `ng serve` doesn't support it.
- "Edit both files" documentation: that's the bug being fixed.
- A fallback default inside the proxy: it could silently target 8310 when another port was meant.

## What was done / results

Run from `frontend/`.

1. `git rm e2e/proxy.e2e.json`, rewrote `playwright.config.ts`, added `e2e/proxy.e2e.mjs`.
2. `npx playwright test --list` with defaults gives `Total: 15 tests in 2 files`.
3. Validation, each with `npx playwright test --list`:
   - `CINNAMON_E2E_BACKEND_PORT=abc`:
     `Error: CINNAMON_E2E_BACKEND_PORT must be an integer port from 1024 to 65535, got 'abc'`
   - `CINNAMON_E2E_BACKEND_PORT=80`: same error, with `got '80'`.
   - `CINNAMON_E2E_BACKEND_PORT=4310`:
     `Error: CINNAMON_E2E_BACKEND_PORT and CINNAMON_E2E_FRONTEND_PORT are both 4310`
   - `CINNAMON_E2E_DIR=` set to each of `/`, `/tmp`, `'/tmp/cinnamon-e2e x'`,
     `relative/cinnamon-e2e` and `/tmp/cinnamon-e2e/..` gives
     `Error: CINNAMON_E2E_DIR must be an absolute path of [A-Za-z0-9_./-] whose last segment starts with 'cinnamon-e2e' (it is deleted every run), got '<value>'`
   - `CINNAMON_E2E_BACKEND_PORT=` (empty) gives `Total: 15 tests` (the default is used).
   - `CINNAMON_E2E_DIR=/tmp/cinnamon-e2e-ok/` gives `Total: 15 tests` (trailing slash accepted).
4. Proxy guard:
   - `node -e "import('./e2e/proxy.e2e.mjs')"` gives
     `threw: CINNAMON_E2E_BACKEND_PORT is not set; start the e2e stack with \`npm run e2e\``
   - With `CINNAMON_E2E_BACKEND_PORT=8337` it gives
     `{"/api":{"target":"http://localhost:8337","secure":false}}`
5. Pre-check for the default run:
   - `ss -ltn` showed nothing on 8310/4310.
   - No `playwright test` runner was active; the only Playwright processes were MCP browsers.
   - `/tmp/cinnamon-e2e` was last modified at 18:23, i.e. stale.
6. `npm run e2e` (defaults) gave `15 passed (16.8s)`. `backend.log` shows
   `Uvicorn running on http://127.0.0.1:8310`; `frontend.log` shows `Local: http://localhost:4310/`.
   `e2e.db` mtime was `19:04:18.466`.
7. Overridden run:
   `CINNAMON_E2E_BACKEND_PORT=8337 CINNAMON_E2E_FRONTEND_PORT=4337 CINNAMON_E2E_DIR=/tmp/cinnamon-e2e-8337 npm run e2e`
   gave `15 passed (10.8s)`.
   - During the run, `ss -ltn` listed only `127.0.0.1:8337` and `127.0.0.1:4337`, with nothing
     on 8310/4310.
   - `backend.log`: `Uvicorn running on http://127.0.0.1:8337`, plus 87 `/api` request lines,
     including the browser's page-load `GET /api/auth/me`. That request can only arrive through
     the dev-server proxy, which proves the proxy followed the backend port.
   - `frontend.log`: `Local: http://localhost:4337/`.
   - `/tmp/cinnamon-e2e/e2e.db` mtime was still `19:04:18.466`, so the default dir was untouched.
8. `npm test -- --watch=false` gave `23 passed` files and `201 passed` tests.
9. `rm -rf /tmp/cinnamon-e2e-8337`.
10. `grep -rn "8310\|4310\|proxy.e2e.json"` (excluding node_modules) found only the config
    defaults, `CLAUDE.md`, and `uv.lock` hash matches.

## Still to do

- Optionally auto-pick free ports and a work dir (e.g. `CINNAMON_E2E_PORTS=auto`) so parallel
  runs need no manual choice. Added to TODO.
- The e2e-in-CI TODO item can use these variables if CI runners share hosts.

## Gotchas

- Overriding the ports alone is **not** enough for parallel runs: `CINNAMON_E2E_DIR` must differ
  too, or the second run's `rm -rf` deletes the first run's database mid-test.
- `pgrep -f <pattern>` inside a shell loop matches the loop's own command line. My first wait
  loop for the overridden run never ended for that reason; the run itself had finished fine.
