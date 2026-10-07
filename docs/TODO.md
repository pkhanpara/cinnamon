### Todo

- [ ] Admin Users page in Angular (create/deactivate/reset password; backend exists) #feat  
- [ ] Replace window.confirm in account delete with an in-app dialog #chore  
- [ ] Rebuild/verify Docker image with auth + UI; add frontend tests to CI #chore  
- [ ] Login rate limiting / lockout #sec  
- [ ] Self-service password change; optional TOTP 2FA #feat  
- [ ] Make /auth/setup atomic (race on simultaneous first requests) #sec  
- [ ] Serialize timestamps as UTC (SQLite drops tzinfo; API shows naive created_at) #bug  
- [ ] Pin the uv image tag in Dockerfile (currently :latest) #chore  
- [ ] Add a docs/ README with run instructions #docs  
- [ ] Upgrade Angular 21 -> 22 (needs Node >= 24.15; machine has 24.4.1) #chore  
- [ ] Connector interface + positions-snapshot CSV importer #feat  
- [ ] Real Robinhood / M1 CSV parsers (need real sample exports from user) #feat  
- [ ] Holdings aggregation API + account-checkbox UI #feat  
- [ ] Finnhub quotes/news + yfinance history providers #feat  
- [ ] Transactions, cost basis (avg-cost; ADR 0005), watchlists #feat  
- [ ] Daily snapshots, performance + allocation charts #feat  
- [ ] Decide whether to rotate the Finnhub key (it was pasted into a chat transcript) #chore  
- [ ] Remaining ADRs 0002-0005 #docs  

### In Progress

- [ ] Phase 1 scaffold (skeletons, Docker, auth backend and login/accounts UI done; ready for import phase)  

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
