import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from './auth.service';
import { LLM_FETCH, LlmEvent, LlmService } from './llm.service';

const enc = new TextEncoder();
const REQ = { preset: 'summarize' as const, history: [], include_position: false };

function streamResponse(chunks: Uint8Array[], status = 200): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        chunks.forEach((x) => c.enqueue(x));
        c.close();
      },
    }),
    { status },
  );
}
const frame = (event: string, data: object) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function setup(fetchImpl: typeof fetch) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: LLM_FETCH, useValue: fetchImpl }],
  });
  const router = TestBed.inject(Router);
  const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  return { svc: TestBed.inject(LlmService), nav, auth: TestBed.inject(AuthService) };
}

async function collect(it: AsyncGenerator<LlmEvent>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('LlmService', () => {
  it('asks for the status over HttpClient', () => {
    const m = setup(vi.fn());
    m.svc.status().subscribe();
    TestBed.inject(HttpTestingController).expectOne('/api/llm/status').flush({ enabled: true, model: 'm' });
  });

  it('posts JSON with the session cookie and yields events until done, even when frames and UTF-8 are split', async () => {
    const bytes = enc.encode(frame('delta', { text: 'café' }) + frame('warning', { message: 'w' }) + frame('done', {}));
    const cut = bytes.indexOf(0xa9); // inside the two-byte "é"
    const fetchFn = vi.fn(async () => streamResponse([bytes.slice(0, cut), bytes.slice(cut)]));
    const m = setup(fetchFn as unknown as typeof fetch);

    const events = await collect(m.svc.chat('BRK.B', REQ, new AbortController().signal));

    expect(events).toEqual([{ type: 'delta', text: 'café' }, { type: 'warning', message: 'w' }, { type: 'done' }]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/llm/BRK.B/chat');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(JSON.parse(init.body as string)).toEqual(REQ);
  });

  it('stops at an error event', async () => {
    const body = enc.encode(frame('delta', { text: 'a' }) + frame('error', { message: 'boom' }) + frame('delta', { text: 'late' }));
    const m = setup((async () => streamResponse([body])) as unknown as typeof fetch);
    expect(await collect(m.svc.chat('X', REQ, new AbortController().signal))).toEqual([
      { type: 'delta', text: 'a' },
      { type: 'error', message: 'boom' },
    ]);
  });

  it('reports a stream that ends without done', async () => {
    const m = setup((async () => streamResponse([enc.encode(frame('delta', { text: 'a' }))])) as unknown as typeof fetch);
    const events = await collect(m.svc.chat('X', REQ, new AbortController().signal));
    expect(events.at(-1)).toEqual({ type: 'error', message: 'The answer ended unexpectedly' });
  });

  it('turns a refusal before streaming into a readable error', async () => {
    const res = new Response(JSON.stringify({ detail: 'The language model is not configured (set LLM_BASE_URL and LLM_MODEL).' }), { status: 503 });
    const m = setup((async () => res) as unknown as typeof fetch);
    await expect(collect(m.svc.chat('X', REQ, new AbortController().signal))).rejects.toThrow(/not configured/);
  });

  it('treats a 401 like the interceptor: clear the session and go to /login', async () => {
    const m = setup((async () => new Response(JSON.stringify({ detail: 'Not authenticated' }), { status: 401 })) as unknown as typeof fetch);
    const clear = vi.spyOn(m.auth, 'clear');
    await expect(collect(m.svc.chat('X', REQ, new AbortController().signal))).rejects.toThrow('Not authenticated');
    expect(clear).toHaveBeenCalled();
    expect(m.nav).toHaveBeenCalledWith('/login');
  });

  it('reports an unreachable server', async () => {
    const m = setup((async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    await expect(collect(m.svc.chat('X', REQ, new AbortController().signal))).rejects.toThrow('Cannot reach the server');
  });

  it('ends quietly when aborted mid-stream', async () => {
    const ctl = new AbortController();
    let streamCtl!: ReadableStreamDefaultController<Uint8Array>;
    const fetchFn = async (_u: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({ start: (c) => (streamCtl = c) });
      init.signal!.addEventListener('abort', () => streamCtl.error(new DOMException('aborted', 'AbortError')));
      return new Response(body);
    };
    const m = setup(fetchFn as unknown as typeof fetch);
    const done = collect(m.svc.chat('X', REQ, ctl.signal));
    await new Promise((r) => setTimeout(r));
    streamCtl.enqueue(enc.encode(frame('delta', { text: 'part' })));
    await new Promise((r) => setTimeout(r));
    ctl.abort();
    expect(await done).toEqual([{ type: 'delta', text: 'part' }]);
  });
});
