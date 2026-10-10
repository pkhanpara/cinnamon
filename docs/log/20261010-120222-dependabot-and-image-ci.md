# Dependabot for actions, Docker, npm and uv (2026-10-10)

## Why
TODO item: "Dependabot/Renovate: github-actions ecosystem (SHA-pinned actions in ci.yml and publish.yml) and the pinned uv tag+digest; CI image build to catch lockfile/npm drift". Nothing kept the SHA pins or the uv pin current, and the uv version had to be bumped by hand in both ci.yml and the Dockerfile.

## Design (ADR 0017)
- Dependabot rather than Renovate: it's native, with no app or PAT on a public repo, and it covers all four ecosystems.
- The uv pin moved to a named stage, `FROM ghcr.io/astral-sh/uv:<tag>@sha256:<digest> AS uv`. Dependabot's docker updater handles `FROM` lines; I couldn't confirm it handles `COPY --from=image`. ci.yml now reads `UV_VERSION` from that line, so the Dockerfile is the only place the version lives.
- Grouping: actions weekly in one PR, docker weekly, npm monthly (an angular group plus everything else, majors individual, at most 3 open), uv monthly (minor+patch grouped). 7-day cooldown everywhere.
- Ignored: Angular majors, TypeScript minors and majors, Node and Python base-image minors and majors. These are deliberate changes; the Node major decides the npm version that writes the lockfile.
- No new image job in ci.yml: publish.yml already builds and smoke-tests the image on every PR without pushing. The user chose this.

## What was done
- `.github/dependabot.yml` (new), `.github/workflows/ci.yml` (uv version step in the backend and e2e jobs, header comment), `Dockerfile` (uv stage), ADR 0017, TODO.
- Verified:
  - `uvx check-jsonschema --builtin-schema vendor.dependabot` passes. The schema is strict: a bogus `cooldown` key is rejected, so `cooldown` is a known option.
  - `vendor.github-workflows` passes on both workflows.
  - actionlint 1.7.7 (Docker, includes shellcheck) is clean.
  - The sed extraction returns `0.12.23` on the Dockerfile and exits 1 with an error when the `FROM` line is missing.
  - `docker build` passes. The container answers `/api/health` and serves `<app-root`. `uv --version` in the `deps` stage is 0.12.23. The final image never contained uv.

## Still to do
- After merge, open Insights -> Dependency graph -> Dependabot and check that all four ecosystems parse. In particular, check that the docker job picks up the uv stage.

## Gotchas
- If a Dependabot npm PR fails `npm ci`, the lockfile came from a different npm major. Regenerate it on the PR branch with `npx -y npm@10 install --package-lock-only --ignore-scripts`.
- Playwright bumps change the browser cache key in the e2e job, so the first run after one downloads Chromium again.
