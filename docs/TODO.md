### Todo

- [ ] Click a holdings row to open the ticker detail page #feat  
- [ ] Cash balances (the PDF had $14,177.37 cash; totals currently exclude cash) #feat  
- [ ] Quote fetching beyond 60 distinct symbols/min: batch or queue #chore  
- [ ] Persist holdings account selection per user on the server (currently per browser) #feat  
- [ ] Holdings: CSV export of the current view #feat  
- [ ] Show positions of one account (read-only table) on the accounts page #feat  
- [ ] Import: undo/restore previous snapshot if replace-and-discard proves too risky #feat  
- [ ] Users page: allow deleting a user and show created_at / last login #feat  
- [ ] Replace window.confirm in account delete with an in-app dialog #chore  
- [ ] Rebuild/verify Docker image with auth + UI; add frontend tests to CI #chore  
- [ ] Login rate limiting / lockout #sec  
- [ ] Self-service password change; optional TOTP 2FA #feat  
- [ ] Friendlier username-pattern 422 message on the setup/users forms #ux  
- [ ] Make /auth/setup atomic (race on simultaneous first requests) #sec  
- [ ] Serialize timestamps as UTC (SQLite drops tzinfo; API shows naive created_at) #bug  
- [ ] Pin the uv image tag in Dockerfile (currently :latest) #chore  
- [ ] Add a docs/ README with run instructions #docs  
- [ ] Upgrade Angular 21 -> 22 (needs Node >= 24.15; machine has 24.4.1) #chore  
- [ ] Real Robinhood / M1 CSV parsers (need real sample exports from user) #feat  
- [ ] Holdings aggregation API + account-checkbox UI #feat  
- [ ] yfinance history provider + Finnhub news/profile + ticker detail page (quote, chart, news) #feat  
- [ ] Transactions, cost basis (avg-cost; ADR 0005), watchlists #feat  
- [ ] Daily snapshots, performance + allocation charts #feat  
- [ ] Decide whether to rotate the Finnhub key (it was pasted into a chat transcript) #chore  
- [ ] Remaining ADRs 0002-0005 #docs  

### In Progress

- [ ] Phase 1 scaffold (skeletons, Docker, auth, users, accounts and CSV import done; Docker image still needs rebuild + verify)  

### Done ✓

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
