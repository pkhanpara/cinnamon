# Ask AI panel: scrollable log and "New chat" button

Touches `frontend/src/app/components/news-chat/news-chat.ts` and `news-chat.spec.ts` only. Branch `fix/chat-panel-scroll-clear`.

## Why
Found while testing the first build of the LLM news chat (ADR 0008, TODO item "AI chat panel fixes"):
- long answers are cut off because the message log cannot be scrolled;
- no way to start a fresh conversation without leaving the ticker.

## Pre-flight findings
- Root cause, from reading `news-chat.ts` styles: `.panel` is a fixed flex column with `overflow-y: auto` on the whole `aside`; `.log` has `flex: 1` but no `min-height: 0` and no overflow of its own. Flex items default to `min-height: auto`, so the log grows to its content instead of shrinking and scrolling.
- `reset()` already does everything "New chat" needs (seq++, abort, clear messages/warnings/error/draft, position off, busy off, lastRequest null), because changing symbol uses it.
- `npm ci` was still running in `frontend/` (pid 843472) when work started; tests are run only after it finishes.

## Design
- Log is the scroll area: `.panel` overflow hidden, non-log children `flex: none`, `.log` `flex: 1 1 0; min-height: 0; overflow-y: auto`.
- Follow the stream: `following` flag, true when within 24px of the bottom (updated from the log's `scroll` event); an `afterRenderEffect` on `messages()` scrolls to the bottom while `following`. Sending a question, reset and opening the panel force `following = true`.
  - Rejected: `scrollIntoView` on a sentinel (also scrolls ancestors, awkward in jsdom); ResizeObserver (messages signal is the only thing that grows the log).
- "New chat" button in the header, disabled when there is nothing to clear (no messages, warnings, error or draft); calls `reset()`, then focuses the textarea. Stays enabled while streaming (that is the point).
- jsdom has no layout, so scroll tests give the log fake `scrollHeight`/`clientHeight`/`scrollTop`.

## What was done
1. Wrote 9 new tests first in `news-chat.spec.ts` (4 scrolling, 5 New chat); `FakeChat` now records the latest request's `signal`.
2. Implemented in `news-chat.ts`: log scroll area CSS, `following` flag + `onLogScroll()` + `afterRenderEffect` on `messages()`, `hasContent` computed, `clear()` (= `reset()` + focus textarea), header "New chat" button. `open.set(...)` calls became `openPanel()` / `close()`.
3. First run, `npx ng test --watch=false --include='src/app/components/news-chat/news-chat.spec.ts'`: 21 passed, 1 failed - jsdom's computed style does not expand the `overflow` shorthand (`overflowY` was `''`). Changed the panel rule to `overflow-y: hidden`.
4. Full run after the fix: `npm test -- --watch=false` -> 20 files, 177 tests passed. `npm run build` OK.
Not done: I wrote the implementation before running the new tests, so there is no recorded red baseline on the old code.

## Still to do
- Not checked in a real browser (no LLM endpoint configured here): the flex/overflow behaviour is asserted only through jsdom computed styles and faked scroll metrics. Worth one manual look with a long answer.
- Very short windows: header, presets, checkbox and form are `flex: none`, so the log can shrink to nothing; if that bites, give `.log` a `min-height` and let `.panel` scroll as a fallback.
- Playwright coverage of the panel still waits on the fake-OpenAI-server item already in TODO.md.

## Gotchas
- jsdom: no layout (`scrollHeight`/`clientHeight` are 0, `scrollTop` is inert), and shorthand `overflow` is not expanded to `overflow-y` in computed style. Scroll tests define fake metrics on the element.
- `reset()` is shared by "symbol changed" and "New chat", so the two cannot drift apart.
