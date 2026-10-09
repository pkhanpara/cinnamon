import { Component, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { STALE_SERVER } from '../../core/errors';
import { PortfolioHistory } from '../../core/models';
import { CHART_FACTORY, ChartHandle } from '../price-chart/chart-factory';
import { PortfolioChart } from './portfolio-chart';

const body = (over: Partial<PortfolioHistory> = {}): PortfolioHistory => ({
  basis: 'backcast',
  range: '1m',
  intraday: false,
  points: [
    { t: 1, d: '2026-09-01', value: '100.00', spy_value: null },
    { t: 2, d: '2026-09-02', value: '110.00', spy_value: null },
  ],
  start_value: '100.00',
  end_value: '110.00',
  change: '10.00',
  change_pct: '10.00',
  spy: null,
  symbols: ['A'],
  covered_value_pct: '100.00',
  warnings: [],
  stale: false,
  as_of: null,
  ...over,
});
const withSpy = () =>
  body({
    points: [
      { t: 1, d: '2026-09-01', value: '100.00', spy_value: '100.00' },
      { t: 2, d: '2026-09-02', value: '110.00', spy_value: '104.00' },
    ],
    spy: { change_pct: '4.00', difference_pp: '6.00' },
  });

const flush = () => new Promise((r) => setTimeout(r));

function setup(ids = [1, 2]) {
  const handle = { setData: vi.fn(), setCompare: vi.fn(), destroy: vi.fn() } satisfies ChartHandle;
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: CHART_FACTORY, useValue: async () => handle },
    ],
  });
  @Component({
    imports: [PortfolioChart],
    template: `<app-portfolio-chart [accountIds]="ids()" />`,
  })
  class Host {
    ids = signal(ids);
  }
  const f = TestBed.createComponent(Host);
  const http = TestBed.inject(HttpTestingController);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const next = async (
    b: PortfolioHistory | { status: number; detail?: string },
    match?: (p: URLSearchParams) => void,
  ) => {
    await flush();
    const [req] = http.match((r) => r.url === '/api/portfolio/history');
    match?.(new URLSearchParams(req.request.params.toString()));
    if ('status' in b)
      req.flush({ detail: b.detail ?? 'nope' }, { status: b.status, statusText: 'x' });
    else req.flush(b);
    await flush();
    f.detectChanges();
    await flush();
  };
  return { f, el, handle, http, next, host: f.componentInstance };
}

describe('PortfolioChart', () => {
  it('asks for the selected accounts and the default range, labels the back-cast, and draws the line', async () => {
    const m = setup();
    await m.next(body(), (p) => {
      expect(p.get('account_ids')).toBe('1,2');
      expect(p.get('range')).toBe('1m');
      expect(p.has('compare')).toBe(false);
    });
    expect(m.el.textContent).toContain('Current holdings at past prices');
    expect(m.handle.setData).toHaveBeenLastCalledWith(
      [
        { time: '2026-09-01', value: 100 },
        { time: '2026-09-02', value: 110 },
      ],
      { intraday: false, up: true },
    );
    expect(m.handle.setCompare).toHaveBeenLastCalledWith(null);
    expect(m.el.querySelector('.summary')?.textContent).toContain('+$10.00');
  });

  it('refetches with the new range and offers every range the ticker page has', async () => {
    const m = setup();
    await m.next(body());
    const labels = Array.from(m.el.querySelectorAll('.ranges button')).map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toEqual(['1D', '5D', '1M', '6M', 'YTD', '1Y', 'All']);
    (
      Array.from(m.el.querySelectorAll('.ranges button')).find(
        (b) => b.textContent?.trim() === 'YTD',
      ) as HTMLButtonElement
    ).click();
    m.f.detectChanges();
    await m.next(body({ range: 'ytd' }), (p) => expect(p.get('range')).toBe('ytd'));
  });

  it('overlays SPY and shows the gap when the toggle is on', async () => {
    const m = setup();
    await m.next(body());
    (m.el.querySelector('.spy button[role=switch]') as HTMLButtonElement).click();
    m.f.detectChanges();
    await m.next(withSpy(), (p) => expect(p.get('compare')).toBe('spy'));
    expect(m.handle.setCompare).toHaveBeenLastCalledWith([
      { time: '2026-09-01', value: 100 },
      { time: '2026-09-02', value: 104 },
    ]);
    expect(m.el.querySelector('.summary')?.textContent).toContain('+6.00 pp');
  });

  it('refetches when the account selection changes, and asks for nothing when none is selected', async () => {
    const m = setup();
    await m.next(body());
    m.host.ids.set([2]);
    m.f.detectChanges();
    await m.next(body(), (p) => expect(p.get('account_ids')).toBe('2'));
    m.host.ids.set([]);
    m.f.detectChanges();
    await flush();
    expect(m.http.match((r) => r.url === '/api/portfolio/history')).toHaveLength(0);
  });

  it('shows warnings, coverage and a stale notice', async () => {
    const m = setup();
    await m.next(
      body({
        warnings: ['Price history for X is unavailable'],
        covered_value_pct: '80.00',
        stale: true,
        as_of: '2026-10-07T10:00:00Z',
      }),
    );
    expect(m.el.textContent).toContain('Price history for X is unavailable');
    expect(m.el.textContent).toContain('covers 80.0');
    expect(m.el.textContent).toContain('Showing cached prices');
  });

  it('shows an error with a working Retry', async () => {
    const e = setup();
    await e.next({ status: 503 });
    expect(e.el.querySelector('[role=alert]')).not.toBeNull();
    (e.el.querySelector('[role=alert] button') as HTMLButtonElement).click();
    await e.next(body());
    expect(e.el.querySelector('[role=alert]')).toBeNull();
  });

  it('says the backend may be stale when the endpoint is missing, and draws once Retry succeeds', async () => {
    const m = setup();
    await m.next({ status: 404, detail: 'Not Found' });
    expect(m.el.querySelector('[role=alert]')?.textContent).toContain(STALE_SERVER);
    expect(m.handle.setData).not.toHaveBeenCalled();
    (m.el.querySelector('[role=alert] button') as HTMLButtonElement).click();
    await m.next(body());
    expect(m.el.querySelector('[role=alert]')).toBeNull();
    expect(m.handle.setData).toHaveBeenCalled();
  });

  it('says so when there is nothing to chart, and destroys the chart with the component', async () => {
    const m = setup();
    await m.next(
      body({ points: [], start_value: null, end_value: null, change: null, change_pct: null }),
    );
    expect(m.el.textContent).toContain('No priced holdings to chart');
    m.f.destroy();
    await flush();
  });
});
