# Default admin, forced password change, /home and Settings

## Why
User asked for: a fix for the `/setup` admin-creation error (in a separate agent and worktree), a default
admin password `$admin123456`, `/home` as the landing page, and user setup moved under Settings.
Details and the security trade-off: ADR 0005.

## Pre-flight findings
- Design questions asked first. Answers: seed `admin` / `$admin123456` WITH a forced change on first
  login; username `admin`; the Users page becomes `/settings/user-setup` and the first-run form goes away;
  nav = Home | Settings (Accounts, User setup, Change password).
- Agent report (verified against its diff before merging): plain `uvicorn` never created tables; with a fresh
  DB `GET /api/auth/status` returned `500 text/plain` and the log said `no such table: users`; the default
  `./data/` folder also did not exist. The page only showed "Setup failed" because a plain-text 500 has no `{detail}`.
  The agent worktree branched before the holdings commit, so `main.py` conflicted on cherry-pick.

## Design
See ADR 0005. Rejected: seeding without a forced change (known credential stays valid), env-gated seeding,
`create_all()` at startup (skips Alembic), keeping a first-run form next to a default admin.

## What was done
- Backend (`a817131`): `User.must_change_password` + migration `5691cb8ff945` (server_default 0);
  `app/bootstrap.py ensure_default_admin`; `session_user` vs `current_user` dependencies (403
  `Password change required`); `POST /auth/change-password`; removed `/auth/setup` and `/auth/status`.
  Migration check with a user present at the previous revision: `[('existing', 1, 0)]`, downgrade/upgrade round-trips,
  `alembic check`: no drift.
- Merged the agent's fix (`4d6b589`, cherry-picked): `upgrade_schema()` in `db.py`, lifespan in `main.py`,
  `AUTO_MIGRATE`, `migrations/env.py` in-process mode, readable 5xx messages in `errors.ts`. Resolved the `main.py`
  conflict by keeping the holdings router and adding seeding inside the `auto_migrate` branch (so fixtures that
  build their own in-memory schema never seed a real DB). Rewrote the agent's `test_startup.py` for the seeded flow.
- Frontend (this commit): `/home`, `/settings/*` shell, change-password page, `sessionGuard`, forced-change
  redirects in `authGuard`/`guestGuard`/`adminGuard` and the interceptor, setup page deleted, old URLs redirect.
- Tests: backend `133 passed`, ruff clean. Frontend `85 passed`, `ng build` clean.
- Mutation checks (restored after each): skip migration -> 2 startup tests fail; skip seeding -> 2 fail;
  authGuard ignoring the forced change, interceptor ignoring the 403, forced change not navigating home -> each fails one test.
  My first seeding mutation "survived" (`2 passed`) because `ruff format` had wrapped the call over several lines,
  so my `sed` pattern matched nothing; redone with a regex and it failed as it should.
- Tests for TestBed helpers called more than once per test needed `TestBed.resetTestingModule()`.

## Still to do
- Real-browser E2E of the whole flow is being done in a parallel session (Playwright files under
  `frontend/e2e/`, `playwright.config.ts`, `package.json` are theirs and are NOT in this commit).
- Admin password reset command; forced change for admin-created users; 2FA; migration race; login rate limiting;
  Docker image rebuild. All in `docs/TODO.md`.

## Gotchas
- The default password contains `$`: quote it in shells (`'$admin123456'`).
- A forgotten admin password has no recovery path yet.
- Accounts/Users pages now render `h3` under the Settings `h2`; specs that looked for `h2` were updated.
