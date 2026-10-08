import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { CHART_FACTORY } from '../../components/price-chart/chart-factory';
import { SymbolPage } from './symbol';

const quote = (over = {}) => ({
  price: '239.24',
  prev_close: '238.00',
  change: '1.24',
  change_pct: '0.5210',
  as_of: '2026-10-07T10:00:00Z',
  stale: false,
  ...over,
});
const overview = (over: Record<string, unknown> = {}) => ({
  symbol: 'NVDA',
  name: 'NVIDIA Corp',
  quote: quote(),
  profile: {
    name: 'NVIDIA Corp',
    exchange: 'NASDAQ',
    industry: 'Semiconductors',
    country: 'US',
    currency: 'USD',
    web_url: 'https://www.nvidia.com/',
    market_cap: '5765683852696',
  },
  stats: {
    week52_high: '240.10',
    week52_low: '164.27',
    avg_volume_10d: '107921380',
    avg_volume_3m: '134700000',
  },
  position: null,
  warnings: [],
  ...over,
});
const position = {
  symbol: 'NVDA',
  name: 'NVIDIA Corp',
  quantity: '927.239',
  cost_basis: '124694.38',
  price: '239.24',
  source: 'live',
  value: '221832.66',
  gain: '97138.28',
  gain_pct: '77.9',
  weight_pct: '32',
  day_change: null,
  day_change_pct: null,
  lines: [
    {
      account_id: 2,
      account_nickname: 'Roth',
      platform: 'robinhood',
      quantity: '10',
      cost_basis: '1000',
      value: '2392.40',
      source: 'live',
    },
    {
      account_id: 1,
      account_nickname: 'Main',
      platform: 'robinhood',
      quantity: '917.239',
      cost_basis: '123694.38',
      value: '219440.26',
      source: 'live',
    },
  ],
};
const history = (range = '6m', over = {}) => ({
  symbol: 'NVDA',
  range,
  intraday: false,
  stale: false,
  as_of: '2026-10-07T10:00:00Z',
  bars: [
    { t: 1, d: '2026-10-05', o: '1', h: '1', l: '1', c: '238', v: 1 },
    { t: 2, d: '2026-10-06', o: '1', h: '1', l: '1', c: '239', v: 1 },
  ],
  ...over,
});
const news = (over = {}) => ({
  stale: false,
  as_of: '2026-10-07T07:40:00Z',
  items: [
    {
      headline: 'Chip rally',
      summary: 'Details here',
      source: 'Reuters',
      url: 'https://x.test/a',
      published_at: '2026-10-07T07:37:00Z',
    },
  ],
  ...over,
});

