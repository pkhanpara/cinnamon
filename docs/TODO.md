### Todo

- [ ] Seed data: make a few holdings overlap across accounts so merged rows show in the UI #chore  
  - [ ] Extend `scripts/make_seed.py` (today ETFs go to `m1`, everything else to `robinhood`, so nothing overlaps); output stays in git-ignored `seed/private/`  
  - [ ] Split 3-4 symbols (e.g. NVDA, MSFT, VOO) across two or three accounts, keeping the combined totals equal to the PDF's so the cross-check still holds  
  - [ ] Look at the merged-row expand control on Home and the per-account lines on the ticker page with that data, and note any UI problems  
- [ ] News: cache for 30 minutes and add a Refresh button that shows how stale the news is #feat  
  - [ ] Backend: `NEWS_TTL` is 10 min in `api/symbols.py`; make it 30. `NewsListOut` has `stale` but no fetch time, so return the cache's `fetched_at`  
  - [ ] Refresh must bypass the cache but stay inside Finnhub's 60 calls/min (rate-limit it per user, e.g. at most once a minute per symbol) and keep serving the old items if the refresh fails  
  - [ ] Frontend: show "Updated 12 min ago" next to a Refresh button on the ticker page; update the label as time passes; tests and mutation checks as usual  
- [ ] LLM news summary + chat side panel for the ticker page (OpenAI-compatible endpoint) #feat  
  - [ ] Design questions to ask first (ADR 0008): which endpoint (OpenAI, a local llama-swap/Ollama server), where the base URL, model and key live (env, never committed), streaming or not, per-user rate/cost limits  
  - [ ] Privacy: send only public news text and the symbol by default; sending the user's position or holdings should be an explicit opt-in per request, and the UI should say what is sent  
  - [ ] Treat article text as untrusted input (prompt injection): fixed system prompt, news delimited as data, render the answer as plain text or sanitized markdown, no tool use or link-following  
  - [ ] Backend: provider interface (`LlmProvider`, OpenAI-compatible chat completions) like `QuoteProvider`; works with no LLM configured (feature hidden, clear message); timeouts and errors become warnings; tests with a fake provider, never the real endpoint  
  - [ ] Summarize: one-click summary of the cached headlines/summaries for the symbol  
  - [ ] Chat box in a side panel on the ticker page with preloaded prompts, starting with "Why is the stock up/down today?" (feed it the day's change, previous close and the news of the last day); more presets later  
- [ ] Per-user rate limit on symbol search/lookups (Finnhub allows 60 calls/min for everyone) #sec  
- [ ] Rebuild Docker image and check size/build with yfinance (pandas) #chore  
- [ ] Ticker page: previous-close line, candlestick toggle, extended hours, non-US exchanges #feat  
- [ ] Playwright coverage for the ticker page and symbol search (E2E suite lives in frontend/e2e) #test  
- [ ] Ticker page: allow adding a symbol to a watchlist (when watchlists exist) #feat  
- [ ] Admin password reset command (no recovery path if the admin password is lost) #sec  
- [ ] Force a password change for users an admin creates or resets #sec  
- [ ] Optional TOTP 2FA #feat  
- [ ] Friendlier username-pattern 422 message on the Users form #ux  
- [ ] Guard the startup migration/seed against two processes starting at once #chore  
- [ ] Cash balances (the PDF had $14,177.37 cash; totals currently exclude cash) #feat  
- [ ] Quote fetching beyond 60 distinct symbols/min: batch or queue #chore  
- [ ] Persist holdings account selection per user on the server (currently per browser) #feat  
- [ ] Holdings: CSV export of the current view #feat  
- [ ] Show positions of one account (read-only table) on the accounts page #feat  
- [ ] Import: undo/restore previous snapshot if replace-and-discard proves too risky #feat  
- [ ] Users page: allow deleting a user and show created_at / last login #feat  
- [ ] Replace window.confirm in account delete with an in-app dialog #chore  
- [ ] Rebuild/verify Docker image with auth + UI; add frontend tests and `npm run e2e` (needs `playwright install --with-deps chromium`, uv) to CI #chore  
- [ ] E2E: more workflows (CSV error paths, account rename, M1 connector, live-quote holdings) #test  
- [ ] Login rate limiting / lockout #sec  
- [ ] Serialize timestamps as UTC (SQLite drops tzinfo; API shows naive created_at) #bug  
- [ ] Pin the uv image tag in Dockerfile (currently :latest) #chore  
- [ ] Upgrade Angular 21 -> 22 (needs Node >= 24.15; machine has 24.4.1) #chore  
- [ ] Real Robinhood / M1 CSV parsers (need real sample exports from user) #feat  
- [ ] Transactions, cost basis (avg-cost; ADR 0005), watchlists #feat  
- [ ] Daily snapshots, performance + allocation charts #feat  
- [ ] Decide whether to rotate the Finnhub key (it was pasted into a chat transcript) #chore  
- [ ] ADR 0007 cost-basis method (when transactions are built) #docs  

### In Progress

- [ ] Phase 1 scaffold (app features done through holdings; Docker image still needs rebuild + verify; browser E2E suite in progress in a parallel session)  

### Done ✓

- [x] Playwright e2e workflow tests: first-time login + returning user (15 tests)  
- [x] Create public repo pkhanpara/cinnamon and set origin  
- [x] .gitignore, .env (git-ignored), .env.example  
- [x] Seed generator + private/sample seed CSVs  
- [x] FastAPI skeleton (config, db, Alembic, /api/health, pytest)  
- [x] Angular 21 skeleton with dev proxy and health call  
- [x] Dockerfile (multi-stage) + docker-compose.yml, verified running  
- [x] Push to origin/main  
- [x] Auth backend: users, sessions, accounts CRUD, first migration, 19 tests (ADR 0004)  
- [x] Angular setup/login/accounts screens, guards, 401 interceptor, 19 tests, verified in a real browser  
- [x] Admin Users page (create, make/remove admin, deactivate, reset password) + adminGuard + nav, 28 frontend tests, verified with two browser sessions  
- [x] CSV import: connector interface + snapshot connector, preview/confirm API, positions + imports tables, import page, 61 backend + 38 frontend tests, verified in browser with real-derived seed (totals match the PDF)  
- [x] Fix first-admin setup 500: run Alembic on startup + readable 5xx errors  
- [x] ADR 0002 (connector plugins and CSV-first import)  
- [x] Holdings view: Finnhub provider + quote cache, aggregation API, account checkboxes, tiles, donut, sortable/expandable table, 111 backend + 67 frontend tests, verified live in browser (ADR 0003)  
- [x] Default admin seeded on an empty DB with forced password change; change-password page and API; first-run setup removed (ADR 0005)  
- [x] /home landing page and Settings (Accounts, User setup, Change password) with redirects from old URLs  
- [x] README with run instructions, first sign-in, CSV format, configuration (ADR 0005)  
- [x] Ticker detail page: quote header, lightweight-charts price chart (1D-All), key stats, your position, news, header symbol search; yfinance + Finnhub providers with TTL cache (ADR 0006); 212 backend + 129 frontend tests; verified live in a browser  
