# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Cinnamon is a self-hosted, multi-user portfolio tracker (Robinhood, M1 Finance, ...). FastAPI + SQLAlchemy 2 + Alembic on SQLite, Angular 21 UI, shipped as one Docker image where FastAPI also serves the built UI. Design rationale lives in `docs/adrs/`; work history in `docs/log/`; backlog in `docs/TODO.md`.

## Commands

Backend (`cd backend`, uses `uv`, Python >= 3.12):
```
uv sync                                  # install incl. dev group
uv run uvicorn app.main:app --reload     # API on :8000 (runs migrations on startup)
uv run pytest                            # all tests
uv run pytest tests/test_holdings_math.py::test_name   # single test
uv run ruff check . && uv run ruff format .            # line length 100
uv run python -m app.cli reset-password <user>         # offline password reset (prompt/stdin)
uv run alembic revision --autogenerate -m "msg"        # new migration (then review it)
```

Frontend (`cd frontend`, Node, npm):
```
npm ci
npm start            # ng serve; proxies /api -> http://localhost:8000 (proxy.conf.json)
npm test             # ng test (Vitest + jsdom); one file: npx ng test --include='src/app/core/auth.spec.ts'
npm run build
npm run e2e          # Playwright end-to-end workflows (see Testing notes)
```

Docker: `docker compose up --build` (port 8000, data volume `cinnamon-data`, reads `.env`). Config comes from env / `.env` (`backend/app/config.py`): `FINNHUB_API_KEY`, `DATABASE_URL`, `DEFAULT_ADMIN_*`, `COOKIE_SECURE`, `AUTO_MIGRATE`, ...

## Architecture

