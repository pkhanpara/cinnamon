import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { LLM_FETCH } from '../../core/llm.service';
import { NewsChat } from './news-chat';

const enc = new TextEncoder();
const frame = (event: string, data: object) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** A fake /chat endpoint whose answer the test pushes by hand; aborting errors the stream like real fetch. */
class FakeChat {
  calls: { url: string; body: any }[] = [];
  private ctl!: ReadableStreamDefaultController<Uint8Array>;
  refuse: Response | null = null;
  readonly fetch = (async (url: string, init: RequestInit) => {
    this.calls.push({ url, body: JSON.parse(init.body as string) });
    if (this.refuse) return this.refuse;
    const body = new ReadableStream<Uint8Array>({ start: (c) => (this.ctl = c) });
    init.signal!.addEventListener('abort', () => this.ctl.error(new DOMException('aborted', 'AbortError')));
    return new Response(body);
  }) as unknown as typeof fetch;
  push(event: string, data: object) { this.ctl.enqueue(enc.encode(frame(event, data))); }
  end() { this.ctl.close(); }
}

@Component({ imports: [NewsChat], template: `<app-news-chat [symbol]="symbol()" />` })
class Host { symbol = signal('NVDA'); }

async function mount(status: object | 'fail' = { enabled: true, model: 'qwen-test' }) {
  const chat = new FakeChat();
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: LLM_FETCH, useValue: chat.fetch }],
  });
  const http = TestBed.inject(HttpTestingController);
  const f = TestBed.createComponent(Host);
  f.detectChanges();
  const req = http.expectOne('/api/llm/status');
  if (status === 'fail') req.flush('nope', { status: 500, statusText: 'x' }); else req.flush(status);
  const el = f.nativeElement as HTMLElement;
  const settle = async () => { await new Promise((r) => setTimeout(r)); await f.whenStable(); f.detectChanges(); };
  await settle();
  const btn = (re: RegExp) => Array.from(el.querySelectorAll('button')).find((b) => re.test(b.textContent ?? '')) as HTMLButtonElement | undefined;
  const text = () => Array.from(el.querySelectorAll('.msg')).map((m) => m.textContent?.replace('▍', ''));
  const open = async () => { btn(/Ask AI/)!.click(); await settle(); };
  const tick = async () => { (el.querySelector('input[type=checkbox]') as HTMLInputElement).click(); await settle(); };
  return { f, el, chat, settle, btn, text, open, tick, host: f.componentInstance };
}

