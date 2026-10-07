# Docker packaging

## Why
Single deployable image, like Mealie: FastAPI serves the built Angular UI and the API.

## Pre-flight findings
- `docker compose version` v2.39.1. First `docker compose build` failed:
  `failed to resolve source metadata for docker.io/docker/dockerfile:1 ... TLS handshake timeout`
  (Docker Hub network blip). Removed the optional `# syntax=` line; build then succeeded.
- Before pushing: `git ls-files | grep -E "^\.env$|seed/private"` empty and
  `git log -p --all | grep -c <key prefix>` = 0.

## Design
- Multi-stage: `node:22-slim` builds the UI (Angular 21 needs Node ^22.12), `python:3.12-slim`
  runs the API with uv (`--frozen --no-dev`), UI copied to `/app/static`.
- `main.py` serves `static/` only if the directory exists (dev unaffected), with SPA fallback to
  index.html; `/api/*` unknown paths return 404; resolved-path check prevents traversal.
- Runs as non-root uid 10001; SQLite in named volume `cinnamon-data` at `/app/data`;
  `alembic upgrade head` on start; HEALTHCHECK hits /api/health.
- `.env` is passed via `env_file` at runtime and excluded from the image by `.dockerignore`
  (also excludes `seed/`, `docs/`). Rejected: baking the key into the image.

## What was done / results
- `docker compose up -d`: `/api/health` -> `{"status":"ok"}`; `/holdings` -> 200 (SPA fallback);
  `/api/nope` -> 404; `/../app/main.py` and `%2e%2e` variants returned index.html, not source.
- `id -un` in container: `cinnamon`; `/app/data` contains `cinnamon.db`; health status `healthy`.
- Page title was still "Frontend"; changed to "Cinnamon" in `frontend/src/index.html`.
- Pushed 3 commits to origin/main first.

## Still to do
Pin the uv image tag; run instructions README; no migrations exist yet so `alembic upgrade head` is a no-op.

## Gotchas
- `astral-sh/uv:latest` is unpinned, so builds are not reproducible.
- Container image was not rebuilt after the title change; it is picked up on the next build.
