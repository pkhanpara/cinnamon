### Todo

- [ ] Upgrade Angular 21 -> 22 (needs Node >= 24.15; machine has 24.4.1) #chore  
- [ ] Dockerfile + docker-compose.yml #feat  
- [ ] Auth: multi-user, Argon2, session cookie, first-run admin #feat  
- [ ] Connector interface + positions-snapshot CSV importer #feat  
- [ ] Real Robinhood / M1 CSV parsers (need real sample exports from user) #feat  
- [ ] Holdings aggregation API + account-checkbox UI #feat  
- [ ] Finnhub quotes/news + yfinance history providers #feat  
- [ ] Transactions, cost basis (avg-cost; ADR 0005), watchlists #feat  
- [ ] Daily snapshots, performance + allocation charts #feat  
- [ ] Decide whether to rotate the Finnhub key (it was pasted into a chat transcript) #chore  
- [ ] Remaining ADRs 0002-0005 #docs  

### In Progress

- [ ] Phase 1 scaffold (skeletons done; Dockerfile/compose and first Alembic migration pending)  

### Done ✓

- [x] Create public repo pkhanpara/cinnamon and set origin  
- [x] .gitignore, .env (git-ignored), .env.example  
- [x] Seed generator + private/sample seed CSVs  
- [x] FastAPI skeleton (config, db, Alembic, /api/health, pytest)  
- [x] Angular 21 skeleton with dev proxy and health call  
