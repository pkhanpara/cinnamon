# Cinnamon

A self-hosted portfolio tracker in the spirit of Yahoo Finance, for people who hold accounts at
several brokerages. Import each account's positions, then view them combined or for any subset of
accounts, with live prices.

- **Accounts and imports:** one account per brokerage account; positions are imported from CSV
  (preview, then confirm). Re-importing replaces that account's positions.
- **Home:** holdings across all or ticked accounts: total value, day change, gain/loss, allocation
  donut, sortable table, merged rows that expand to per-account lines.
- **Ticker pages:** click any symbol (or use the search box) for a price chart (1D to All), key statistics,
  your position across accounts, and news. Works for symbols you don't hold.
- **Live prices:** Finnhub quotes with a short cache. Without an API key the app falls back to the
  values in your imported files and says so.
- **Multi-user:** local accounts, an admin who manages users.
- **Stack:** FastAPI + SQLAlchemy + Alembic + SQLite, Angular, one Docker image. Price history comes from Yahoo
  Finance through the unofficial `yfinance` package, so it may break without notice.

Status: early. Robinhood and M1 each need a real export sample before a native parser exists; for now
use the generic "positions snapshot" CSV below.

## Run it

### Docker

```sh
cp .env.example .env        # then put your Finnhub key in FINNHUB_API_KEY (free key at finnhub.io)
docker compose up --build
```

Open http://localhost:8000. The database lives in the `cinnamon-data` volume.

> The Docker image was last verified before the auth, import and holdings work was added. If the build or
> start fails, please open an issue.

### Development

```sh
# backend (Python 3.12, uv). Creates and migrates the database on start.
cd backend && uv sync && uv run uvicorn app.main:app --reload

# frontend (Node 20.19+/22.12+/24, proxies /api to :8000)
cd frontend && npm install && npx ng serve
```

Open http://localhost:4200.

## First sign-in

On a brand-new database Cinnamon creates one administrator:

| Username | Password        |
|----------|-----------------|
| `admin`  | `$admin123456`  |

The password is public (it is in this repository), so **you are required to change it at first
sign-in**: nothing else in the app works until you do. In a shell, quote it: `'$admin123456'`.
Then add other people under **Settings → User setup**.

Do not expose a fresh instance to an untrusted network before changing that password.

### Lost a password?

An operator with shell access can reset any user's password (there is deliberately no web route
for this). The new password is read from a prompt or stdin, never from arguments. The user is
signed out everywhere and must choose a new password at next sign-in. Deactivated users are not
re-enabled; do that under Settings → Users first.

```
# dev (uses DATABASE_URL / .env)
cd backend && uv run python -m app.cli reset-password admin

# Docker (prompts twice)
docker compose exec cinnamon python -m app.cli reset-password admin
# non-interactive
printf '%s' "$NEWPW" | docker compose exec -T cinnamon python -m app.cli reset-password admin
```

It is safe to run while the server is up. If the container is stopped, use
`docker compose run --rm cinnamon python -m app.cli reset-password admin`.

## Importing holdings

Settings → Accounts → add an account → **Import**. The generic CSV format:

```csv
symbol,quantity,cost_basis,name,market_value,price_used,as_of
ORCL,40,5200.00,Oracle Corporation,6800.00,170.00,2026-01-01T00:00:00Z
```

Required: `symbol`, `quantity`, `cost_basis`. Optional: `name`, `market_value`, `price_used`, `as_of`.
One row per symbol, max 5000 rows and 2 MB. The preview lists every problem with its line number;
a file with any error cannot be imported. Examples with made-up numbers: `seed/sample/`.

## Configuration

Environment variables or `.env` (never commit it; it is git-ignored).

| Variable | Default | Meaning |
|---|---|---|
| `FINNHUB_API_KEY` | empty | Live quotes. Empty = imported values only. |
| `DATABASE_URL` | `sqlite:///./data/cinnamon.db` | SQLite file; its folder is created if missing. |
| `AUTO_MIGRATE` | `true` | Run Alembic and seed the default admin on start. |
| `QUOTE_TTL_SECONDS` | `60` | How long a quote is cached (Finnhub free tier: 60 calls/min). |
| `LLM_BASE_URL`, `LLM_MODEL` | empty | OpenAI-compatible chat endpoint (e.g. `http://<host>:<port>/v1`) and model name for the ticker page's "Ask AI" panel. Both must be set, else the panel is hidden. |
| `LLM_DISABLE_THINKING` | `true` | Asks llama.cpp/llama-swap thinking models (e.g. `dt-default`) to skip their reasoning, which otherwise eats the token budget. Set `false` for OpenAI, which rejects the extra field. |
| `LLM_API_KEY` | empty | Sent as a Bearer token if set (not needed for most local servers). |
| `LLM_MAX_TOKENS` | `96000` | Ceiling on the answer length, not a target. Lower it for hosted models with smaller limits. |
| `LLM_TIMEOUT_SECONDS`, `LLM_MAX_NEWS_ITEMS` | `60`, `15` | Silence allowed between streamed chunks; headlines per prompt. |
| `SESSION_DAYS` | `30` | Sign-in lifetime. |
| `COOKIE_SECURE` | `false` | Set `true` when served over HTTPS (e.g. behind a reverse proxy). |
| `DEFAULT_ADMIN_USERNAME`, `DEFAULT_ADMIN_PASSWORD` | `admin`, `$admin123456` | Used only to seed an empty database. |

## Tests

```sh
cd backend  && uv run pytest -q && uv run ruff check .
cd frontend && CI=1 npx ng test --watch=false && npx ng build
```

## Your data

Everything stays on your machine. The only outbound calls are made by the server: Finnhub (symbols, plus the
search text you type) and Yahoo Finance (symbols, for price history). Your holdings and quantities are never sent.
If you configure an LLM (`LLM_BASE_URL`), the server also sends that endpoint the symbol, today's price change,
public headlines and summaries, and your questions when you use "Ask AI"; your position in that symbol
(quantity, cost basis, value) goes only when you tick the box for that conversation. Use a local server to keep it on your network.
This is a public repository: keep real exports and database files out of git. `seed/private/` and
`*.db` are ignored for that reason.

## Project layout

`backend/` API (`app/connectors` file parsers, `app/providers` market data) · `frontend/` Angular UI ·
`docs/adrs/` design decisions · `docs/log/` work logs · `docs/TODO.md` · `seed/` sample data.
