# Move development to deepthought (`/rpool/server-data/repos/cinnamon`)

Status: in progress

## Why

Development moves from threadripper (`~/repo/cinnamon`) to deepthought, with the dev UI reached
from other machines at `http://deepthought:4200` and the same test account as the threadripper
dev DB. Two things blocked a plain `git clone` + `npm start` there:

- port 8000 on deepthought is published by `ddns-updater` (`0.0.0.0:8000->8000/tcp`), and
  `frontend/proxy.conf.json` hard-coded `http://localhost:8000`;
- `ng serve` binds to localhost, and Angular 21's Vite dev server returns **403 "Blocked request"**
  for any `Host` it doesn't know, so `deepthought:4200` would be refused even when bound to 0.0.0.0.

## Pre-flight findings

Checked over `ssh deepthought` before changing anything:

| | result |
|---|---|
| existing clone | `/rpool/server-data/repos/cinnamon` exists, clean, at `dcdd1e1` (#23), 4 merges behind main (`e7c6443`) |
| GitHub SSH from deepthought | `Hi pkhanpara!` (works) |
| `uv` | not installed (not in `~/.local/bin` or `~/.cargo/bin`) |
| node | nvm; default `22` -> v22.17.0 (npm 10, matches CI); v24.20.0 also installed |
| `sqlite3` CLI | not installed |
| ports | `:8000` = ddns-updater; `:4200`, `:8010` free |
| docker `cinnamon` container | `homelab/cinnamon:local`, DB bind-mounted from `/rpool/server-data/repos/homelab/config/cinnamon/data` (the deployed instance, separate DB; not touched) |

Git-ignored state on threadripper that a clone does not bring:

```
!! .claude/              settings.local.json (browser-tool allowlist, skill overrides)
!! .env                  FINNHUB_API_KEY, LLM_BASE_URL (=http://deepthought:9292, works there too), LLM_MODEL
!! backend/data/         cinnamon.db 581632 B + -wal 288432 B + -shm (dev DB, holds the test account)
!! seed/private/         6 real broker exports
```

plus Claude Code's path-keyed project memory
`~/.claude/projects/-home-poojan-repo-cinnamon/memory/` (3 notes + MEMORY.md). Hindsight memory is
already shared (bank `qwen-code` on deepthought), so nothing to do there.

## Design

- **Env-driven dev proxy.** `frontend/proxy.conf.json` -> `frontend/proxy.conf.mjs` reading
  `CINNAMON_BACKEND_PORT` (default `8000`, so threadripper and CI behave exactly as before), same
  shape as `e2e/proxy.e2e.mjs`. Rejected: an untracked per-machine proxy JSON (works, but every new
  machine re-invents it and it shows up as untracked noise); moving ddns-updater (not ours to move).
- **`allowedHosts: ["deepthought"]` in `angular.json`.** Measured on threadripper with a host
  header of `threadripper` (ng serve on 0.0.0.0:42xx):

  | how | `Host: threadripper` | `Host: evil` |
  |---|---|---|
  | `--allowed-hosts threadripper` | ng fails: `Argument: project, Given: "threadripper"` | - |
  | `--allowed-hosts=threadripper --allowed-hosts=foo` | 403 | - |
  | bare `--allowed-hosts` (boolean true) | 200 | (check disabled) |
  | `"allowedHosts": ["threadripper"]` in angular.json | **200** | **403** |

  The CLI array form is silently dropped by `ng serve` 21; the boolean form switches off the
  DNS-rebinding check entirely. The angular.json list keeps the check and only names a LAN host,
  so that is what is committed. Other machines add their host name there.
- DB is copied as an online `sqlite3.Connection.backup()` snapshot (WAL folded in), not the live
  `.db`/`-wal`/`-shm` trio, so the copy is consistent without stopping the threadripper dev server.

## What was done

1. Proxy smoke test on threadripper (backend on 8011 against a scratch DB, ng serve on 4211 with
   `CINNAMON_BACKEND_PORT=8011`): `GET :4211/api/auth/me` -> **401** from the backend (proxy follows
   the env var); with the backend down -> 500 + `connect ECONNREFUSED 127.0.0.1:8011` in the ng log.
2. Host check results: table above.

## Still to do

- deepthought setup: pull, install uv, copy DB/.env/seed/memory, `uv sync`, `npm ci`, run, verify.

## Gotchas

- `ng serve --allowed-hosts=<name>` is a no-op in Angular 21 (array options from the CLI are
  dropped); use angular.json.
- Signing in at `deepthought:4200` needs a fresh login: the session cookie is per host.
- After the copy, the two dev DBs diverge; deepthought's is the one to keep.
- **Two agents in one working tree collide.** While this change was in progress, another session
  in the same `~/repo/cinnamon` checkout switched branches and committed #28 (`9ff957c`), which
  swept in this task's staged `git rm frontend/proxy.conf.json`. `origin/main` was briefly left with
  `angular.json` pointing at a missing `proxy.conf.json` (`npm start` broken) until this PR landed.
  This task's commit had also landed on local `main`; it was moved with
  `git branch -f chore/dev-proxy-port 19c8068 && git checkout chore/dev-proxy-port && git branch -f main origin/main`.
  Use a worktree per agent (`.claude/worktrees/`) when two sessions work at once.
