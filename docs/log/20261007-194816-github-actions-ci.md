# GitHub Actions CI: lint, unit tests, e2e

Status: done. PR #18 squash-merged as 85245f9; branch protection on. Branch `ci/github-actions`.

Touched: `.github/workflows/ci.yml` (new), `frontend/package.json` (scripts `test:ci`,
`typecheck`, `format`, `format:check`), `frontend/.prettierrc`, `frontend/.prettierignore` (new),
53 frontend `.ts`/`.scss` files (Prettier reformat only), `CLAUDE.md`, `docs/TODO.md`.

## Why

- The repo had no CI: no `.github/` directory. Lint and tests ran only when someone remembered.
- `pkhanpara/cinnamon` is public (`gh repo view --json visibility` → `PUBLIC`), so GitHub Actions
  minutes on standard hosted runners are free. The cost question was the user's precondition.
- TODO already asked for "frontend tests and `npm run e2e` ... to CI".

## Pre-flight findings

Measured locally on `main` @ a546ddb, before any change:

| check | result |
|---|---|
| `uv run ruff check .` | All checks passed |
| `uv run ruff format --check .` | 66 files already formatted |
| `uv run pytest -q` | 352 passed, 1 warning in 38.57s |
| `npx ng test --watch=false` | 23 files, 204 passed, 1.47s |
| `npx tsc -p tsconfig.app.json --noEmit` / `tsconfig.spec.json` | clean |
| `npx prettier --check "src/**/*.{ts,html,scss,css}" "e2e/**/*.ts"` | **58 files** with issues |
| ESLint | not installed |

Prettier 3.8 and a `.prettierrc` existed, but Prettier had never been run across the code.

## Design

- Three parallel jobs: `backend` (ruff check, ruff format --check, pytest), `frontend`
  (format:check, typecheck, test:ci, build), `e2e` (Playwright, Chromium). They are independent
  because the e2e config builds its own throwaway stack.
- uv `0.12.23` and Node 22 match the Dockerfile. Actions are pinned to commit SHAs (public repo).
- Playwright browsers are cached by the `@playwright/test` version. On a cache hit, only
  `playwright install-deps` runs, because the system libraries aren't in the cache.
- e2e uses `CINNAMON_E2E_DIR=${{ runner.temp }}/cinnamon-e2e`, which passes the config's path
  check. On failure, `results/` and the backend/frontend logs are uploaded (7 days).
- No secrets: tests override the quote provider, and the e2e config sets `FINNHUB_API_KEY: ''`.
- Concurrency: a new push cancels an older run on the same PR. Runs on `main` always finish.

Rejected (user choice in planning):
- **ESLint now**: angular-eslint would add a dependency and fixes to this PR. Deferred to TODO.
- **Docker image build job**: catches lockfile drift but costs ~3-4 min per run. Still in TODO.
- **Dependabot/Renovate**: still in TODO.
- **Python version matrix**: the app ships on 3.12 only (Dockerfile), so a matrix adds nothing.

## What was done

1. `git checkout -b ci/github-actions`
2. `npx prettier --write "src/**/*.{ts,html,scss,css}" "e2e/**/*.ts" playwright.config.ts`
   reformatted 58 files. **`ng test` then failed 6 tests** (see Gotchas). `tsc` and `ng build`
   were still fine.
3. Reverted the two `.html` files: still 6 failures, because most components use inline
   `template:` strings, which Prettier formats as embedded Angular.
4. Reverted everything. Set `embeddedLanguageFormatting: "off"` in `.prettierrc` and added
   `.prettierignore` with `*.html`. (The old `*.html` → `angular` parser override was dropped as
   dead.) Then `prettier --write "src/**/*.{ts,scss,css}" "e2e/**/*.ts" playwright.config.ts`:
   52 files changed, 204/204 tests pass, tsc clean, build OK. `git diff -w` shows only line
   splitting and wrapping.
5. Committed as `style(frontend): ...` (formatting only, kept separate from the CI commit).
6. `npm run format:check` then flagged 2 more files (`login.spec.ts`, `users.spec.ts`): Prettier
   isn't idempotent on `http.expectOne(...).flush({...})` chains. A second `--write` settled
   them, and a third changed nothing. Amended into the reformat commit. Tests: 204 passed.
7. Added the npm scripts and `.github/workflows/ci.yml`.
   `npm run format:check && npm run typecheck`: OK.
8. `CINNAMON_E2E_DIR=/tmp/cinnamon-e2e-ci npm run e2e`: 15 passed (20.7s).
9. Pushed and opened https://github.com/pkhanpara/cinnamon/pull/18. Run 37719907649, everything green
   on the first try:
   - Backend (ruff, pytest): 47s.
   - Frontend (prettier, tsc, vitest, build): 37s.
   - End-to-end (Playwright): 1m3s. `15 passed (20.3s)`, browser cache cold
     (`Cache not found for input keys: playwright-Linux-1.63.0`).
10. Annotations from that run:
    - "The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19, 2026". Pinned
      `runs-on: ubuntu-24.04`, because `playwright install --with-deps` is distro-specific.
    - setup-uv "Unable to reserve cache ... another job may be creating this cache". This is
      harmless: backend and e2e share a cache key and race to save it.
11. `gh pr merge 18 --squash --delete-branch` merged it as `85245f9`.
12. Branch protection on `main` (`PUT repos/pkhanpara/cinnamon/branches/main/protection`):
    - The three job names are required checks, bound to the GitHub Actions app (`app_id` 15368),
      so no other integration can post a passing status under those names.
    - `strict: false`: PRs don't have to be rebased onto the latest main. Parallel agent PRs
      would otherwise force a rebase on every merge.
    - No required reviews (solo repo). Force-pushes and deletion are blocked.
    - `enforce_admins: false`: the owner can still push docs commits straight to main (as with
      `d74893b`), and `gh pr merge` refuses a red PR unless given `--admin`.
13. Added `.git-blame-ignore-revs` with `85245f9`, in its own PR (the first PR under protection).

## Still to do

Tracked in `docs/TODO.md` under "CI follow-ups":
- ESLint (angular-eslint).
- A safe way to format templates (e.g. `htmlWhitespaceSensitivity: "strict"`, checked against
  the specs), or leave them unformatted.
- Docker image build in CI and Dependabot/Renovate (existing TODO item).
- Bump `runs-on` to Ubuntu 26 deliberately, once Playwright supports it.

## Gotchas

- **Prettier on Angular templates changes rendering.** The reflow adds leading and trailing
  whitespace inside text nodes. Angular collapses whitespace but keeps one space, so:
  - the chat answer (a `pre-wrap` block) became `" Half an ans "`;
  - `"DIS Inc. · RH"` on Home got extra spaces;
  - range-button lookups by text broke.

  That is six specs in `news-chat`, `portfolio-chart`, `holdings` and `symbol`. Inline templates
  are affected too, not only `.html` files.
- Prettier's member-chain formatting isn't idempotent in a few cases. One `--write` can still
  fail `--check`, so run `npm run format` until it's stable.
- `uv run` syncs the dev group by default, so `uv sync --no-dev` before e2e would only cause a
  second sync.
