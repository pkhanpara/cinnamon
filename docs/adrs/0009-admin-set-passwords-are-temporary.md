# 0009 - Admin-set passwords are temporary

Status: Accepted (2026-10-08)

## Context
ADR 0004 gave the seeded default admin `must_change_password=True`, enforced by `current_user` (403 "Password change
required") until `/auth/change-password` clears it. The offline CLI reset already sets the flag. But the two admin paths in
`api/users.py` did not: a user created with `POST /api/users` or reset with `PATCH /api/users/{id}` kept a password the
admin chose and knows, indefinitely.

## Decision
- `create_user` sets `must_change_password=True`; `update_user` sets it whenever a `password` is supplied (it already
  revokes that user's sessions). PATCHes that don't carry a password leave the flag alone.
- No new column, endpoint or migration: the existing enforcement chain does the rest.
- An admin resetting their own password is treated the same (signed out, forced change at next sign-in), matching the CLI.
- UI: the Users page labels the field "Temporary password", tags rows with a pending change, and validates the username
  pattern client-side (with a friendly message instead of pydantic's raw regex on a 422).

Rejected: a "require change" checkbox per create/reset (more surface, and the safe default is the point); forcing only on
reset (a created user's password is just as admin-known).

## Consequences
- Every flow that creates a user through the API must complete a password change before the account is usable; test
  fixtures (`alice`, `bob`) clear the flag via `clear_forced_change`, and e2e specs change it through the UI/API.
- An admin cannot hand out a "permanent" password; scripted provisioning has to change it as the user.
- The reset API still accepts deactivated users (the CLI refuses them); the flag is set either way.
