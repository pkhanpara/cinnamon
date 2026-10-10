# 0015 - Ask AI: sanitized markdown answers, more presets, copy export

Status: Accepted (2026-10-10). Supersedes the "rendered as plain text" and "no markdown" parts of ADR 0008.

## Context
ADR 0008 shipped the Ask AI panel with plain-text answers and deferred markdown ("needs a sanitiser; plain text first,
sanitised markdown later"). Its addendum then made the system prompt forbid markdown, because `**bold**` showed up as
literal asterisks. Models still slip into markdown now and then. Bullet lists and bold key figures also read better in
a narrow side panel than prose does.
Forces:
- **The answer is untrusted.** The model read third-party news (prompt injection is possible, ADR 0008), so its
  output must be treated like any user-supplied HTML: no script, no event handlers, no `javascript:`/`data:` links,
  no remote images (tracking pixels that would leak the viewer's IP and the fact that they opened the panel).
- **Streaming.** The text is re-rendered on every delta, and markdown is often incomplete mid-stream.
- **Bundle size.** The parser should not land in the initial bundle.
- **More presets.** The TODO asked for earnings, risks and compare-with-sector. The data sent stays the same (quote +
  news, ADR 0008 privacy note). There are no new providers or calls.
- **e2e.** The suite only proved the app works *without* a model. Without a Finnhub key a symbol has no quote or news,
  and the chat answers 409.

Alternatives considered:
- *Angular's `[innerHTML]` sanitizer alone.* It allows `img` and many attributes, and it warns rather than shaping
  the output. It's fine as a second layer, but it's not the policy.
- *A markdown renderer with its own "safe mode" (e.g. markdown-it with html off).* It still needs a URL policy and
  an element allow-list. DOMPurify is the well-reviewed tool for exactly that.
- *Render to Angular nodes from the marked token tree (no innerHTML).* This is the safest in principle, but it means a
  hand-written renderer for every token type. That's a lot of code to own for a small panel.
- *Persisting chats server-side.* That needs a table, retention rules and per-user privacy. Nobody asked for history,
  and "export if wanted" is met by copying to the clipboard.

## Decision
- **Rendering** (`frontend/src/app/core/markdown.ts`): a private `Marked` instance (gfm, breaks) whose `html` and
  `image` renderers escape their text. Raw HTML in the answer is shown as text, and images become their alt text. The
  result goes through a dedicated `DOMPurify` instance:
  - Tag allow-list: `p br strong em del code pre blockquote hr ul ol li a h1-h6 table thead tbody tr th td`.
  - Attribute allow-list: `href align start`.
  - An `afterSanitizeAttributes` hook keeps an `<a href>` only when `new URL(href)` parses with protocol `http:` or
    `https:` (so relative and protocol-relative links are dropped too), and adds `target="_blank"
    rel="noopener noreferrer nofollow"`. A refused link stays as plain text.
  - Every allowed tag and attribute is also on Angular's list, so the `[innerHTML]` sanitizer runs as a second layer
    without having to strip anything (and so without warning).
- **Only assistant bubbles render markdown**; the user's own text stays plain. Rendering is memoised per message index,
  so only the streaming message is re-parsed. Unfinished markdown mid-stream shows as text until it closes.
- **System prompt** now allows "light markdown" (bold, `- ` lists, short paragraphs; no headings, tables, images or code
  blocks) and still says "No links". The sanitizer, not the prompt, is the security boundary.
- **Presets** `earnings`, `risks`, `compare_sector` were added server-side (`app/llm_prompts.py`); the questions never
  come from the client. `compare_sector` adds the company's industry from the ticker page's cached profile
  (`company_cache[("profile", symbol)]`, so normally no extra Finnhub call), inside a `<data>` block and neutralised
  like the news. Without one, the prompt tells the model to say the data has no sector information. The prompt never
  includes peer numbers it doesn't have.
- **Copy**: a header button copies the conversation as markdown *source* (`# Ask AI: SYM`, `**You:** ...`,
  `**AI (model):** ...`) with `navigator.clipboard.writeText`. It's disabled while streaming or when empty. Nothing is
  sent to the server and nothing is stored.
- **e2e happy path**: `frontend/e2e/fake-llm.mjs` (a Node `http` OpenAI-compatible SSE server, port
  `CINNAMON_E2E_LLM_PORT`, default 8311) is a third Playwright `webServer`, and the e2e backend gets `LLM_BASE_URL`
  pointing at it. `e2e/support.ts` `seedQuote` writes one `quote_cache` row through the app's model, so the chat has
  something to talk about without a Finnhub key. No product change was made for the test, and nothing is mocked in the
  browser.

## Consequences
- Good: answers are readable (lists, bold), and the XSS surface is covered by unit tests (scheme variants, entity
  encoding, raw HTML, images, event handlers) plus an end-to-end check that a salted answer arrives neutralised.
- Good: `marked` + `dompurify` (about 35 kB gzip together with the panel) load only with the lazy symbol page. The
  initial bundle is unchanged.
- Risk: two new runtime dependencies on the security path. DOMPurify must be kept up to date. Its default URI policy
  also drops `javascript:` links, so the hook's own value is the stricter "absolute http(s) only" rule. A unit test
  proves that the hook is what removes relative links.
- Risk: the allow-list includes `table`/`pre`. A long table scrolls inside the bubble. If the model ignores "no
  tables", the answer degrades but stays safe.
- The e2e backend now always has a model configured, so the Ask AI button appears in every spec. The fake server must
  stay deterministic.
- Copy depends on the Clipboard API (a secure context). Over plain-HTTP LAN access it fails, and the panel says so.
