# Publish the Docker image nightly instead of per merge (2026-10-10)

## Why
`publish.yml` pushed an image to ghcr.io/pkhanpara/cinnamon on every push to `main` (ADR 0016). User asked for a nightly image from main instead.

## Design
- Trigger: `schedule` cron `0 7 * * *` (runs on the default branch). `push: branches` removed; `push: tags v*.*.*`, `pull_request` (build + smoke, no push) and `workflow_dispatch` kept.
- New `changes` job gates the nightly: skip when HEAD of main is older than 25 h (90000 s), so quiet nights do not republish an identical image. Other triggers always build.
- Tags on a nightly: `nightly`, `nightly-YYYYMMDD`, `latest`, `main`, `sha-<short>`.
- Rejected: keeping per-merge pushes plus nightly (defeats the point); a separate nightly workflow (duplicates the build/smoke steps).

## What was done
- Edited .github/workflows/publish.yml and ADR 0016 (amended in place). YAML parses; not yet run on GitHub.

## Still to do
- After merge, run the workflow once via `workflow_dispatch` to confirm tags; the cron only fires from the default branch.

## Gotchas
- `latest` can lag a merge by up to ~24 h; dispatch the workflow for an urgent fix.
- GitHub disables scheduled workflows after 60 days without repo activity.
