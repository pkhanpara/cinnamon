# FastAPI and Angular skeletons

## Why
Phase 1 of the plan: runnable skeletons for both halves, wired together.

## Pre-flight findings
- `python3 --version` 3.12.3, `node --version` v24.4.1, npm 11.6.2, `uv` present, `ng` not installed.
- First `npx @angular/cli@latest new` aborted: "The Angular CLI requires a minimum Node.js
  version of v22.22.3 or v24.15.0 or v26.0.0." (latest = 22.2.1).
- `npm view @angular/cli@21 engines` -> `^20.19.0 || ^22.12.0 || >=24.0.0`: runs on 24.4.1.
- nvm is installed, but I did not change the user's Node version.

## Design
- Angular **21** instead of 22 (current) so no system Node change is needed. Rejected:
  `nvm install` a newer Node (modifies user environment without being asked). Upgrade is
  tracked in TODO.md.
- Backend: uv-managed project; `app/` with config (pydantic-settings reading `../.env`),
  db (SQLite, FK + WAL pragmas), Alembic wired to `Base.metadata` and settings URL.
  Empty `connectors/` and `providers/` packages reserve the plugin seams from ADR 0001.
- Frontend: standalone components, signals, `provideHttpClient`, dev proxy `/api` -> :8000.

## What was done
- `uv sync`; `uv run pytest` first failed `ModuleNotFoundError: No module named 'app'`;
  fixed with `pythonpath = ["."]` in pyproject. Then `1 passed`. `ruff` autofixed 1 import issue.
- `alembic init` + edited `migrations/env.py`; `alembic current` runs against SQLite.
- Committed backend as f72ffbd.
- `ng new frontend` (v21, scss, routing, no SSR); replaced 20KB boilerplate with a minimal shell
  showing `API: <status>`; `ng build` ok (208 kB initial); `ng test` 1 passed.
- E2E: uvicorn :8000 + `ng serve` :4200; `curl localhost:8000/api/health` and
  `curl localhost:4200/api/health` both returned `{"status":"ok"}`.

## Still to do
No models/migrations yet, no Dockerfile/compose, no auth. See `docs/TODO.md`.

## Gotchas
- `pkill` at the end of my E2E command killed its own shell (exit 144); results were already printed.
- Starlette warns that `httpx` in TestClient is deprecated in favour of `httpx2`; harmless for now.
