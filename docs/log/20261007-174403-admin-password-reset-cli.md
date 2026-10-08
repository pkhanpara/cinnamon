# Admin password reset CLI

Status: done (Docker path untested, see Still to do)

## Why
README said "If you lose the admin password there is no reset command yet"; TODO item
"Admin password reset command". Lost admin password = DB surgery by hand.

## Pre-flight findings
- `grep -n password backend/app/api/users.py`: admin-side reset already does
  `hash_password` + `delete(AuthSession)` for the user (line ~47); the CLI mirrors that.
- `schemas.py:16` `Password` min_length=10; reused via new `MIN_PASSWORD_LENGTH`.
- `bootstrap.ensure_default_admin` stores usernames lowercase -> CLI lowercases/strips.
- Dockerfile installs `uv sync --frozen --no-dev --no-install-project`, `ENV PATH=/app/.venv/bin`,
  WORKDIR /app, runs as user `cinnamon` owning /app/data -> `python -m app.cli` works, a
  `[project.scripts]` entry would not.
- `Session` objects expire on commit: reading `user.username` after the `with SessionLocal()` block
  closed raised `DetachedInstanceError` (found by the new tests; fixed by reading it inside).

## Design
`backend/app/cli.py`: `reset_password(db, username, password)` (pure, tested) + `main(argv)`.
Password from `getpass` (twice) on a TTY, else one line of stdin; never argv/logging. Sets
`must_change_password=True`, deletes the user's `AuthSession` rows. Refuses empty, <10 chars,
unknown, and inactive users (a reset must not silently re-enable an account).
Rejected: API/token route (attack surface, bootstrap problem); env var applied at startup (password
in env/compose, easy to leave set); `--password` flag (ps/history); `[project.scripts]` (absent in
Docker install); raw sqlite3 + hand-made hash (bypasses `app.security`).
ADR not written: operational tool within ADR 0004's decisions (argon2, sessions, forced change).

## What was done
- `uv run pytest -q` -> `287 passed` (8 new in `tests/test_cli.py`), ruff check/format clean.
- Manual, temp SQLite (`alembic upgrade head`, seeded default admin):
  - `printf '%s' 'a-new-long-password' | python -m app.cli reset-password admin` -> rc=0
  - password `x` -> `error: Password must be at least 10 characters.` rc=1
  - empty stdin -> `error: Password must not be empty.` rc=1
- README "Lost a password?" section, CLAUDE.md command line, TODO item ticked.

## Still to do
- `docker compose exec` forms documented but not run (needs the full image build incl. npm).
- Adjacent TODO "Force a password change for users an admin creates or resets" stays open: the CLI
  already sets the flag, the API reset path (`PATCH /api/users/{id}`) does not.

## Gotchas
- Running the CLI with an empty password is rejected before the DB is opened, so a bad
  `DATABASE_URL` only surfaces once a valid password is supplied.
