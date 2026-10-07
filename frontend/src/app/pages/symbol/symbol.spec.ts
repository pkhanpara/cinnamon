import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { CHART_FACTORY } from '../../components/price-chart/chart-factory';
import { SymbolPage } from './symbol';

const quote = (over = {}) => ({ price: '239.24', prev_close: '238.00', change: '1.24', change_pct: '0.5210', as_of: '2026-10-07T10:00:00Z', stale: false, ...over });
const overview = (over: Record<string, unknown> = {}) => ({
  symbol: 'NVDA', name: 'NVIDIA Corp', quote: quote(),
  profile: { name: 'NVIDIA Corp', exchange: 'NASDAQ', industry: 'Semiconductors', country: 'US', currency: 'USD', web_url: 'https://www.nvidia.com/', market_cap: '5765683852696' },
  stats: { week52_high: '240.10', week52_low: '164.27', avg_volume_10d: '107921380', avg_volume_3m: '134700000' },
  position: null, warnings: [], ...over,
});
const position = {
  symbol: 'NVDA', name: 'NVIDIA Corp', quantity: '927.239', cost_basis: '124694.38', price: '239.24', source: 'live', value: '221832.66',
  gain: '97138.28', gain_pct: '77.9', weight_pct: '32', day_change: null, day_change_pct: null,
  lines: [
    { account_id: 2, account_nickname: 'Roth', platform: 'robinhood', quantity: '10', cost_basis: '1000', value: '2392.40', source: 'live' },
    { account_id: 1, account_nickname: 'Main', platform: 'robinhood', quantity: '917.239', cost_basis: '123694.38', value: '219440.26', source: 'live' },
  ],
};
const history = (range = '6m', over = {}) => ({
  symbol: 'NVDA', range, intraday: false, stale: false, as_of: '2026-10-07T10:00:00Z',
  bars: [{ t: 1, d: '2026-10-05', o: '1', h: '1', l: '1', c: '238', v: 1 }, { t: 2, d: '2026-10-06', o: '1', h: '1', l: '1', c: '239', v: 1 }], ...over,
});
const news = (over = {}) => ({ stale: false, items: [{ headline: 'Chip rally', summary: 'Details here', source: 'Reuters', url: 'https://x.test/a', published_at: '2026-10-07T07:37:00Z' }], ...over });

async function mount(ticker = 'nvda') {
  const params = new BehaviorSubject(convertToParamMap({ ticker }));
  const chart = vi.fn(async () => ({ setData: vi.fn(), destroy: vi.fn() }));
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params } },
      { provide: CHART_FACTORY, useValue: chart },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const f = TestBed.createComponent(SymbolPage);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const settle = async () => { await f.whenStable(); f.detectChanges(); };
  const find = (re: RegExp) => http.match((r) => re.test(r.url));
  const one = (re: RegExp): TestRequest => { const m = find(re); expect(m.length).toBe(1); return m[0]; };
  const c = f.componentInstance as never as Record<string, any>;
  return { f, http, el, params, chart, settle, one, find, c };
}
const OV = /\/api\/symbols\/[A-Z.]+$/, HI = /\/history$/, NE = /\/news$/;

