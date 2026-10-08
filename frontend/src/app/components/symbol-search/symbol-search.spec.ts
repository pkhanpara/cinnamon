import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { SymbolSearch } from './symbol-search';

const HITS = [
  { symbol: 'NVDA', description: 'NVIDIA Corp', type: 'Common Stock' },
  { symbol: 'NVDL', description: 'GraniteShares 2x NVDA', type: 'ETP' },
];

function setup() {
  vi.useFakeTimers();
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const http = TestBed.inject(HttpTestingController);
  const f = TestBed.createComponent(SymbolSearch);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const input = el.querySelector('input') as HTMLInputElement;
  const type = (v: string) => {
    input.value = v;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  };
  const key = (k: string) => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    f.detectChanges();
  };
  const settle = async (ms = 300) => {
    await vi.advanceTimersByTimeAsync(ms);
    f.detectChanges();
  };
  const options = () =>
    Array.from(el.querySelectorAll('[role=option]')).map(
      (o) => o.querySelector('strong')?.textContent,
    );
  return { f, el, http, nav, type, key, settle, options, input };
}

afterEach(() => vi.useRealTimers());

describe('SymbolSearch', () => {
  it('waits for a pause in typing, then searches once with the trimmed text', async () => {
    const m = setup();
    m.type('n');
    await m.settle(100);
    m.type('nv');
    await m.settle(100);
    m.type(' nvid ');
    await m.settle(299);
    m.http.expectNone('/api/symbols/search?q=nvid');
    await m.settle(1);
    m.http
      .expectOne((r) => r.url === '/api/symbols/search' && r.params.get('q') === 'nvid')
      .flush(HITS);
    m.f.detectChanges();
    expect(m.options()).toEqual(['NVDA', 'NVDL']);
  });

  it('does not search for blank input and closes the list', async () => {
    const m = setup();
    m.type('   ');
    await m.settle();
    m.http.expectNone((r) => r.url === '/api/symbols/search');
    expect(m.el.querySelector('[role=listbox]')).toBeNull();
  });

  it('typing again cancels the in-flight search, so a late answer can never overwrite the newer one', async () => {
    const m = setup();
    m.type('nv');
    await m.settle();
    const first = m.http.expectOne((r) => r.params.get('q') === 'nv');
    expect(first.cancelled).toBe(false);
    m.type('nvd');
    await m.settle();
    expect(first.cancelled).toBe(true);
    m.http.expectOne((r) => r.params.get('q') === 'nvd').flush([HITS[0]]);
    m.f.detectChanges();
    expect(m.options()).toEqual(['NVDA']);
  });

  it('clicking a result navigates to it and resets the box', async () => {
    const m = setup();
    m.type('nv');
    await m.settle();
    m.http.expectOne((r) => r.url === '/api/symbols/search').flush(HITS);
    m.f.detectChanges();
    (m.el.querySelectorAll('[role=option]')[1] as HTMLElement).dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true }),
    );
    expect(m.nav).toHaveBeenCalledWith(['/symbol', 'NVDL']);
    m.f.detectChanges();
    expect(m.input.value).toBe('');
    expect(m.el.querySelector('[role=listbox]')).toBeNull();
  });

  it('arrow keys wrap through the results and the "nothing highlighted" slot; Enter opens the highlighted one', async () => {
    const m = setup();
    m.type('nv');
    await m.settle();
    m.http.expectOne((r) => r.url === '/api/symbols/search').flush(HITS);
    m.f.detectChanges();
    const active = () => m.input.getAttribute('aria-activedescendant');
    expect(active()).toBeNull();
    m.key('ArrowDown');
    expect(active()).toBe('sr-0');
    m.key('ArrowDown');
    expect(active()).toBe('sr-1');
    m.key('ArrowDown');
    expect(active()).toBeNull(); // wraps through "none"
    m.key('ArrowUp');
    expect(active()).toBe('sr-1'); // and back
    m.key('Enter');
    expect(m.nav).toHaveBeenCalledWith(['/symbol', 'NVDL']);
  });

  it('Enter with no highlight opens the exact symbol if it is a result, else the first result', async () => {
    const m = setup();
    m.type('nvdl');
    await m.settle();
    m.http.expectOne((r) => r.url === '/api/symbols/search').flush(HITS);
    m.key('Enter');
    expect(m.nav).toHaveBeenLastCalledWith(['/symbol', 'NVDL']);
    m.type('nvid');
    await m.settle();
    m.http.expectOne((r) => r.url === '/api/symbols/search').flush(HITS);
    m.key('Enter');
    expect(m.nav).toHaveBeenLastCalledWith(['/symbol', 'NVDA']); // "nvid" is no symbol: first result, not a 404 page
  });

  it('Enter before the search answered opens the typed symbol, upper-cased', async () => {
    const m = setup();
    m.type('brk.b');
    m.key('Enter');
    expect(m.nav).toHaveBeenCalledWith(['/symbol', 'BRK.B']);
  });

  it('Enter on text that cannot be a symbol and has no results does nothing', async () => {
    const m = setup();
    m.type('not a symbol!');
    m.key('Enter');
    expect(m.nav).not.toHaveBeenCalled();
  });

  it('shows the server message when search is unavailable, and still allows Enter', async () => {
    const m = setup();
    m.type('nv');
    await m.settle();
    m.http
      .expectOne((r) => r.url === '/api/symbols/search')
      .flush(
        { detail: 'Symbol search needs FINNHUB_API_KEY to be set.' },
        { status: 503, statusText: 'Unavailable' },
      );
    m.f.detectChanges();
    expect(m.el.querySelector('.msg')?.textContent).toContain('FINNHUB_API_KEY');
    m.key('Enter');
    expect(m.nav).toHaveBeenCalledWith(['/symbol', 'NV']);
  });

  it('Escape and clicking elsewhere close the list', async () => {
    const m = setup();
    m.type('nv');
    await m.settle();
    m.http.expectOne((r) => r.url === '/api/symbols/search').flush(HITS);
    m.f.detectChanges();
    m.key('Escape');
    expect(m.el.querySelector('[role=listbox]')).toBeNull();
    m.type('nvd');
    await m.settle();
    m.http.expectOne((r) => r.url === '/api/symbols/search').flush(HITS);
    m.f.detectChanges();
    document.body.click();
    m.f.detectChanges();
    expect(m.el.querySelector('[role=listbox]')).toBeNull();
  });
});
