# Fix: first-admin setup fails with "Setup failed" (no schema on plain uvicorn start)

## Why
Creating the first admin at http://localhost:4200/setup showed an error. Cause: nothing created the
database schema outside Docker (only the Dockerfile CMD ran `alembic upgrade head`).

## Pre-flight findings
Backend started WITHOUT migrations against a throwaway DB (`backend/`):
```
DATABASE_URL=sqlite:////tmp/claude-1000/setup-bug.db uv run uvicorn app.main:app --port 8000
$ curl -si localhost:8000/api/auth/status
HTTP/1.1 500 Internal Server Error ... content-type: text/plain; charset=utf-8   (body: "Internal Server Error")
backend log: sqlalchemy.exc.OperationalError: (sqlite3.OperationalError) no such table: users
             [SQL: SELECT count(users.id) AS count_1 FROM users]
```
Browser (`agent-browser --session setupbug`), /setup with admin / correct-horse-battery, click "Create admin":
the form stays on /setup and shows the red text **"Setup failed"** (apiError fallback: a plain-text 500
has no `{detail}`). The setup page itself rendered because the guard's `/api/auth/me` 401 is treated as
signed out (and `/auth/status` is not what gates the page).

Second problem, same root: default `DATABASE_URL=sqlite:///./data/cinnamon.db`, and `backend/data/` does
not exist on a fresh checkout:
```
DATABASE_URL=sqlite:////tmp/claude-1000/nodir/x.db uv run alembic upgrade head
sqlite3.OperationalError: unable to open database file
```
After `alembic upgrade head` on the throwaway DB the happy path works. Odd inputs via curl to /api/auth/setup:
| input | result |
|---|---|
| `Admin` / 9-char-or-short password | 422, `String should have at least 10 characters` |
| username `a dmin`, `ab`, 70 chars | 422, `String should match pattern '^[a-z0-9_.-]{3,64}$'` |
| 300-char password | 422, `at most 256 characters` |
| `Admin` + valid password | 201, stored as `admin` |
| second setup | 409 `Setup already completed` |
So validation, cookie, proxy (`/api` -> :8000) and the 409 path are fine; only the missing schema/dir is a bug.

## Design
- `app.db.upgrade_schema(url)`: mkdir parent of the SQLite file, then Alembic `upgrade head` in-process.
  Called from a FastAPI lifespan handler in `app/main.py`. Idempotent (no-op at head).
- Setting `auto_migrate` (env `AUTO_MIGRATE`, default true). Tests set it false in `conftest.py` before
  importing the app, so the in-memory-DB fixtures are unaffected and not slowed.
- `migrations/env.py`: take the URL from `config.attributes["url"]` when given (no dependency on the module
  level settings), and skip `fileConfig` for in-process runs (it would disable uvicorn's loggers).
- Frontend `apiError()`: any HTTP >= 500 without `{detail}` now reads
  "Server error (HTTP 500). Check the backend logs." instead of the vague fallback.
- Rejected: `Base.metadata.create_all()` on startup (bypasses Alembic, leaves no version row, breaks later
  upgrades); a README note only (fails silently for the next fresh checkout); catching the OperationalError
  per request (hides a real misconfiguration).
- Not changed (by request): setup route, defaults, setup UI.

## What was done
- Edited `backend/app/{config,db,main}.py`, `backend/migrations/env.py`, `backend/tests/conftest.py`;
  added `backend/tests/test_startup.py` (fresh file in a missing directory -> status/setup/me work and the
  `users` table exists; second start is a no-op and keeps data) and `frontend/src/app/core/errors.spec.ts`.
- Mutation check: replaced `if settings.auto_migrate:` with `if False and ...` -> both startup tests fail with
  `no such table: users`; restored.
- `uv run ruff check . && uv run ruff format .` clean; `uv run pytest -q`: 63 passed.
  `CI=1 npx ng test --watch=false`: 43 passed; `npx ng build` OK.
- Browser re-check on a brand-new DB path (`sqlite:////tmp/claude-1000/fresh/new.db`, directory absent, no
  alembic run): setup with `Admin` / `correct-horse-battery` -> landed on `/holdings` with nav.

## Still to do
- Friendlier 422 text for the username pattern ("String should match pattern ...") on the setup form;
  the user is redesigning setup, so left alone.

## Gotchas
- Port 4200 was already in use by another `ng serve` (the main checkout); it proxies to :8000 so it still
  exercised this backend, but not this worktree's frontend change (covered by vitest).
- `npm install` rewrites `frontend/package-lock.json`; reverted, not committed.
- Concurrent multi-worker starts could race on migration; fine for single-process uvicorn/Docker.
