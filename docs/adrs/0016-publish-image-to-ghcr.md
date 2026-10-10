# 0016. Publish the Docker image to GHCR

Status: Accepted (2026-10-10)

## Context

Cinnamon ships as one Docker image (ADR 0001), but nothing published it. Every user had to clone the repo and run `docker compose up --build`, which needs the whole Node and uv build and takes minutes. There was also no check that the image still builds and starts: CI (`ci.yml`) tests the backend, frontend and e2e, but not the Dockerfile.

Options weighed:

1. **Don't publish** (status quo): no new moving parts, but every install is a source build and image breakage goes unnoticed.
2. **Docker Hub**: the best-known registry, but it needs a separate account, a long-lived access token stored as a repo secret, and has pull rate limits.
3. **GitHub Container Registry (GHCR)**: lives next to the repo, the workflow pushes with the built-in `GITHUB_TOKEN` (no stored secret), and no pull limits for public images.

Architectures: the build only runs on linux/amd64 today. arm64 through QEMU emulation would run `npm ci`, `ng build` and the wheel installs emulated, which typically makes the build 5-10x slower (estimated 15-25 min instead of ~3). There is no known arm64 user.

## Decision

- A new workflow `.github/workflows/publish.yml` builds the image for **linux/amd64 only** and pushes it to **`ghcr.io/pkhanpara/cinnamon`**, logging in with `GITHUB_TOKEN` (`packages: write` on that job only).
- **Pull requests** build the image and smoke-test it (start the container, `/api/health`, index page served, no `.env`/seed/database files in `/app`), but never log in or push. This also covers fork PRs, which get no write token.
- **Pushes to `main`** publish `latest`, `main` and `sha-<short>`. **Tags `v*.*.*`** publish `X.Y.Z`, `X.Y` and `X`. `latest` follows `main` because there are no releases yet. If a release cadence starts, `latest` can move to tags only.
- The image that is pushed is the image that was smoke-tested: the push step rebuilds from the GHA layer cache with the same inputs and adds provenance and SBOM attestations.
- Actions are pinned by commit SHA with a `# vX` comment, matching `ci.yml`.
- `docker-compose.yml` defaults to `image: ghcr.io/pkhanpara/cinnamon:latest` and keeps `build: .`. `docker compose pull && up` uses the published image, and `up --build` still builds from source.
- The Dockerfile sets `org.opencontainers.image.source`, so the package is linked to the repo even for local builds. `.dockerignore` also excludes local databases, `.claude/`, `.github/`, `scripts/` and Playwright output, on top of `.env*` and `seed/`.

## Consequences

- Installing becomes `docker compose pull && docker compose up -d`, with no toolchain needed.
- A broken Dockerfile now fails a PR check instead of being found by a user.
- GHCR creates a new package as **private**. Someone has to make it public once, by hand (Package settings -> Change visibility). Until then, anonymous pulls fail.
- Pushing a `v*` tag publishes semver tags even when the tag points at a commit that is not on `main`. That is normal Git tag behaviour; don't tag unreviewed commits.
- `latest` moves on every merge, so it can carry a migration the user did not expect. A `sha-` or version tag pins an install.
- A local `docker compose up --build` tags its result as the GHCR name. The README says to set `CINNAMON_IMAGE` to keep them apart.
- Action SHAs need bumping by hand until Dependabot is set up for actions.
- No arm64 image. If one is needed, add a native `ubuntu-24.04-arm` job and merge the manifests (no QEMU cost) instead of emulating.
