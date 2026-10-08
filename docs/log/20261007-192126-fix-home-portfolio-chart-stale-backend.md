# Home portfolio chart not showing: stale backend, misleading "Not Found"

Status: done (code). The user still has to restart their own dev backend.

## Why
TODO bug: "the chart does not show on the Home page in the user's dev app (http://localhost:4200), while the ticker
chart at /symbol/VOO does". Branch `fix/home-portfolio-chart`.

## Pre-flight findings
Reproduced against the user's running dev servers (read-only):

| Check | Result |
|---|---|
| `curl -i 'http://localhost:4200/api/portfolio/history?account_ids=1'` (and `:8000`) | `HTTP/1.1 404 Not Found`, `{"detail":"Not Found"}` |
| `curl -s :8000/openapi.json` paths | no `/api/portfolio/*`; `/api/symbols/*` present (hence the ticker chart works) |
| `ps -eo pid,lstart,cmd` | `uvicorn app.main:app --port 8000` (pid 779788, cwd `~/repo/cinnamon/backend`) **started 2026-10-07 17:03, no `--reload`**; `ng serve` also 17:03 |
| `git log main` / `ls -la --time-style=full-iso backend/app/api/portfolio.py` | PR #13 merged 18:25:38, file written 18:30:02, so the backend predates the endpoint |

`ng serve` watches files and so served the new `PortfolioChart`. That component called the missing route, and
`apiError()` passed FastAPI's unknown-route detail through verbatim. The user saw **"Not Found · Retry"** under
"Portfolio value", which reads like a data problem rather than an out-of-date server.

Checked the current code is fine on a throwaway stack (backend :8410 on an empty SQLite in the session scratchpad, no
Finnhub key, sample `seed/sample/robinhood_positions.csv`; `ng serve --port 4410` with a proxy to :8410):
`GET /api/portfolio/history?account_ids=1&range=1m&compare=spy` returned 200, 22 points, spy `{change_pct: 1.47,
difference_pp: -0.97}`, about 6.3 s cold. In a browser the `.chart` host measured 896×288 with 7 canvases, and a screenshot
showed the line. **No component or endpoint bug.**

Grepped every app-raised 404 detail: `Account not found`, `User not found`, `Unknown symbol …`, `No price history …`.
None of them is a bare `Not Found`.

## Design
- Root cause is operational: restart the backend (`uv run uvicorn app.main:app --reload`, as CLAUDE.md shows). A restart
  also runs PR #14's migration via `AUTO_MIGRATE`.
- Code: `frontend/src/app/core/errors.ts` `apiError()` maps `404` + `detail === 'Not Found'` (FastAPI's unknown-route
  answer) to the exported `STALE_SERVER` message: "This server doesn't know this request. The backend may be older than
  the app: restart it." The mapping is in the shared helper, so every page benefits.
- Rejected: a frontend/backend version handshake (`/api/health` build id compared by the UI). It is more machinery than
  a dev-only failure warrants. Also rejected: hiding the chart section on 404, which would make the failure silent
  again. No ADR (bug fix, no design change).

## What was done
- `frontend/src/app/core/errors.ts`: `STALE_SERVER` + the 404 check before the string-detail branch.
- `frontend/src/app/core/errors.spec.ts`: unknown-route 404 gives `STALE_SERVER`; `Account not found` 404 keeps its text.
- `frontend/src/app/components/portfolio-chart/portfolio-chart.spec.ts`: `next()` can flush a custom `detail`. A new
  case covers 404 `Not Found`: the alert shows `STALE_SERVER`, `setData` is not called, and Retry followed by a 200
  draws the chart.
- Regression check: with the new line commented out, `npx ng test --include=…errors.spec.ts
  --include=…portfolio-chart.spec.ts` gives `2 failed | 13 passed`; restored, it gives `15 passed`.
- `npm test`: `23 passed` files, `204 passed` tests. `npm run build`: "Application bundle generation complete".
  `uv run pytest tests/test_portfolio_history.py`: `24 passed`.
- Manual: temporary `git worktree` at `0079db2` (pre-#13) in the scratchpad, backend on :8411, this branch's
  `ng serve` on :4410. Home showed the alert "This server doesn't know this request. The backend may be older than the
  app: restart it. Retry", with the chart host hidden. Servers stopped and the temp worktree removed afterwards.

## Still to do
- The user restarts their dev backend on :8000 with `--reload`. I left it alone because it runs from the main checkout.
- Without a Finnhub key, Home "Total value" uses imported prices ($12,050 for the sample) while the chart's last point
  uses Yahoo closes ($19,673). Each is expected, but together they look inconsistent; added to TODO.

## Gotchas
- `uvicorn` without `--reload` keeps serving old routes after a merge; `ng serve` hot-reloads, so the UI moves ahead of
  the API. A bare `{"detail":"Not Found"}` 404 is the signature.
- The invisible-browser MCP writes snapshots to `.playwright-mcp/` in the cwd (the worktree) and only allows screenshot
  paths under it. Delete it before committing.
