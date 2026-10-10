# 0018. Dependency updates via Dependabot

Status: Accepted (2026-10-10)

## Context

Every GitHub Action in `ci.yml` and `publish.yml` is pinned to a commit SHA with a `# vX` comment (ADR 0016). The Dockerfile pins the uv image by tag and digest. Nothing kept these pins current, and the uv version was written twice, once in `ci.yml` (`UV_VERSION`) and once in the Dockerfile, with a comment asking whoever bumped one to bump the other. Frontend (npm) and backend (uv) dependencies were only updated by hand.

Options weighed:

1. **Renovate** (Mend app or self-hosted workflow): more powerful, with regex managers that could bump `UV_VERSION` and the Dockerfile in one PR, and `constraints` to pin the npm version. But it needs a third-party GitHub App with write access on a public repo, or a self-hosted workflow with a stored PAT.
2. **Dependabot**: built into GitHub, needs no app or secret, and supports every ecosystem here (`github-actions`, `docker`, `npm`, `uv`). It updates an action's SHA together with its version comment, and an image tag together with its digest. It can't edit arbitrary strings such as an env var in a workflow.

## Decision

- **Dependabot**, configured in `.github/dependabot.yml`.
- **One source for uv**: the uv pin becomes a named stage, `FROM ghcr.io/astral-sh/uv:<tag>@sha256:<digest> AS uv`, which is a form Dependabot's docker updater handles. `ci.yml` reads the version from that line before `setup-uv` and fails if it can't find it. A Dependabot uv bump therefore updates CI as well.
- **Grouping, to keep PR noise low**:
  - `github-actions` weekly, all in one PR.
  - `docker` weekly, one group.
  - `npm` monthly, in two groups: `angular` (`@angular/*`, `@angular-devkit/*`, `@schematics/angular`, minor+patch) and `npm-minor-patch` for the rest. Other packages' majors arrive individually. At most 3 npm PRs are open at a time.
  - `uv` monthly, with minor+patch in one group and majors individually. At most 3 open.
  - Security updates are not grouped.
- **Left to humans**:
  - Angular majors and TypeScript minors and majors. These go through `ng update`, and Angular pins the TypeScript range it supports.
  - Node and Python base-image majors and minors. The Node major decides the npm version that writes `package-lock.json`, and CI and the image run `npm ci` with npm 10 (Node 22). A Python minor changes the runtime.
- **A 7-day cooldown** applies to every ecosystem: a release is proposed only once it is a week old, which avoids picking up a hijacked release before it is yanked.
- **No separate image-build job in `ci.yml`.** `publish.yml` already builds the image on every pull request (including Dependabot's), smoke-tests it and never pushes. That run is the check for lockfile and `npm ci` drift inside the image.

## Consequences

- Action SHAs, the uv pin and dependencies get updated without anyone having to remember. Commit messages follow conventional commits: `ci(deps)` for actions, `chore(deps)` and `chore(deps-dev)` for the rest.
- Dependabot regenerates `package-lock.json` with its own bundled npm. If that lockfile doesn't satisfy npm 10, `npm ci` fails in CI and in the image build on that PR, so it can't merge silently. The fix is to regenerate the lockfile on the PR branch with `npx -y npm@10 install --package-lock-only --ignore-scripts`.
- Dependabot PRs run CI with a read-only token and no secrets. Nothing in CI or in publish.yml's PR path needs either.
- If someone changes the shape of the uv `FROM` line, CI fails at "uv version from Dockerfile" rather than silently using a different uv.
- The runner image (`ubuntu-24.04`) isn't an ecosystem Dependabot handles, so it stays a manual bump.
