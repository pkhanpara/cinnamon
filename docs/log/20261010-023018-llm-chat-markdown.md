# LLM chat: sanitized markdown, more presets, e2e happy path, copy export

*Status: done (PR open)* · branch `feat/llm-chat-markdown` · ADR [0015](../adrs/0015-llm-chat-markdown-and-export.md)

## Why

TODO "LLM news chat follow-ups (ADR 0008)" had these open items:
- Answers are plain text. The system prompt forbids markdown because `**bold**` showed up as literal asterisks. Models still slip into markdown now and then, and lists and bold would read better.
- There were only 2 presets (`summarize`, `why_move`). The TODO asked for earnings, risks and compare-with-sector.
- e2e only proves the app works *without* an LLM. Nothing exercises backend → model → SSE → UI.
- Chats live only in the tab. The TODO says "persist or export if wanted". Scope here is copy-to-clipboard export only.

## Pre-flight findings

- **Does the chat endpoint 409 without a Finnhub key (as in e2e)? Yes.** `backend/app/api/llm.py` `chat()` raises 409 when `quote is None and not news`. With `FINNHUB_API_KEY=''`, `get_company_provider()` returns None, so there is no news. `quotes.get_quotes(..., provider=None)` only returns a quote when a `quote_cache` row already exists (an expired row is served `stale=True`, `quotes.py` lines 82-89). Nothing writes `quote_cache` without a provider, and imports don't either.
  → The e2e spec seeds one `quote_cache` row through the app's own model (`e2e/support.ts` `seedQuote`). No product change.
- `grep -n "llm\|Ask AI" frontend/e2e/*.ts` → no hits, so enabling the LLM for the shared e2e backend shouldn't break the existing assertions.
- The company profile is cached as `company_cache[("profile", symbol)]` (`api/symbols.py:134`), so `compare_sector` can read the industry without an extra Finnhub call.
- `node --version` → v24.4.1.

## Design

See ADR 0015. In short: `marked` → `DOMPurify` with a tag allow-list. Raw HTML is escaped, not parsed. Links are kept only for http(s) and open with `rel="noopener noreferrer nofollow"`. There are no images. Angular's `[innerHTML]` sanitizer is a second layer.

Rejected for the e2e 409:
1. A fake Finnhub. It would switch live data on for every spec and need many endpoints emulated.
2. Relaxing the 409. That changes product behaviour just to suit a test.
3. `page.route` mocking the chat. It skips the backend → model path, which is what we want to test.

## What was done