**Backend (`backend/app/`)**
- `main.py`: lifespan runs `alembic upgrade head` (when `auto_migrate`) then `ensure_default_admin` (`bootstrap.py`). Routers mount under `/api`. If `backend/static/` exists (Docker build copies the Angular output there) a catch-all serves the SPA, falling back to `index.html`.
- Auth (ADR 0004): cookie sessions stored hashed in `AuthSession`; argon2 passwords. A fresh DB gets a default admin with `must_change_password=True`. Dependency chain in `api/deps.py`: `session_user` (any signed-in user, used only by `/auth/me` and change-password) -> `current_user` (403s while a password change is pending) -> `require_admin`. New endpoints should depend on `current_user`.
- Two plugin seams, both Protocols with registries/factories, neither touching the DB:
  - `connectors/`: parse a broker export file into `ParsedPosition`s (`ParseResult` carries per-row `RowIssue`s). Register new ones in `connectors/__init__.py`; `for_platform` lists platform-specific then generic ones. Only `SnapshotConnector` (cinnamon's own CSV format) exists; real Robinhood/M1 parsers need real exports.
  - `providers/`: `QuoteProvider` and `CompanyDataProvider` (profile, metrics, news, search) are both implemented by `FinnhubProvider`; `HistoryProvider` by `YFinanceHistory` (Finnhub's candle endpoint is paywalled). `get_company_provider()`/`get_history_provider()` are overridable FastAPI dependencies. `get_quote_provider()` is a FastAPI dependency returning `None` without an API key, in which case holdings fall back to values from the imported file.
- Data flow: CSV import (`api/imports.py`, preview then commit; commit replaces the account's previous snapshot) -> `Position` rows -> `holdings.py` (pure, Decimal-only aggregation across accounts; value precedence live > stale > file > none; rounds to cents per account line so totals equal displayed sums) with prices from `quotes.py` (DB-backed `QuoteCache`, TTL `quote_ttl_seconds`, serves stale rows if the provider fails, process-wide lock against stampedes). All money is assumed USD.
- Symbol page (ADR 0006): `api/symbols.py` (`/api/symbols/search`, `/{symbol}`, `/history`, `/news`) caches slow upstream calls in the in-process `cache.py` `TTLCache` (stale-on-error, single-flight); quotes still use the DB `QuoteCache`. News/profile text is untrusted: only http(s) URLs are kept.
- SQLite quirks: it drops tzinfo, so datetimes read back naive; existing code re-attaches UTC (`_aware`, `deps.py`). Custom column types are in `db_types.py`.

**Frontend (`frontend/src/app/`)**: standalone-component Angular app. `core/` has services (one per API area), `auth.guard`/`auth.interceptor`, and pure helpers with specs (`donut.ts`, `account-selection.ts`, `errors.ts`); `pages/` has one folder per route (login, holdings = Home, symbol, settings shell with accounts/import/users/change-password; users is admin-guarded). `components/price-chart` wraps lightweight-charts behind the injectable `CHART_FACTORY` (lazy-loaded; swap it in tests, jsdom has no canvas); `components/symbol-search` is the header combobox. Shared display formatting is in `core/format.ts`. Holdings account selection is stored per browser, not server-side.

## Testing notes

- `tests/conftest.py` sets `AUTO_MIGRATE=false` before importing the app and builds a fresh in-memory SQLite schema per test (`Base.metadata.create_all`, FKs on) via a `get_db` override, so tests don't exercise Alembic migrations (`test_startup.py` covers that path). The quote provider is overridden to `None` so tests never reach Finnhub even though the dev `.env` has a key; tests that need prices override `get_quote_provider`.
- **End-to-end tests** (`frontend/e2e/`, Playwright, Chromium): `cd frontend && npm run e2e`. One-time browser install: `npx playwright install chromium` (add `--with-deps` on a fresh Linux/CI box). Needs `uv` and free ports (default backend 8310, frontend 4310). `playwright.config.ts` boots its own throwaway stack (plain `uvicorn` on an empty SQLite in the work dir, default `/tmp/cinnamon-e2e`, wiped every run, plus `ng serve`, no Finnhub key), so a running dev server is left alone and no manual setup is needed. To run beside another e2e run (e.g. one per worktree) override all three: `CINNAMON_E2E_BACKEND_PORT=8337 CINNAMON_E2E_FRONTEND_PORT=4337 CINNAMON_E2E_DIR=/tmp/cinnamon-e2e-8337 npm run e2e`. The dev-server proxy `e2e/proxy.e2e.mjs` follows the backend port (the config passes it in; the file has no default). Bad values fail at config load: ports must be 1024-65535 and differ; the dir must be absolute, `[A-Za-z0-9_./-]` only, with a last segment starting `cinnamon-e2e` (it is `rm -rf`ed). A busy port fails fast ("already used"); pick others. Single spec: `npx playwright test returning-user`; one test: `npx playwright test -g "replaces the first"`; watch it: add `--headed` or `--ui`. Failure traces/screenshots land in `<work dir>/results` (`npx playwright show-trace <trace.zip>`); backend/dev-server logs are `<work dir>/{backend,frontend}.log`. Specs run serially in one shared database: `first-login.spec.ts` (fresh install, default admin, forced password change, first import) then `returning-user.spec.ts` (self-contained via `e2e/support.ts` `adminSession()`). The last test of `first-login` is an audit that fails on any browser error, unexpected 4xx/5xx or error line in the logs, so new expected error responses must be added to its allow-list.
- Schema changes need both a model change and an Alembic migration in `backend/migrations/versions/`.

## Repo conventions

- Public repo: `.env` and `seed/private/` (real portfolio data) are git-ignored; `seed/sample/` is fabricated data and `scripts/make_seed.py` generates seeds. Never commit real holdings or keys.
- Per the user's global rules: significant design changes get an ADR in `docs/adrs/` (numbered, with Status/Context/Decision/Consequences); every non-trivial change gets a timestamped log `docs/log/<YYYYMMDD-HHMMSS>-<kebab-title>.md`; leftover work goes into `docs/TODO.md`; commits use conventional-commit format.
