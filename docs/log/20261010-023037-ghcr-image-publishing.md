# Publish the image to ghcr.io/pkhanpara/cinnamon

Status: done, PR open (not merged) (branch `ci/ghcr-publish`, ADR 0016)

## Why
Cinnamon ships as one Docker image, but nothing publishes it: every user has to clone the repo and
`docker compose up --build` (the build needs Node + uv and takes minutes). The goal is a pullable image on GHCR.

## Pre-flight findings
- Branch at `dcdd1e1` (= origin/main), clean. Only `.github/workflows/ci.yml` exists.
- `.dockerignore` already excludes `.env`, `.env.*`, `seed/` (so `seed/private`), `.git`, `docs/`, `**/data`,
  tests. Missing: `**/*.db`, `**/*.sqlite3`, `.claude/`, `.github/`, `frontend/e2e`, `frontend/test-results`,
  `frontend/playwright-report`, `scripts/`.
- No LICENSE file, so no `org.opencontainers.image.licenses` label.
- `ci.yml` style: actions pinned by commit SHA with `# vX` comment, `ubuntu-24.04`.
- No `v*` tags exist yet -> a `latest` that only moves on releases would leave compose's default unpullable,
  so `latest` follows `main` (user approved 2026-10-10).
- Action SHAs (`gh api repos/<a>/releases/latest`, then `commits/<tag>`):
  - docker/setup-buildx-action v4.4.1 f87e5991a6d7451dcb8d9637bfbc97413f497069
  - docker/login-action v4.6.0 dbcb813823bdd20940b903addbd779551569679f
  - docker/metadata-action v6.2.0 dc802804100637a589fabce1cb79ff13a1411302
  - docker/build-push-action v7.4.0 c3c9e263c25d99ce0380d002d59b67737d91b0dc
  - actions/checkout v7.0.1 reused from ci.yml

## Design
See ADR 0016. linux/amd64 only; PRs build and smoke-test without pushing; main pushes `latest`, `main`,
`sha-<short>`; `v*.*.*` tags push semver tags. Rejected: Docker Hub (extra account + secret), multi-arch via
QEMU (est. 5-10x slower build, no arm64 user), not publishing (status quo).

## What was done
1. `.dockerignore`: appended `**/*.db`, `**/*.sqlite3`, `.claude/`, `.github/`, `scripts/`, `frontend/e2e`,
   `frontend/test-results`, `frontend/playwright-report`.
2. `Dockerfile`: `LABEL org.opencontainers.image.source=https://github.com/pkhanpara/cinnamon` in the `app` stage.
3. `docker-compose.yml`: `image: ${CINNAMON_IMAGE:-ghcr.io/pkhanpara/cinnamon:latest}`, `build: .` kept.
4. `.github/workflows/publish.yml` (new): build (load) -> smoke test -> login + push (non-PR only).
5. README Docker section rewritten (pull/run, tags, build from source); stale "last verified" note removed.
6. ADR `docs/adrs/0016-publish-image-to-ghcr.md`.

Verification (all local, nothing pushed to GHCR):
```
docker build -t cinnamon:ghcr-test .          # exit 0, 12 s (warm layer cache), 329MB
docker run -d -p 8341:8000 -v cinnamon-ghcr-test-data:/app/data cinnamon:ghcr-test
curl -fsS localhost:8341/api/health           # {"status":"ok"} after ~5 s (4 connection resets while booting)
curl -fsS localhost:8341/ | grep -ci '<app-root'   # 1
find /app ( -name ".env*" -o -name seed -o -name "*.db" -o -name "*.sqlite3" )   # empty
ls -a /app   # .venv alembic.ini app data migrations pyproject.toml static uv.lock
docker inspect ... Labels   # {"org.opencontainers.image.source":"https://github.com/pkhanpara/cinnamon"}
docker compose config       # image: ghcr.io/pkhanpara/cinnamon:latest, build context kept
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -no-color   # clean (ci.yml + publish.yml)
cd backend && uv run pytest -q        # 508 passed
cd frontend && npm run test:ci        # 235 passed (28 files); format:check clean
```
Container and test volume removed afterwards.

## Still to do
- Make the GHCR package public after the first push on main (manual, user's call). Added to TODO.md.
- Dependabot for action SHAs; arm64 only on demand (native runner). Added to TODO.md.
- The first real push (main) is only proven once the PR merges; the PR run proves build + smoke only.

## Gotchas
- actionlint 1.7.12 takes `-no-color`, not `-color=never`.
- The container HEALTHCHECK interval is 30 s, so `docker inspect` shows `starting` for a while even though
  `/api/health` already answers; the smoke test polls the endpoint directly instead.
- `docker compose up --build` now tags the local build as `ghcr.io/pkhanpara/cinnamon:latest`; use
  `CINNAMON_IMAGE=cinnamon:dev` to keep them apart (README).
- The smoke test in CI binds host port 8000 on the runner; fine there, but don't copy it to a dev box.