describe('NewsChat', () => {
  it('renders nothing when the server has no model configured', async () => {
    const m = await mount({ enabled: false, model: null });
    expect(m.el.textContent?.trim()).toBe('');
  });

  it('renders nothing when the status call fails', async () => {
    const m = await mount('fail');
    expect(m.el.textContent?.trim()).toBe('');
  });

  it('opens a labelled side panel naming the model, with the position box off and a "what is sent" note', async () => {
    const m = await mount();
    await m.open();
    expect(m.el.querySelector('aside[role=complementary]')).not.toBeNull();
    expect(m.el.textContent).toContain('qwen-test');
    expect((m.el.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(false);
    const note = m.el.querySelector('[data-testid=sent-note]')!.textContent!;
    expect(note).toContain('Your holdings are not sent');
    await m.tick();
    expect(m.el.querySelector('[data-testid=sent-note]')!.textContent).toContain('and your position in this symbol');
  });

  it('a preset sends only the preset, no position by default, and streams the answer in', async () => {
    const m = await mount();
    await m.open();
    m.btn(/up\/down today/)!.click();
    await m.settle();
    expect(m.chat.calls[0]).toEqual({ url: '/api/llm/NVDA/chat', body: { preset: 'why_move', history: [], include_position: false } });
    expect(m.btn(/Stop/)).toBeDefined();
    m.chat.push('delta', { text: 'It rose ' }); await m.settle();
    expect(m.text()).toEqual(['Why is the stock up/down today?', 'It rose ']);
    m.chat.push('delta', { text: '3%.' }); m.chat.push('done', {}); await m.settle();
    expect(m.text()[1]).toBe('It rose 3%.');
    expect(m.btn(/Send/)).toBeDefined();
  });

  it('sends the position only when ticked', async () => {
    const m = await mount();
    await m.open(); await m.tick();
    m.btn(/Summarize/)!.click(); await m.settle();
    expect(m.chat.calls[0].body.include_position).toBe(true);
  });

  it('shows model output as text, never as markup', async () => {
    const m = await mount();
    await m.open();
    m.btn(/Summarize/)!.click(); await m.settle();
    m.chat.push('delta', { text: '<img src=x onerror=alert(1)><script>alert(2)</script>' }); m.chat.push('done', {}); await m.settle();
    expect(m.el.querySelector('.msg img, .msg script')).toBeNull();
    expect(m.text()[1]).toContain('<script>alert(2)</script>');
  });

  it('a typed question is sent with the earlier turns as history', async () => {
    const m = await mount();
    await m.open();
    m.btn(/Summarize/)!.click(); await m.settle();
    m.chat.push('delta', { text: 'Summary.' }); m.chat.push('done', {}); await m.settle();

    const ta = m.el.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'and the risks?'; ta.dispatchEvent(new Event('input')); await m.settle();
    m.btn(/Send/)!.click(); await m.settle();
    expect(m.chat.calls[1].body).toEqual({
      message: 'and the risks?', include_position: false,
      history: [{ role: 'user', content: 'Summarize the news' }, { role: 'assistant', content: 'Summary.' }],
    });
    expect(ta.value).toBe('');
  });

  it('sends at most the last 10 turns of history, as the server allows', async () => {
    const m = await mount();
    await m.open();
    for (let i = 0; i < 7; i++) {
      const ta = m.el.querySelector('textarea') as HTMLTextAreaElement;
      ta.value = `q${i}`; ta.dispatchEvent(new Event('input')); await m.settle();
      m.btn(/Send/)!.click(); await m.settle();
      m.chat.push('delta', { text: `a${i}` }); m.chat.push('done', {}); await m.settle();
    }
    const history = m.chat.calls[6].body.history;
    expect(history).toHaveLength(10);
    expect(history[0]).toEqual({ role: 'user', content: 'q1' }); // q0/a0 fell off the front
    expect(history[9]).toEqual({ role: 'assistant', content: 'a5' });
  });

  it('Send is disabled for a blank question', async () => {
    const m = await mount();
    await m.open();
    expect(m.btn(/Send/)!.disabled).toBe(true);
  });

  it('Stop aborts the stream and keeps the partial answer', async () => {
    const m = await mount();
    await m.open();
    m.btn(/Summarize/)!.click(); await m.settle();
    m.chat.push('delta', { text: 'Half an ans' }); await m.settle();
    m.btn(/Stop/)!.click(); await m.settle();
    expect(m.text()[1]).toBe('Half an ans');
    expect(m.btn(/Send/)).toBeDefined();
    expect(m.el.querySelector('[role=alert]')).toBeNull();
  });

  it('an error event shows an alert, drops the unanswered question and Retry asks again', async () => {
    const m = await mount();
    await m.open();
    m.btn(/Summarize/)!.click(); await m.settle();
    m.chat.push('warning', { message: 'News unavailable (429).' });
    m.chat.push('error', { message: 'The language model endpoint failed (ReadTimeout)' }); await m.settle();
    expect(m.el.querySelector('[role=alert]')!.textContent).toContain('ReadTimeout');
    expect(m.el.textContent).toContain('News unavailable (429).');
    expect(m.text()).toEqual([]);

    m.btn(/Retry/)!.click(); await m.settle();
    expect(m.chat.calls).toHaveLength(2);
    expect(m.chat.calls[1].body).toEqual({ preset: 'summarize', history: [], include_position: false });
  });

  it('a refusal before streaming (e.g. 503) is shown as the error', async () => {
    const m = await mount();
    m.chat.refuse = new Response(JSON.stringify({ detail: 'There is no quote or news for ZZ to talk about.' }), { status: 409 });
    await m.open();
    m.btn(/Summarize/)!.click(); await m.settle();
    expect(m.el.querySelector('[role=alert]')!.textContent).toContain('no quote or news');
  });

  it('changing symbol aborts the stream and resets the conversation and the position opt-in', async () => {
    const m = await mount();
    await m.open(); await m.tick();
    m.btn(/Summarize/)!.click(); await m.settle();
    m.chat.push('delta', { text: 'old' }); await m.settle();

    m.host.symbol.set('AAPL'); m.f.detectChanges(); await m.settle();
    expect(m.text()).toEqual([]);
    expect((m.el.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(false);
    expect(m.el.textContent).toContain('Ask AI about AAPL');
    expect(m.btn(/Send/)).toBeDefined(); // not stuck busy
  });
});
