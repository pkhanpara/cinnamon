### Todo

- [ ] Scaffold backend (FastAPI + SQLAlchemy 2 + Alembic + SQLite) #feat  
- [ ] Scaffold frontend (Angular) #feat  
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

- [ ] Phase 1 scaffold (secrets hygiene, seed data, ADR 0001 done; app skeletons pending)  

### Done ✓

- [x] Create public repo pkhanpara/cinnamon and set origin  
- [x] .gitignore, .env (git-ignored), .env.example  
- [x] Seed generator + private/sample seed CSVs  
