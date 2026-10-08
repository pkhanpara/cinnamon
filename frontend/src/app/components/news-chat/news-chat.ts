import {
  Component, DestroyRef, ElementRef, afterRenderEffect, computed, effect, inject, input, signal, untracked, viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { ChatRequest, ChatTurn, LlmService, Preset } from '../../core/llm.service';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'summarize', label: 'Summarize the news' },
  { value: 'why_move', label: 'Why is the stock up/down today?' },
];
const MESSAGE_MAX = 500;
const HISTORY_MAX = 10;
const TURN_MAX = 4000; // the server rejects longer turns
const BOTTOM_SLACK = 24; // px from the bottom of the log that still counts as "following"

/** Ask-AI side panel for the ticker page (ADR 0008). Renders nothing unless the server has a model configured. */
@Component({
  selector: 'app-news-chat',
  template: `
    @if (status()?.enabled) {
      @if (!open()) {
        <button type="button" class="ask" (click)="openPanel()">Ask AI</button>
      } @else {
        <aside class="panel" role="complementary" aria-label="Ask AI" (keydown.escape)="close()">
          <header>
            <h3>Ask AI about {{ symbol() }}</h3>
            <span class="actions">
              <button type="button" class="link" [disabled]="!hasContent()" (click)="clear()">New chat</button>
              <button type="button" class="link" (click)="close()" aria-label="Close panel">Close</button>
            </span>
          </header>
          <p class="hint">Model: {{ status()?.model }}. Answers can be wrong; check the sources.</p>

          <div class="presets" role="group" aria-label="Preset questions">
            @for (p of presets; track p.value) {
              <button type="button" [disabled]="busy()" (click)="sendPreset(p.value, p.label)">{{ p.label }}</button>
            }
          </div>

          <label class="opt">
            <input type="checkbox" [checked]="includePosition()" (change)="togglePosition($event)" />
            Include my {{ symbol() }} position (quantity, cost basis, value)
          </label>
          <p class="hint sent" data-testid="sent-note">{{ sentNote() }}</p>

          <div class="log" #log aria-live="polite" (scroll)="onLogScroll()">
            @for (m of messages(); track $index) {
              <p class="msg" [class.user]="m.role === 'user'">{{ m.text }}@if (busy() && $last && m.role === 'assistant') {<span class="cursor">▍</span>}</p>
            }
          </div>
          @for (w of warnings(); track w) { <p class="warn" role="note">{{ w }}</p> }
          @if (error()) {
            <p class="error" role="alert">{{ error() }}
              @if (lastRequest) { <button type="button" class="link" (click)="retry()">Retry</button> }</p>
          }

          <form (submit)="$event.preventDefault(); sendDraft()">
            <textarea #draftBox rows="2" [maxLength]="max" [value]="draft()" (input)="onDraft($event)" [disabled]="busy()"
                      placeholder="Ask a question about the news" aria-label="Your question"></textarea>
            <div class="row">
              <span class="hint">{{ draft().length }}/{{ max }}</span>
              @if (busy()) {
                <button type="button" (click)="stop()">Stop</button>
              } @else {
                <button type="submit" [disabled]="!draft().trim()">Send</button>
              }
            </div>
          </form>
        </aside>
      }
    }
  `,
  styles: `
    .ask { position: fixed; right: 1rem; bottom: 1rem; z-index: 10; }
    .panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(26rem, 100vw); z-index: 20; display: flex; flex-direction: column;
      gap: 0.5rem; padding: 0.75rem 1rem; overflow-y: hidden; background: Canvas; color: CanvasText; border-left: 1px solid var(--border, #ccc); }
    .panel > :not(.log) { flex: none; }
    header { display: flex; justify-content: space-between; align-items: baseline; }
    h3 { margin: 0; }
    .actions { display: flex; gap: 0.75rem; }
    .presets { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .opt { display: flex; gap: 0.4rem; align-items: center; }
    .sent { margin: 0; font-size: 0.85em; }
    .log { flex: 1 1 0; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; }
    .msg { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .msg.user { font-weight: 600; }
    .cursor { opacity: 0.5; }
    textarea { width: 100%; box-sizing: border-box; font: inherit; }
    .row { display: flex; justify-content: space-between; align-items: center; }
  `,
})
export class NewsChat {
  readonly symbol = input.required<string>();

  private readonly api = inject(LlmService);
  protected readonly status = toSignal(this.api.status().pipe(catchError(() => of(null))), { initialValue: null });
  protected readonly presets = PRESETS;
  protected readonly max = MESSAGE_MAX;

