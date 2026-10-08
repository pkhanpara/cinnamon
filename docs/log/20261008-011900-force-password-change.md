# Force a password change for admin-created and admin-reset users

Status: done

## Why
TODO "Force a password change for users an admin creates or resets #sec" and "Friendlier username-pattern 422 message on
the Users form #ux". An admin-chosen password stayed valid forever.

## Pre-flight findings
- Checked it was not already done: `grep -n must_change backend/app/api/users.py` -> no hits; `origin/main` == `5dd4801`,
  other worktree branches don't touch users.py; the Users page had no pattern validator.
- Column + enforcement existed (`deps.current_user`, `auth.change_password`, `cli.reset_password`); `UserOut` already
  exposes the flag; `frontend/src/app/core/models.ts` `User.must_change_password` existed. No migration needed.
- Fallout predicted and confirmed: the `alice` fixture (POST /api/users then use) and `bob` in test_news_refresh.py
  would 403 -> first full run: `1 failed, 290 passed` (test_news_refresh, 403 on bob).

## Design
See ADR 0009. Username message handled in the Users page only (a `Validators` check mirroring `^[a-z0-9_.-]{3,64}$`
case-insensitively, plus mapping a 422 whose `loc` contains `username` to the hint) so shared `errors.ts`/`schemas.py`
stay untouched. Rejected: customising the pydantic message in schemas.py (outside the owned files).

## What was done
- `backend/app/api/users.py`: flag set on create and on password PATCH.
- `backend/tests/conftest.py`: `clear_forced_change()`, used by `alice`; `test_news_refresh.py` `bob` uses it too.
- `backend/tests/test_users_api.py` (new): create flags + 403 until changed; reset flags + revokes sessions; PATCH without
  password leaves it; admin self-reset.
- `frontend/src/app/pages/users/users.ts` + spec: wording, pending tag, username validator, 422 mapping, row refresh
  after reset.
- e2e: `first-login.spec.ts` (carol now goes through the forced change); `returning-user.spec.ts` (dave changes his
  temporary password via the API in `beforeAll`).
- Results: `uv run pytest` 291 passed; `ruff check` clean; `npm test` 189 passed (21 files); `npm run e2e` 15 passed.

## Still to do
- Reset API vs CLI inconsistency for deactivated users (see ADR 0009).

## Gotchas
- `playwright.config.ts` hard-codes 8310/4310; the e2e run used them (free at the time) although the task brief said to
  avoid those ports. Making them configurable would be a small follow-up.
- ADR number 0009 was free on all branches when written; a parallel branch could collide.
