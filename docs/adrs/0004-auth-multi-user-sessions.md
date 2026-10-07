# 0004 - Multi-user auth with server-side sessions

Status: Accepted (2026-10-07). First-run setup (`/auth/setup`) superseded by ADR 0005.

## Context
Cinnamon holds financial data for several users on one self-hosted instance. The user chose
multi-user with local username/password and a session cookie. Alternatives considered: JWT in a
header (stateless, but weak logout/revocation), OIDC (needs an IdP), password + TOTP (deferred).

## Decision
- Argon2id password hashes (argon2-cffi defaults); min length 10.
- Opaque 256-bit session token in an `HttpOnly`, `SameSite=Lax` cookie; only its SHA-256 is stored
  in `sessions`, so a leaked DB cannot be replayed as cookies. 30-day expiry (`SESSION_DAYS`).
  `Secure` is opt-in via `COOKIE_SECURE=true` so plain-HTTP LAN installs work.
- First run: `POST /api/auth/setup` creates the admin and only works while there are zero users.
  Admins create users, reset passwords, deactivate. Deactivation and password reset delete sessions.
  An admin cannot deactivate or demote themselves.
- Usernames normalized to lowercase. Login runs an Argon2 verify against a dummy hash for unknown
  users so timing does not reveal valid usernames; wrong user and wrong password give one error.
- Every domain row carries `user_id`; accessing another user's row returns 404, not 403.
- CSRF: relies on `SameSite=Lax` plus JSON-only mutating endpoints (no form posts). Revisit
  if cross-site embedding or a non-JSON endpoint is ever added.

## Consequences
+ Real logout/revocation; DB leak does not expose usable sessions.
- A DB lookup per request (fine on SQLite at this scale).
- No login rate limiting, 2FA or self-service password change yet (see TODO.md).
- `setup` has a theoretical race: two simultaneous first requests could both create an admin.