  protected readonly open = signal(false);
  protected readonly messages = signal<Msg[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly warnings = signal<string[]>([]);
  protected readonly draft = signal('');
  protected readonly includePosition = signal(false);
  protected readonly hasContent = computed(
    () => this.messages().length > 0 || this.warnings().length > 0 || !!this.error() || !!this.draft(),
  );
  protected readonly sentNote = computed(
    () =>
      `Sent to ${this.status()?.model ?? 'the model'}: the symbol, today's price change and public headlines` +
      (this.includePosition() ? ', and your position in this symbol.' : '. Your holdings are not sent.'),
  );

  /** The request behind the last answer, kept so Retry can resend it. */
  protected lastRequest: { req: Omit<ChatRequest, 'history'>; label: string } | null = null;
  private abort: AbortController | null = null;
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  private readonly draftBox = viewChild<ElementRef<HTMLTextAreaElement>>('draftBox');
  private following = true; // keep the newest text in view unless the user scrolled up
  private seq = 0; // a stream from a previous symbol or request must never write into a newer one

  constructor() {
    effect(() => {
      this.symbol();
      untracked(() => this.reset());
    });
    afterRenderEffect(() => {
      this.messages();
      const el = this.log()?.nativeElement;
      if (el && this.following) el.scrollTop = el.scrollHeight;
    });
    inject(DestroyRef).onDestroy(() => this.abort?.abort());
  }

  protected openPanel(): void {
    this.following = true;
    this.open.set(true);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected onLogScroll(): void {
    const el = this.log()?.nativeElement;
    if (el) this.following = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK;
  }

  /** "New chat": drop the conversation, including any stream still running. */
  protected clear(): void {
    this.reset();
    this.draftBox()?.nativeElement.focus();
  }

  private reset(): void {
    this.following = true;
    this.seq++;
    this.abort?.abort();
    this.abort = null;
    this.messages.set([]);
    this.warnings.set([]);
    this.error.set('');
    this.draft.set('');
    this.includePosition.set(false); // an opt-in applies to one symbol's conversation only
    this.busy.set(false);
    this.lastRequest = null;
  }

  protected togglePosition(e: Event): void {
    this.includePosition.set((e.target as HTMLInputElement).checked);
  }

  protected onDraft(e: Event): void {
    this.draft.set((e.target as HTMLTextAreaElement).value);
  }

  protected sendPreset(preset: Preset, label: string): void {
    void this.run({ preset, include_position: this.includePosition() }, label);
  }

  protected sendDraft(): void {
    const message = this.draft().trim();
    if (!message || this.busy()) return;
    this.draft.set('');
    void this.run({ message, include_position: this.includePosition() }, message);
  }

  protected stop(): void {
    this.abort?.abort();
  }

  protected retry(): void {
    const last = this.lastRequest;
    if (!last || this.busy()) return;
    // A failed attempt with an empty answer is already gone; drop a partial one before asking again.
    if (this.error()) this.messages.update((m) => (m[m.length - 1]?.role === 'assistant' ? m.slice(0, -2) : m));
    void this.run({ ...last.req, include_position: this.includePosition() }, last.label);
  }

  private async run(req: Omit<ChatRequest, 'history'>, label: string): Promise<void> {
    if (this.busy()) return;
    const symbol = this.symbol();
    const seq = ++this.seq;
    this.following = true; // a new question should show itself and its answer
    const history: ChatTurn[] = this.messages()
      .filter((m) => m.text)
      .slice(-HISTORY_MAX)
      .map((m) => ({ role: m.role, content: m.text.slice(0, TURN_MAX) }));
    this.lastRequest = { req, label };
    this.error.set('');
    this.warnings.set([]);
    this.messages.update((m) => [...m, { role: 'user', text: label }, { role: 'assistant', text: '' }]);
    this.busy.set(true);
    const abort = (this.abort = new AbortController());

    try {
      for await (const ev of this.api.chat(symbol, { ...req, history }, abort.signal)) {
        if (seq !== this.seq) return;
        if (ev.type === 'delta') {
          this.messages.update((m) => {
            const copy = m.slice();
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = { ...last, text: last.text + ev.text };
            return copy;
          });
        } else if (ev.type === 'warning') {
          this.warnings.update((w) => [...w, ev.message]);
        } else if (ev.type === 'error') {
          this.error.set(ev.message);
        }
      }
    } catch (e) {
      if (seq === this.seq) this.error.set(e instanceof Error ? e.message : 'The request failed');
    } finally {
      if (seq === this.seq) {
        this.busy.set(false);
        this.abort = null;
        // A question that got no answer at all is dropped, so the history never holds an unanswered turn.
        if (this.error()) {
          this.messages.update((m) => (m[m.length - 1]?.role === 'assistant' && !m[m.length - 1].text ? m.slice(0, -2) : m));
        }
      }
    }
  }
}