async function mount(ticker = 'nvda') {
  const params = new BehaviorSubject(convertToParamMap({ ticker }));
  const chart = vi.fn(async () => ({ setData: vi.fn(), destroy: vi.fn() }));
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params } },
      { provide: CHART_FACTORY, useValue: chart },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const f = TestBed.createComponent(SymbolPage);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const settle = async () => {
    await f.whenStable();
    f.detectChanges();
  };
  const find = (re: RegExp) => http.match((r) => re.test(r.url));
  const one = (re: RegExp): TestRequest => {
    const m = find(re);
    expect(m.length).toBe(1);
    return m[0];
  };
  const c = f.componentInstance as never as Record<string, any>;
  return { f, http, el, params, chart, settle, one, find, c };
}
const OV = /\/api\/symbols\/[A-Z.]+$/,
  HI = /\/history$/,
  NE = /\/news$/,
  RF = /\/news\/refresh$/;

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
    m.one(OV).flush(overview());
    m.one(HI).flush(history());
    m.one(NE).flush(news());
    await m.settle();
    expect(m.el.querySelector('h2')?.textContent).toContain('NVIDIA Corp');
    expect(m.el.querySelector('.sym-head .hint')?.textContent).toMatch(
      /NVDA\s+·\s+NASDAQ\s+·\s+Semiconductors/,
    );
    expect(m.el.querySelector('.price strong')?.textContent).toBe('$239.24');
    const change = m.el.querySelector('.price .gain');
    expect(change?.textContent).toContain('+$1.24');
    expect(change?.textContent).toContain('+0.52%');
  });

  it('offers Ask AI for the shown symbol when the server has a model', async () => {
    const m = await mount();
    m.one(OV).flush(overview());
    m.one(HI).flush(history());
    m.one(NE).flush(news());
    await m.settle();
    m.one(/\/api\/llm\/status$/).flush({ enabled: true, model: 'qwen-test' });
    await m.settle();
    expect(m.el.querySelector('app-news-chat button')?.textContent).toContain('Ask AI');
  });

  it('shows no AI controls when the server has no model', async () => {
    const m = await mount();
    m.one(OV).flush(overview());
    m.one(HI).flush(history());
    m.one(NE).flush(news());
    await m.settle();
    m.one(/\/api\/llm\/status$/).flush({ enabled: false, model: null });
    await m.settle();
    expect(m.el.querySelector('app-news-chat button')).toBeNull();
  });

  it('shows key stats formatted compactly, and the website as a safe external link', async () => {
    const m = await mount();
    m.one(OV).flush(overview());
    m.one(HI).flush(history());
    m.one(NE).flush(news());
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
    held.one(OV).flush(overview({ position }));
    held.one(HI).flush(history());
    held.one(NE).flush(news());
    await held.settle();
    const pos = held.el.querySelector('#pos-h')!.parentElement!.textContent!;
    expect(pos).toContain('927.239');
    expect(pos).toContain('+$97,138.28 (+77.90%)');
    expect(pos).toContain('Across all your accounts (2)');
    const rows = Array.from(held.el.querySelectorAll('table.lines tbody tr')).map((r) =>
      r.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(rows[0]).toContain('Roth');
    expect(rows[0]).toContain('10');
    expect(rows[0]).toContain('$1,000.00');
    expect(rows[0]).toContain('$2,392.40');
    expect(rows[0]).toContain('+$1,392.40');
    expect(rows[0]).toContain('+139.24%');
    expect(rows[1]).toContain('Main');
    expect(rows[1]).toContain('917.239');
    expect(rows[1]).toContain('$123,694.38');
    expect(rows[1]).toContain('$219,440.26');
    expect(rows[1]).toContain('+$95,745.88');
    expect(rows[0]).not.toMatch(/robinhood\s+robinhood/);
    expect(held.el.querySelector('.hidden-tag')).toBeNull();

    TestBed.resetTestingModule();
    const none = await mount();
    none.one(OV).flush(overview());
    none.one(HI).flush(history());
    none.one(NE).flush(news());
    await none.settle();
    expect(none.el.querySelector('#pos-h')!.parentElement!.textContent).toContain(
      "You don't hold NVDA in any account",
    );
  });

  it('tags lines whose account is unticked on Home, and handles lines without a price or cost basis', async () => {
    localStorage.setItem(
      'cinnamon.holdings.selection.5',
      JSON.stringify({ selected: [1], known: [1, 2] }),
    );
    const held = await mount();
    (TestBed.inject(AuthService) as unknown as { _user: { set(u: unknown): void } })._user.set({
      id: 5,
      username: 'u',
      is_admin: false,
      is_active: true,
    });
    const lines = [
      { ...position.lines[0], value: null, source: 'none' },
      { ...position.lines[1], cost_basis: '0' },
    ];
    held.one(OV).flush(overview({ position: { ...position, lines } }));
    held.one(HI).flush(history());
    held.one(NE).flush(news());
    await held.settle();
    const tags = Array.from(held.el.querySelectorAll('.hidden-tag'));
    expect(tags).toHaveLength(1);
    expect(tags[0].closest('tr')!.textContent).toContain('Roth');
    const [roth, main] = Array.from(held.el.querySelectorAll('table.lines tbody tr'));
    expect(roth.querySelector('.line-gain')!.textContent!.trim()).toBe('—');
    expect(main.querySelector('.line-gain')!.textContent).not.toContain('%');
    localStorage.clear();
  });

  it('a stale quote is labelled and shows no change', async () => {
    const m = await mount();
    m.one(OV).flush(overview({ quote: quote({ stale: true, change: null, change_pct: null }) }));
    m.one(HI).flush(history());
    m.one(NE).flush(news());
    await m.settle();
    expect(m.el.querySelector('.price')?.textContent).toContain('Last known price');
    expect(m.el.querySelector('.price .gain, .price .loss')).toBeNull();
  });

  it('shows overview warnings', async () => {
    const m = await mount();
    m.one(OV).flush(
      overview({ warnings: ['Company details unavailable (Finnhub rate limit reached).'] }),
    );
    m.one(HI).flush(history());
    m.one(NE).flush(news());
    await m.settle();
    expect(m.el.querySelector('[role=note]')?.textContent).toContain('rate limit');
  });

  it('gives the loaded history to the chart', async () => {
    const m = await mount();
    m.one(OV).flush(overview());
    m.one(HI).flush(history());
    m.one(NE).flush(news());
    await m.settle();
    expect(m.chart).toHaveBeenCalledTimes(1);
    expect(m.el.querySelector('app-price-chart')).not.toBeNull();
  });

  it('an unknown symbol shows the server message and a way back', async () => {
    const m = await mount('zzzz');
    m.one(OV).flush({ detail: 'Unknown symbol ZZZZ' }, { status: 404, statusText: 'Not Found' });
    m.one(HI).flush(
      { detail: 'No price history for ZZZZ' },
      { status: 404, statusText: 'Not Found' },
    );
    m.one(NE).flush({ items: [], stale: false });
    await m.settle();
    expect(m.el.querySelector('[role=alert]')?.textContent).toContain('Unknown symbol ZZZZ');
    expect(m.el.querySelector('a[href="/home"]')).not.toBeNull();
    expect(m.el.querySelector('app-price-chart')).toBeNull();
  });

  it('clicking a range refetches with that range and marks it pressed; clicking the active one does nothing', async () => {
    const m = await mount();
    m.one(OV).flush(overview());
    m.one(HI).flush(history());
    m.one(NE).flush(news());
    await m.settle();
    const btn = (label: string) =>
      Array.from(m.el.querySelectorAll('.ranges button')).find(
        (b) => b.textContent === label,
      ) as HTMLButtonElement;
    expect(btn('6M').getAttribute('aria-pressed')).toBe('true');
    btn('6M').click();
    expect(m.find(HI)).toHaveLength(0);
    btn('1D').click();
    const r = m.one(HI);
    expect(r.request.params.get('range')).toBe('1d');
    r.flush(history('1d', { intraday: true }));
    await m.settle();
    expect(btn('1D').getAttribute('aria-pressed')).toBe('true');
    expect(btn('6M').getAttribute('aria-pressed')).toBe('false');
  });

  it('a slow answer for an earlier range never overwrites a newer one', async () => {
    const m = await mount();
    m.one(OV).flush(overview());
    m.one(NE).flush(news());
    const first = m.one(HI); // 6m, still in flight
    m.c['setRange']('1y');
    const second = m.one(HI);
    second.flush(history('1y'));
    await m.settle();
    first.flush(history('6m'));
    await m.settle(); // arrives late
    expect(m.c['history']().range).toBe('1y');
  });

  it('a history failure shows the message with Retry, and Retry asks again', async () => {
    const m = await mount();
    m.one(OV).flush(overview());
    m.one(NE).flush(news());
    m.one(HI).flush(
      {
        detail: 'Price history is unavailable right now (Yahoo Finance request failed: HTTPError).',
      },
      { status: 502, statusText: 'Bad Gateway' },
    );
    await m.settle();
    expect(m.el.querySelector('[role=alert]')?.textContent).toContain(
      'Price history is unavailable',
    );
    (m.el.querySelector('[role=alert] button') as HTMLButtonElement).click();
    m.one(HI).flush(history());
    await m.settle();
    expect(m.el.querySelector('[role=alert]')).toBeNull();
    expect(m.el.querySelector('app-price-chart')).not.toBeNull();
  });

  it('news renders as plain text with safe external links', async () => {
    const m = await mount();
    m.one(OV).flush(overview());
    m.one(HI).flush(history());
    m.one(NE).flush(
      news({
        items: [
          {
            headline: '<img src=x onerror=alert(1)>',
            summary: '<b>bold?</b>',
            source: 'Reuters',
            url: 'https://x.test/a',
            published_at: '2026-10-07T07:37:00Z',
          },
        ],
      }),
    );
    await m.settle();
    const li = m.el.querySelector('ul.news li')!;
    expect(li.querySelector('img')).toBeNull(); // not interpreted as HTML
    expect(li.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(li.querySelector('b')).toBeNull();
    const a = li.querySelector('a')!;
    expect([a.getAttribute('target'), a.getAttribute('rel')]).toEqual([
      '_blank',
      'noopener noreferrer',
    ]);
  });

  it('news problems are shown quietly and do not break the rest of the page', async () => {
    const m = await mount();
    m.one(OV).flush(overview());
    m.one(HI).flush(history());
    m.one(NE).flush(
      { detail: 'News needs FINNHUB_API_KEY to be set.' },
      { status: 503, statusText: 'Unavailable' },
    );
    await m.settle();
    expect(m.el.querySelector('#news-h')!.closest('section')!.textContent).toContain(
      'News needs a Finnhub API key.',
    );
    expect(m.el.querySelector('h2')?.textContent).toContain('NVIDIA Corp');
  });

  it("navigating to another symbol reloads everything and ignores the previous symbol's late answers", async () => {
    const m = await mount('nvda');
    const oldOv = m.one(OV);
    m.one(HI);
    m.one(NE);
    m.params.next(convertToParamMap({ ticker: 'voo' }));
    m.f.detectChanges();
    await m.f.whenStable();
    const newOv = m.one(OV);
    expect(newOv.request.url).toBe('/api/symbols/VOO');
    newOv.flush(
      overview({ symbol: 'VOO', name: 'Vanguard S&P 500 ETF', profile: null, stats: null }),
    );
    m.find(HI).forEach((r) => r.flush(history()));
    m.find(NE).forEach((r) => r.flush(news()));
    await m.settle();
    expect(oldOv.cancelled).toBe(false); // plain firstValueFrom: not cancelled, so guard must hold
    oldOv.flush(overview()); // NVDA's overview arrives late
    await m.settle();
    expect(m.el.querySelector('h2')?.textContent).toContain('Vanguard S&P 500 ETF');
  });

  describe('news freshness and refresh', () => {
    const T0 = Date.parse('2026-10-07T07:52:00Z'); // 12 minutes after the fixture's as_of
    const loaded = async () => {
      const m = await mount('nvda');
      m.one(OV).flush(overview());
      m.one(HI).flush(history());
      m.one(NE).flush(news());
      await m.settle();
      return m;
    };
    const section = (m: Awaited<ReturnType<typeof loaded>>) =>
      m.el.querySelector('#news-h')!.parentElement!.parentElement!;
    const button = (m: Awaited<ReturnType<typeof loaded>>) =>
      section(m).querySelector('button') as HTMLButtonElement;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
      vi.setSystemTime(T0);
    });
    afterEach(() => vi.useRealTimers());

    it('shows how old the news is and keeps the label current as time passes', async () => {
      const m = await loaded();
      expect(section(m).textContent).toContain('Updated 12 min ago');
      expect(section(m).querySelector('time')!.getAttribute('datetime')).toBe(
        '2026-10-07T07:40:00Z',
      );
      vi.advanceTimersByTime(3 * 60 * 1000);
      await m.settle();
      expect(section(m).textContent).toContain('Updated 15 min ago');
    });

    it('stops its timer when the page is destroyed', async () => {
      const m = await loaded();
      expect(vi.getTimerCount()).toBe(1);
      m.f.destroy();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('Refresh posts to the refresh endpoint, swaps in the new headlines and resets the label', async () => {
      const m = await loaded();
      button(m).click();
      await m.settle();
      expect(button(m).disabled).toBe(true); // no double click while in flight
      button(m).click();
      const req = m.one(RF); // still exactly one request
      expect(req.request.method).toBe('POST');
      req.flush(
        news({
          as_of: '2026-10-07T07:52:00Z',
          items: [
            {
              headline: 'Fresh item',
              summary: '',
              source: 'AP',
              url: 'https://x.test/b',
              published_at: '2026-10-07T07:50:00Z',
            },
          ],
        }),
      );
      await m.settle();
      expect(section(m).textContent).toContain('Fresh item');
      expect(section(m).textContent).not.toContain('Chip rally');
      expect(section(m).textContent).toContain('Updated just now');
      expect(button(m).disabled).toBe(false);
    });

    it('a failed refresh keeps the old headlines and says so', async () => {
      const m = await loaded();
      button(m).click();
      await m.settle();
      m.one(RF).flush(
        { detail: 'News is unavailable right now (Finnhub rate limit reached).' },
        { status: 502, statusText: 'Bad Gateway' },
      );
      await m.settle();
      expect(section(m).textContent).toContain('Chip rally');
      expect(section(m).textContent).toContain('Updated 12 min ago');
      expect(section(m).textContent).toContain('Showing earlier headlines.');
      expect(button(m).disabled).toBe(false);
    });

    it('a refresh answered from the stale cache keeps the old time and warns', async () => {
      const m = await loaded();
      button(m).click();
      await m.settle();
      m.one(RF).flush(news({ stale: true }));
      await m.settle();
      expect(section(m).textContent).toContain('Showing cached headlines.');
      expect(section(m).textContent).toContain('Updated 12 min ago');
    });

    it('429 disables Refresh and counts down the Retry-After seconds', async () => {
      const m = await loaded();
      button(m).click();
      await m.settle();
      m.one(RF).flush(
        { detail: 'Too many news refreshes. Try again in 40 s.' },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '40' } },
      );
      await m.settle();
      expect(section(m).textContent).toContain('Try again in 40 s');
      expect(button(m).disabled).toBe(true);
      vi.advanceTimersByTime(15 * 1000);
      await m.settle();
      expect(section(m).textContent).toContain('Try again in 25 s');
      vi.advanceTimersByTime(25 * 1000);
      await m.settle();
      expect(section(m).textContent).not.toContain('Try again');
      expect(button(m).disabled).toBe(false);
      expect(section(m).textContent).toContain('Chip rally');
    });

    it('ignores a refresh answer that arrives after navigating to another symbol', async () => {
      const m = await loaded();
      button(m).click();
      await m.settle();
      const late = m.one(RF);
      m.params.next(convertToParamMap({ ticker: 'voo' }));
      m.f.detectChanges();
      await m.f.whenStable();
      m.one(OV).flush(overview({ symbol: 'VOO', name: 'Vanguard S&P 500 ETF' }));
      m.find(HI).forEach((r) => r.flush(history()));
      m.find(NE).forEach((r) =>
        r.flush(
          news({
            items: [
              {
                headline: 'VOO news',
                summary: '',
                source: 'AP',
                url: 'https://x.test/v',
                published_at: '2026-10-07T07:00:00Z',
              },
            ],
          }),
        ),
      );
      await m.settle();
      late.flush(
        news({
          items: [
            {
              headline: 'NVDA late',
              summary: '',
              source: 'AP',
              url: 'https://x.test/n',
              published_at: '2026-10-07T07:00:00Z',
            },
          ],
        }),
      );
      await m.settle();
      expect(section(m).textContent).toContain('VOO news');
      expect(section(m).textContent).not.toContain('NVDA late');
      expect(button(m).disabled).toBe(false); // the new symbol's button is not stuck
    });

    it('without an API key there is no Refresh button', async () => {
      const m = await mount('nvda');
      m.one(OV).flush(overview());
      m.one(HI).flush(history());
      m.one(NE).flush(
        { detail: 'News needs FINNHUB_API_KEY to be set.' },
        { status: 503, statusText: 'Unavailable' },
      );
      await m.settle();
      expect(section(m).querySelector('button')).toBeNull();
    });
  });
});
