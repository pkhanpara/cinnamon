# 0005 - Seeded default admin, startup migration, and Settings navigation

Status: Accepted (2026-10-07). Supersedes the first-run setup part of ADR 0004.

## Context
- The first-run "create the admin" page (`/setup`) failed with a plain-text 500: only the Docker CMD
  ran `alembic upgrade head`, so a plain `uvicorn` start on a fresh checkout had no tables
  (`no such table: users`) and the default `./data/` folder did not exist. Reproduced and fixed by a
  separate agent in its own worktree.
- The user asked for a default admin password (`$admin123456`), `/home` as the landing page, and for
  user management to live under Settings with the other settings.
- A fixed password in a public repository is a known credential. Options considered: seed it with a
  forced change (chosen); seed it and only warn; seed only when an env var enables it; no default and
  keep the setup form.

## Decision
- **Startup:** the app creates the SQLite folder and runs Alembic `upgrade head` in the FastAPI
  lifespan (`AUTO_MIGRATE`, default on; tests turn it off and build their own schema). Rejected
  `create_all()`: it bypasses Alembic and leaves no version row.
- **Default admin:** on startup, if the `users` table is empty, create `admin` / `$admin123456`
  (`DEFAULT_ADMIN_USERNAME` / `DEFAULT_ADMIN_PASSWORD` override it) with `must_change_password = true`.
  Idempotent; a lost race hits the unique username and is ignored. Existing installs are untouched:
  the migration defaults the flag to 0, verified by upgrading a database that already held a user.
- **Forced change:** while the flag is set, every endpoint except `GET /auth/me`, `POST /auth/logout`
  and `POST /auth/change-password` answers 403 `Password change required`. `change-password` verifies
  the current password, rejects reuse of it, rejects the well-known default as a new password
  (for every user), clears the flag, and signs out the user's other sessions.
- **Removed:** `GET /auth/status`, `POST /auth/setup`, and the Angular setup page. `/setup` redirects to `/login`.
- **Routes:** `/home` (holdings). `/settings` with children `accounts`, `accounts/:id/import`,
  `user-setup` (admin only, formerly `/users`), `change-password`. Old URLs (`/holdings`, `/accounts`,
  `/accounts/:id/import`, `/users`) redirect. The frontend mirrors the backend rule: guards send a user
  with a pending change to `/settings/change-password`, and the HTTP interceptor does the same on that 403.

## Consequences
+ A fresh install works with plain `uvicorn` or Docker; no first-run form to fail.
- Between first start and first sign-in the instance accepts a publicly known password. Mitigation:
  nothing is usable with it except changing it. Do not expose a fresh instance before that.
- There is no admin password reset command; a forgotten admin password needs a database edit (TODO).
- Admins who create users or reset passwords still hand out working passwords without forcing a change (TODO).
- Two server processes starting on an empty database at the same instant could race on the migration;
  fine for the single-process dev and Docker setups (TODO if that changes).
- Still no login rate limiting; the well-known password makes that more pressing (TODO).
- ADR 0005 (cost-basis method) in the plan is now numbered 0006.
