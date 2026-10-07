# 0001 - FastAPI + Angular + SQLite monorepo

Status: Accepted (2026-10-06)

## Context
Self-hosted, Mealie-like portfolio tracker aggregating Robinhood, M1 Finance and future
platforms. Requirements from the user: Python backend, sqlite3 for metadata, Angular UI,
multi-user with login, public GitHub repo. Alternatives considered: FastAPI + raw sqlite3
(fewer deps, more hand-written SQL/migrations), Django + DRF (batteries included but not
API-first), Flask + SQLAlchemy (less built-in typing/OpenAPI).

## Decision
FastAPI + SQLAlchemy 2 + Alembic on SQLite; Angular client generated from the OpenAPI
spec; monorepo (`backend/`, `frontend/`, `docs/`); one Docker image serves UI + API.
Connectors (broker data) and providers (market data) are plugin interfaces, CSV import first.

## Consequences
+ Typed end to end; OpenAPI gives a generated client; SQLite keeps ops trivial.
- SQLite limits write concurrency (fine for homelab scale; revisit if it grows).
- yfinance (history) is unofficial and may break; isolated behind a provider interface.
- Public repo: secrets and real portfolio data must stay git-ignored (`.env`, `seed/private/`).
