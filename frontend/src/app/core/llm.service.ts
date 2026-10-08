import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { apiError } from './errors';
import { AuthService } from './auth.service';
import { CHANGE_PASSWORD } from './auth.guard';
import { SseParser } from './sse';

export interface LlmStatus {
  enabled: boolean;
  model: string | null;
}
export type Preset = 'summarize' | 'why_move';
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}
export interface ChatRequest {
  preset?: Preset;
  message?: string;
  history: ChatTurn[];
  include_position: boolean;
}
export type LlmEvent =
  | { type: 'delta'; text: string }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** Overridable in tests; HttpClient cannot stream a response body, so chat uses fetch. */
export const LLM_FETCH = new InjectionToken<typeof fetch>('LLM_FETCH', {
  providedIn: 'root',
  factory: () => (input, init) => globalThis.fetch(input, init),
});

const PASSWORD_CHANGE_REQUIRED = 'Password change required';

@Injectable({ providedIn: 'root' })
export class LlmService {
  private readonly http = inject(HttpClient);
  private readonly fetchFn = inject(LLM_FETCH);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  status(): Observable<LlmStatus> {
    return this.http.get<LlmStatus>('/api/llm/status');
  }

  /**
   * Stream an answer. Yields events until `done`/`error`; aborting `signal` ends the stream quietly.
   * Problems known before the first byte (not configured, bad input, signed out) throw an Error with a readable message.
   */
  async *chat(symbol: string, req: ChatRequest, signal: AbortSignal): AsyncGenerator<LlmEvent> {
    let res: Response;
    try {
      res = await this.fetchFn(`/api/llm/${encodeURIComponent(symbol)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(req),
        credentials: 'same-origin',
        signal,
      });
    } catch (e) {
      if (signal.aborted) return;
      throw new Error('Cannot reach the server');
    }
    if (!res.ok) throw new Error(await this.failure(res));
    if (!res.body) throw new Error('The server sent no answer');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (e) {
          if (signal.aborted) return;
          yield { type: 'error', message: 'The connection was interrupted' };
          return;
        }
        const text = chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
        for (const ev of parser.push(text)) {
          const parsed = toEvent(ev.event, ev.data);
          if (parsed) yield parsed;
          if (ev.event === 'done' || ev.event === 'error') return;
        }
        if (chunk.done) {
          yield { type: 'error', message: 'The answer ended unexpectedly' };
          return;
        }
      }
    } finally {
      void reader.cancel().catch(() => undefined); // frees the connection; the server then stops the model
    }
  }

  /** Same session handling as authInterceptor, which fetch bypasses. */
  private async failure(res: Response): Promise<string> {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    if (res.status === 401) {
      this.auth.clear();
      void this.router.navigateByUrl('/login');
    } else if (
      res.status === 403 &&
      (body as { detail?: unknown } | null)?.detail === PASSWORD_CHANGE_REQUIRED
    ) {
      this.auth.markPasswordChangeRequired();
      void this.router.navigateByUrl(CHANGE_PASSWORD);
    }
    return apiError(
      new HttpErrorResponse({ status: res.status, error: body }),
      'The request failed',
    );
  }
}

function toEvent(name: string, data: string): LlmEvent | null {
  try {
    const d = JSON.parse(data) as { text?: unknown; message?: unknown };
    if (name === 'delta' && typeof d.text === 'string') return { type: 'delta', text: d.text };
    if (name === 'warning' && typeof d.message === 'string')
      return { type: 'warning', message: d.message };
    if (name === 'error' && typeof d.message === 'string')
      return { type: 'error', message: d.message };
    if (name === 'done') return { type: 'done' };
  } catch {
    /* ignore a malformed frame */
  }
  return null;
}