describe('Symbol page', () => {
  it('loads overview, chart (default 6M) and news in parallel for the upper-cased symbol', async () => {
    const m = await mount('nvda');
    expect(m.one(OV).request.url).toBe('/api/symbols/NVDA');
    const h = m.one(HI);
    expect(h.request.params.get('range')).toBe('6m');
    m.one(NE);
  });

  it('renders the header with a signed, coloured change', async () => {
    const m = await mount();
    m.one(OV).flush(overview()); m.one(HI).flush(history()); m.one(NE).flush(news());
    await m.settle();
    expect(m.el.querySelector('h2')?.textContent).toContain('NVIDIA Corp');
    expect(m.el.querySelector('.sym-head .hint')?.textContent).toMatch(/NVDA\s+·\s+NASDAQ\s+·\s+Semiconductors/);
    expect(m.el.querySelector('.price strong')?.textContent).toBe('$239.24');
    const change = m.el.querySelector('.price .gain');
    expect(change?.textContent).toContain('+$1.24');
    expect(change?.textContent).toContain('+0.52%');
  });

  it('shows key stats formatted compactly, and the website as a safe external link', async () => {
    const m = await mount();
    m.one(OV).flush(overview()); m.one(HI).flush(history()); m.one(NE).flush(news());
    await m.settle();
    const t = m.el.querySelector('#stats-h')!.parentElement!.textContent!;
    expect(t).toContain('$164.27 – $240.10');
    expect(t).toContain('$5.77T');
    expect(t).toContain('107.92M');
    const a = m.el.querySelector('#stats-h')!.parentElement!.querySelector('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('shows your merged position with per-account lines, or says you do not hold it', async () => {
    const held = await mount();
    held.one(OV).flush(overview({ position })); held.one(HI).flush(history()); held.one(NE).flush(news());
    await held.settle();
    const pos = held.el.querySelector('#pos-h')!.parentElement!.textContent!;
    expect(pos).toContain('927.239');
    expect(pos).toContain('+$97,138.28 (+77.90%)');
    expect(pos).toContain('Roth: 10 · $2,392.40');
    expect(pos).toContain('Main: 917.239 · $219,440.26');

    TestBed.resetTestingModule();
    const none = await mount();
    none.one(OV).flush(overview()); none.one(HI).flush(history()); none.one(NE).flush(news());
    await none.settle();
    expect(none.el.querySelector('#pos-h')!.parentElement!.textContent).toContain("You don't hold NVDA in any account");
  });

  it('a stale quote is labelled and shows no change', async () => {
    const m = await mount();
    m.one(OV).flush(overview({ quote: quote({ stale: true, change: null, change_pct: null }) })); m.one(HI).flush(history()); m.one(NE).flush(news());
    await m.settle();
    expect(m.el.querySelector('.price')?.textContent).toContain('Last known price');
    expect(m.el.querySelector('.price .gain, .price .loss')).toBeNull();
  });

  it('shows overview warnings', async () => {
    const m = await mount();
    m.one(OV).flush(overview({ warnings: ['Company details unavailable (Finnhub rate limit reached).'] })); m.one(HI).flush(history()); m.one(NE).flush(news());
    await m.settle();
    expect(m.el.querySelector('[role=note]')?.textContent).toContain('rate limit');
  });

  it('gives the loaded history to the chart', async () => {
    const m = await mount();
    m.one(OV).flush(overview()); m.one(HI).flush(history()); m.one(NE).flush(news());
    await m.settle();
    expect(m.chart).toHaveBeenCalledTimes(1);
    expect(m.el.querySelector('app-price-chart')).not.toBeNull();
  });

  it('an unknown symbol shows the server message and a way back', async () => {
    const m = await mount('zzzz');
    m.one(OV).flush({ detail: 'Unknown symbol ZZZZ' }, { status: 404, statusText: 'Not Found' });
    m.one(HI).flush({ detail: 'No price history for ZZZZ' }, { status: 404, statusText: 'Not Found' });
    m.one(NE).flush({ items: [], stale: false });
    await m.settle();
    expect(m.el.querySelector('[role=alert]')?.textContent).toContain('Unknown symbol ZZZZ');
    expect(m.el.querySelector('a[href="/home"]')).not.toBeNull();
    expect(m.el.querySelector('app-price-chart')).toBeNull();
  });

  it('clicking a range refetches with that range and marks it pressed; clicking the active one does nothing', async () => {
    const m = await mount();
    m.one(OV).flush(overview()); m.one(HI).flush(history()); m.one(NE).flush(news());
    await m.settle();
    const btn = (label: string) => Array.from(m.el.querySelectorAll('.ranges button')).find((b) => b.textContent === label) as HTMLButtonElement;
    expect(btn('6M').getAttribute('aria-pressed')).toBe('true');
    btn('6M').click(); expect(m.find(HI)).toHaveLength(0);
    btn('1D').click();
    const r = m.one(HI);
    expect(r.request.params.get('range')).toBe('1d');
    r.flush(history('1d', { intraday: true })); await m.settle();
    expect(btn('1D').getAttribute('aria-pressed')).toBe('true');
    expect(btn('6M').getAttribute('aria-pressed')).toBe('false');
  });

  it('a slow answer for an earlier range never overwrites a newer one', async () => {
    const m = await mount();
    m.one(OV).flush(overview()); m.one(NE).flush(news());
    const first = m.one(HI);                       // 6m, still in flight
    m.c['setRange']('1y');
    const second = m.one(HI);
    second.flush(history('1y')); await m.settle();
    first.flush(history('6m')); await m.settle();   // arrives late
    expect(m.c['history']().range).toBe('1y');
  });

  it('a history failure shows the message with Retry, and Retry asks again', async () => {
    const m = await mount();
    m.one(OV).flush(overview()); m.one(NE).flush(news());
    m.one(HI).flush({ detail: 'Price history is unavailable right now (Yahoo Finance request failed: HTTPError).' }, { status: 502, statusText: 'Bad Gateway' });
    await m.settle();
    expect(m.el.querySelector('[role=alert]')?.textContent).toContain('Price history is unavailable');
    (m.el.querySelector('[role=alert] button') as HTMLButtonElement).click();
    m.one(HI).flush(history()); await m.settle();
    expect(m.el.querySelector('[role=alert]')).toBeNull();
    expect(m.el.querySelector('app-price-chart')).not.toBeNull();
  });

  it('news renders as plain text with safe external links', async () => {
    const m = await mount();
    m.one(OV).flush(overview()); m.one(HI).flush(history());
    m.one(NE).flush(news({ items: [{ headline: '<img src=x onerror=alert(1)>', summary: '<b>bold?</b>', source: 'Reuters', url: 'https://x.test/a', published_at: '2026-10-07T07:37:00Z' }] }));
    await m.settle();
    const li = m.el.querySelector('ul.news li')!;
    expect(li.querySelector('img')).toBeNull();                      // not interpreted as HTML
    expect(li.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(li.querySelector('b')).toBeNull();
    const a = li.querySelector('a')!;
    expect([a.getAttribute('target'), a.getAttribute('rel')]).toEqual(['_blank', 'noopener noreferrer']);
  });

  it('news problems are shown quietly and do not break the rest of the page', async () => {
    const m = await mount();
    m.one(OV).flush(overview()); m.one(HI).flush(history());
    m.one(NE).flush({ detail: 'News needs FINNHUB_API_KEY to be set.' }, { status: 503, statusText: 'Unavailable' });
    await m.settle();
    expect(m.el.querySelector('#news-h')!.parentElement!.textContent).toContain('News needs a Finnhub API key.');
    expect(m.el.querySelector('h2')?.textContent).toContain('NVIDIA Corp');
  });

  it('navigating to another symbol reloads everything and ignores the previous symbol\'s late answers', async () => {
    const m = await mount('nvda');
    const oldOv = m.one(OV); m.one(HI); m.one(NE);
    m.params.next(convertToParamMap({ ticker: 'voo' }));
    m.f.detectChanges(); await m.f.whenStable();
    const newOv = m.one(OV);
    expect(newOv.request.url).toBe('/api/symbols/VOO');
    newOv.flush(overview({ symbol: 'VOO', name: 'Vanguard S&P 500 ETF', profile: null, stats: null }));
    m.find(HI).forEach((r) => r.flush(history()));
    m.find(NE).forEach((r) => r.flush(news()));
    await m.settle();
    expect(oldOv.cancelled).toBe(false);          // plain firstValueFrom: not cancelled, so guard must hold
    oldOv.flush(overview());                        // NVDA's overview arrives late
    await m.settle();
    expect(m.el.querySelector('h2')?.textContent).toContain('Vanguard S&P 500 ETF');
  });
});
