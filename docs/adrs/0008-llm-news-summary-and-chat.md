# 0008 - LLM news summary and chat on the ticker page

Status: Accepted (2026-10-07); exercised against llama-swap `dt-default` on 2026-10-07

## Context
The ticker page (ADR 0006) lists up to 20 headlines. The user wants a one-click summary of them and a chat panel with
preset questions, first "Why is the stock up/down today?", answered by a language model behind an OpenAI-compatible API.
Forces:
- **Privacy.** This is a self-hosted portfolio tracker; the only outbound calls so far are symbols to Finnhub and Yahoo
  (README "Your data"). A model endpoint can be on the LAN (llama-swap) or a paid third party.
- **Untrusted input.** News headlines and summaries are written by third parties and can contain prompt injection.
- **Slow models.** A local model, especially a "thinking" one, can take tens of seconds to the first token.
- **Shared checkout.** Other work touches `api/symbols.py` and the news section, so this feature should live in new files.

Answers from the user (2026-10-07): target a local llama-swap first; configuration from the environment only;
stream with SSE; no per-user rate limit for now.

## Decision
- **Provider seam.** `LlmProvider` Protocol (`providers/llm.py`) with one method, `stream_chat(messages, max_tokens)`
  yielding text deltas, and `OpenAICompatLlm` speaking `POST {base}/chat/completions` with `stream: true`. It works unchanged
  against llama-swap, Ollama and OpenAI. `reasoning_content` deltas are dropped. Like the other providers it never touches the
  database and raises `ProviderError`; messages never include the key or request body.
- **Configuration** (`config.py`, env / `.env`, never the database): `LLM_BASE_URL`, `LLM_MODEL`, optional `LLM_API_KEY`,
  `LLM_DISABLE_THINKING` (true), `LLM_TIMEOUT_SECONDS` (60), `LLM_MAX_TOKENS` (96000), `LLM_MAX_NEWS_ITEMS` (15). URL or model unset means the feature is off:
  `GET /api/llm/status` says `enabled: false` and the UI shows nothing.
- **Endpoints** (`api/llm.py`, behind `current_user`): `GET /api/llm/status`; `POST /api/llm/{symbol}/chat` with
  `{preset | message, history, include_position}` returning `text/event-stream` with events `delta`, `warning`, `error`, `done`.
  Problems known before streaming (401, 422, 503 not configured, 409 nothing to talk about) are ordinary HTTP errors.
  All database, quote and news work finishes before the stream starts (the request's DB session is closed by then); the
  generator touches only the provider. Mid-stream failures become an `error` event. News is read from the same
  `company_cache` entry the News section uses, so it costs no extra Finnhub call.
- **Presets are server-side templates** (`summarize`, `why_move`), so the client cannot smuggle instructions or numbers through them.
  `why_move` is fed today's price, previous close, change and the news of the last 24 hours (else the latest few, labelled older).
- **What is sent by default:** the symbol, today's quote numbers, headline text and summaries (capped at 15 items, 200 and 500
  characters), the user's question and up to 10 earlier turns (each at most 4000 characters). **The user's position is sent only when `include_position` is
  true**, is built on the server from the caller's own accounts, and the UI states what is sent and keeps the box unticked.
- **Prompt injection posture.** Fixed system prompt; article text goes inside a `<data>` block with angle brackets neutralised so it
  cannot close the block; the model is told it is data, not instructions; no tools, no link-following, no URLs requested; the
  answer is rendered as plain text. Honest limit: delimiting reduces but does not eliminate injection. The remaining blast radius
  is a misleading answer shown to the user who asked.
- **No rate limit yet.** Size caps and the timeout stay (they bound a single request); a per-user request limit or token budget is a TODO.
- **Frontend.** Streaming uses `fetch` + `ReadableStream` with an `AbortController` (Angular's `HttpClient` cannot stream), a pure SSE parser,
  and a side panel component mounted by one line on the ticker page. Conversations live in the tab only.

## Alternatives rejected
- Admin-editable settings in the database: needs a table, a migration and encrypting the key at rest; env matches `FINNHUB_API_KEY`.
- One-shot JSON: simpler, but a slow local model would show a bare spinner for a minute. Streaming keeps the same provider interface.
- Tool use, web search or link-following by the model: widens the injection blast radius for no stated need.
- Markdown rendering now: needs a sanitiser; plain text first, sanitised markdown later.
- Persisting chats: no stated need, and it would store model output derived from the user's holdings.
- Sending the position by default: against the TODO's privacy rule.

## Consequences
+ Works with any OpenAI-compatible server; off and invisible when unconfigured; no schema change.
+ Local models keep news text and holdings on the LAN; a hosted endpoint receives the data above, and the README says so.
- Anyone signed in can trigger model calls without limit (cost with a paid key, GPU load with llama-swap; a request can also evict
  the model someone else is using on a shared server) until the TODO is done.
- SSE needs a proxy that does not buffer (`X-Accel-Buffering: no` is sent); the 200 status is committed before errors can happen.
- Answers can be wrong or confidently attribute a move to unrelated news; the prompt asks the model to say when the news does not explain it.
- `LlmProvider` lives in `providers/llm.py` rather than `providers/base.py` to avoid editing shared files; it may move later.

## Addendum (live check, 2026-10-07)
Against `http://<llama-swap-host>:<port>/v1`, model alias `dt-default` (a Qwen3.6 thinking model): with `max_tokens` 600 the stream held 600
`reasoning_content` chunks, no content, and `finish_reason: length` (an empty answer); with 2000 it answered after ~350 reasoning chunks;
with `chat_template_kwargs: {"enable_thinking": false}` it answered in ~34 chunks at either limit. So: `LLM_DISABLE_THINKING` sends that field
(default on after the live check; set false for hosted APIs such as OpenAI that may reject unknown fields), and the provider turns `finish_reason: length` into an explicit error instead of an
empty or silently truncated answer. The system prompt now forbids markdown, because the model otherwise sent `**bold**` that a plain-text panel shows as asterisks.

Follow-up (same day, user decision): thinking is disabled by default and `LLM_MAX_TOKENS` defaults to 96000 (user-settable). Trade-offs: an OpenAI
endpoint needs `LLM_DISABLE_THINKING=false` and a lower `LLM_MAX_TOKENS`; with a ceiling that high a runaway answer is bounded only by the 60 s
silence timeout and the user pressing Stop, which matters more while there is no rate limit.