1. **Backend presets + prompt** (`backend/app/llm_prompts.py`): `Preset` gains `earnings`, `risks` and `compare_sector`, each with a server-side question. The system prompt now allows "light markdown" (bold, `- ` lists) and still says "No links". New `industry_block()` (neutralised, inside `<data>`) is added only for `compare_sector`.
2. **Industry for compare_sector** (`backend/app/api/llm.py`): only that preset reads `company_cache[("profile", symbol)]` with `PROFILE_TTL` (the ticker page's entry). A `ProviderError` becomes a warning, and with no key the prompt says there is no sector data.
3. Backend tests (`tests/test_llm_prompts.py`, `tests/test_llm_api.py`): every preset has a question; markdown allowed but no links; industry is neutralised and only sent for compare_sector; the profile is read once and then served from the cache; a profile failure is a warning; the new presets stream to `done`.
   ```
   cd backend && uv run ruff format . && uv run ruff check . && uv run pytest -q
   82 files left unchanged / All checks passed! / 514 passed, 1 warning in 49.45s
   ```
4. **Deps** (`frontend/package.json` + lockfile), with npm 10 for CI's `npm ci`:
   ```
   npx -y npm@10 install marked@^16 dompurify@^3   → marked ^16.4.2, dompurify ^3.4.16
   npm audit --omit=dev                            → found 0 vulnerabilities
   ```
   Checked first that Angular's sanitizer (`HTML_ATTRS` in `@angular/core` `_debug_node-chunk.mjs`) allows `href rel target align start` and all chosen tags, so the two layers don't fight (no "sanitizing HTML stripped some content" warning).
5. **`frontend/src/app/core/markdown.ts`**: `renderMarkdown`, `isSafeUrl`, `conversationMarkdown`, plus `markdown.spec.ts` (19 tests: javascript/mixed-case/entity-encoded/data/vbscript/relative/protocol-relative links, script/img onerror/iframe/markdown image/onclick, unfinished markdown, copy format).
6. **`components/news-chat/news-chat.ts`**: the 3 new presets; assistant bubbles are `[innerHTML]="rendered()[$index]"` (memoised per index; the cursor stays after the block); a Copy button + `role=status` note; `Preset` in `core/llm.service.ts`. Spec: 3 existing tests failed only on a trailing `\n` in the textContent of the rendered `<p>`, so the helper now trims. Added 5 tests (presets list, markdown while streaming + unsafe link, Copy disabled while busy + exact markdown, clipboard refusal) → 26 passed.
7. **e2e**: `e2e/fake-llm.mjs` (OpenAI SSE, fixed answer with a `javascript:` link and a `<script>`; `GET /last-request` exposes the prompt the backend sent). `playwright.config.ts` adds `CINNAMON_E2E_LLM_PORT` (default 8311; all three ports must differ), runs the fake as the 2nd webServer (after the backend, whose command recreates the work dir its log lives in), and gives the backend env `LLM_BASE_URL/LLM_MODEL=fake-llm`. `e2e/support.ts` `seedQuote()` upserts a `QuoteCache` row via `uv run python -` with the app's own `SessionLocal`. New `e2e/news-chat.spec.ts` on the unused ticker `CNMN`.
   - First run: 22 passed, 1 failed. My spec's own console audit caught `Failed to load resource` 401 (`/auth/me` before sign-in) and 2× 503 (the symbol page's news/search without a key). Those are expected, and first-login filters that echo out too. Fixed by judging responses instead, only for `/api/llm/`.
   ```
   CINNAMON_E2E_BACKEND_PORT=8347 CINNAMON_E2E_FRONTEND_PORT=4347 CINNAMON_E2E_LLM_PORT=8348 \
     CINNAMON_E2E_DIR=/tmp/cinnamon-e2e-8347 npm run e2e
   23 passed (18.6s)   # first-login audit still green; backend.log: POST /api/llm/CNMN/chat 200
   ```
8. **Mutation check**: with `isSafeUrl` forced to `true`, the e2e spec **still passed** (see Gotchas) and `markdown.spec.ts` failed 3 tests (relative, protocol-relative, isSafeUrl). Restored from a scratch copy, then verified `grep -c MUTANT` → 0.
9. Frontend gate:
   ```
   npm run format:check → All matched files use Prettier code style!
   npm run typecheck    → clean
   npm run test:ci      → 29 files, 258 passed
   npm run build        → no warnings; Initial total 474.82 kB; symbol chunk 119.42 kB (34.95 kB gzip)
   grep -l DOMPurify dist/frontend/browser/*.js → only the lazy symbol chunk; index.html loads main only
   ```
10. Docs: ADR 0015; ADR 0008's status line notes the partial supersession; TODO items updated.

## Still to do

- Eyeball real-model markdown in a browser with a Finnhub key, all 5 presets (in e2e only the "no sector data" branch of compare_sector runs). Added to TODO.
- Copy fails over plain-HTTP LAN (no Clipboard API outside a secure context). The panel says so. A fallback or "Download .md" is in TODO.
- Server-side chat persistence: deliberately not done (Copy covers export). Still in TODO.

## Gotchas

- **Without a Finnhub key the chat 409s**, because nothing writes `quote_cache` without a provider. Any future e2e of the chat needs `seedQuote` (or news).
- **The e2e can't tell the hook apart from DOMPurify's defaults.** DOMPurify's built-in URI policy already drops `javascript:` hrefs (and Angular would too), so a broken `isSafeUrl` doesn't fail the e2e. The unit spec's relative/protocol-relative cases are what guard the hook.
- Playwright runs spec files alphabetically on one shared DB, so `news-chat` runs between `first-login` and `returning-user`. It uses `adminSession()` and a ticker no other spec or seed file uses (`CNMN`), so its seeded quote can't change later holdings.
- Text content of a rendered answer ends with `\n` (from `<p>`), so tests comparing exact bubble text must trim.
- The webServer order matters: anything logging into `$E2E_DIR` must start after the backend's `rm -rf && mkdir`.
