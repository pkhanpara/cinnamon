import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CashYear, Principle, Scorecard } from '../../core/models';
import { PrinciplesPanel } from './principles-panel';

const principle = (over: Partial<Principle> = {}): Principle => ({
  key: 'pe',
  label: 'Price / earnings',
  description: 'Price/Earnings < 15',
  kind: 'computed',
  rule: '< 15',
  unit: 'ratio',
  better: 'lower',
  value: '29.01',
  status: 'fail',
  note: '',
  years: null,
  check: null,
  ...over,
});
const year = (y: number, over: Partial<CashYear> = {}): CashYear => ({
  year: y,
  net_income: '1000000000',
  owner_earnings: '900000000',
  cfo: '1200000000',
  cff: '-400000000',
  acquisitions: null,
  buybacks: '300000000',
  rnd: '200000000',
  revenue: '5000000000',
  ...over,
});
const scorecard = (over: Partial<Scorecard> = {}): Scorecard => ({
  symbol: 'JNJ',
  name: 'Johnson & Johnson',
  sector: 'Healthcare',
  industry: 'Drug Manufacturers - General',
  applicable: true,
  principles: [
    principle(),
    principle({
      key: 'ltd_to_capital',
      label: 'Long-term debt / capital',
      unit: 'pct',
      value: '30.46',
      status: 'pass',
      rule: '< 50%',
    }),
    principle({
      key: 'wide_moat',
      label: 'Wide moat',
      kind: 'manual',
      unit: null,
      better: null,
      value: null,
      status: 'manual',
      rule: '',
    }),
  ],
  evidence: {
    insider_trades: [
      {
        name: 'Woods',
        shares_change: -100,
        price: '276.31',
        code: 'S',
        transaction_date: '2026-09-08',
        filing_date: null,
      },
    ],
    insider_net_value: '-27631.00',
    insider_summary: {
      sellers: [
        {
          name: 'Woods',
          trades: 2,
          shares: 150,
          value: '27631.00',
          avg_price: '276.31',
          first_date: '2026-03-02',
          last_date: '2026-09-08',
          unpriced: 1,
        },
      ],
      buyers: [],
    },
    buybacks: [
      { year: 2025, amount: '5953000000', avg_price: '250', high_5y: '260', near_high: true },
    ],
    years: [],
    splits: [],
  },
  warnings: [],
  as_of: '2026-10-08T20:00:00Z',
  stale: false,
  ...over,
});

async function mount() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const f = TestBed.createComponent(PrinciplesPanel);
  f.componentRef.setInput('symbol', 'JNJ');
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const settle = async () => {
    await f.whenStable();
    f.detectChanges();
  };
  return { f, http, el, settle };
}

const rowOf = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(label)) as HTMLElement;

describe('PrinciplesPanel', () => {
  afterEach(() => localStorage.clear());

  it('shows values, results and the peer comparison', async () => {
    const { http, el, settle } = await mount();
    http.expectOne('/api/principles/JNJ?evidence=true').flush(scorecard());
    await settle();
    expect(el.textContent).toContain('Comparing with peers');
    expect(el.textContent).toContain('1 pass · 1 fail');
    http.expectOne('/api/principles/JNJ/peers').flush({
      symbol: 'JNJ',
      peers: [
        { symbol: 'MRK', name: 'Merck' },
        { symbol: 'PFE', name: 'Pfizer' },
      ],
      failed: ['GONE'],
      stats: [{ key: 'pe', mean: '20.00', median: '18.00', n: 2 }],
      stale: false,
    });
    await settle();
    const pe = rowOf(el, 'Price / earnings');
    expect(pe.textContent).toContain('29.01');
    expect(pe.textContent).toContain('✗ Fail');
    expect(pe.textContent).toContain('18.00');
    expect(pe.textContent).toContain('worse');
    expect(pe.textContent).toContain('20.00 (2)');
    expect(el.textContent).toContain('Compared with 2 peers');
    expect(el.textContent).toContain('no data for GONE');
    expect(rowOf(el, 'Long-term debt').textContent).toContain('30.46%');
    expect(rowOf(el, 'Wide moat').textContent).toContain('Not checked');
    expect(el.textContent).toContain('Woods');
  });

  it('shows the insider net in millions, the full amount on hover', async () => {
    const { http, el, settle } = await mount();
    http.expectOne('/api/principles/JNJ?evidence=true').flush(scorecard());
    await settle();
    const net = el.querySelector('.net-line span') as HTMLElement;
    expect(net.textContent).toBe('-<$0.1M');
    expect(net.title).toBe('-$27,631.00');
    expect(net.className).toBe('loss');
  });

  it('all trades are collapsed by default and the choice is remembered', async () => {
    const first = await mount();
    first.http.expectOne('/api/principles/JNJ?evidence=true').flush(scorecard());
    await first.settle();
    const btn = first.el.querySelector('button.all-trades') as HTMLButtonElement;
    expect(btn.textContent).toContain('All trades (1)');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBe('pr-all-trades');
    expect(first.el.querySelector('table.all-trades-table')).toBeNull();

    btn.click();
    await first.settle();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const table = first.el.querySelector('#pr-all-trades table.all-trades-table') as HTMLElement;
    expect(table.textContent).toContain('Woods');
    expect(table.textContent).toContain('Sale');
    expect(localStorage.getItem('cinnamon.principles.allTrades')).toBe('1');

    TestBed.resetTestingModule();
    const again = await mount();
    again.http.expectOne('/api/principles/JNJ?evidence=true').flush(scorecard());
    await again.settle();
    expect(again.el.querySelector('table.all-trades-table')).not.toBeNull();
    (again.el.querySelector('button.all-trades') as HTMLButtonElement).click();
    await again.settle();
    expect(again.el.querySelector('table.all-trades-table')).toBeNull();
    expect(localStorage.getItem('cinnamon.principles.allTrades')).toBe('0');
  });

  it('the toggle still works when storage is blocked', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const { http, el, settle } = await mount();
      http.expectOne('/api/principles/JNJ?evidence=true').flush(scorecard());
      await settle();
      expect(el.querySelector('table.all-trades-table')).toBeNull();
      (el.querySelector('button.all-trades') as HTMLButtonElement).click();
      await settle();
      expect(el.querySelector('table.all-trades-table')).not.toBeNull();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it('charts each cash-flow series oldest year first', async () => {
    const { http, el, settle } = await mount();
    const sc = scorecard();
    sc.evidence!.years = [
      year(2025, { cff: '-1500000000' }),
      year(2024, { rnd: null }),
      year(2023),
    ];
    http.expectOne('/api/principles/JNJ?evidence=true').flush(sc);
    await settle();
    const figs = [...el.querySelectorAll('.year-charts figure')];
    expect(figs.map((f) => f.querySelector('.t')?.textContent)).toEqual([
      'Net income',
      'Owner earnings',
      'Operating cash',
      'Financing cash',
      'Acquisitions',
      'Buybacks',
      'R&D',
    ]);
    const svg = (title: string) =>
      figs.find((f) => f.querySelector('.t')?.textContent === title)!.querySelector('svg');
    expect(svg('Financing cash')!.getAttribute('aria-label')).toBe(
      'Financing cash by fiscal year, oldest first: 2023 -$400M, 2024 -$400M, 2025 -$1.5B',
    );
    expect(svg('Financing cash')!.querySelectorAll('rect.neg')).toHaveLength(3);
    const rect = svg('Financing cash')!.querySelector('rect')!;
    expect(rect.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(rect.querySelector('title')?.textContent).toBe('2023: -$400M');
    expect(svg('R&D')!.getAttribute('aria-label')).toContain('2024 no data');
    expect(svg('R&D')!.querySelectorAll('rect')).toHaveLength(2);
    expect(svg('R&D')!.textContent).toContain('n/a');
    expect([...svg('Net income')!.querySelectorAll('text.yr')].map((t) => t.textContent)).toEqual([
      '2023',
      '2024',
      '2025',
    ]);
    // Acquisitions is null every year.
    expect(svg('Acquisitions')).toBeNull();
    expect(figs[4].textContent).toContain('No data');
    // The table keeps every year, newest first.
    expect(el.textContent).toContain('Fiscal year');
  });

  it('no years: no charts', async () => {
    const { http, el, settle } = await mount();
    http.expectOne('/api/principles/JNJ?evidence=true').flush(scorecard());
    await settle();
    expect(el.querySelector('.year-charts')).toBeNull();
  });

  it('summarises the top insider sellers and buyers', async () => {
    const { http, el, settle } = await mount();
    http.expectOne('/api/principles/JNJ?evidence=true').flush(scorecard());
    await settle();
    expect(el.textContent).toContain('Insider trades summary');
    const row = el.querySelector('table.insider-summary tbody tr') as HTMLElement;
    expect(row.textContent).toContain('Woods');
    expect(row.textContent).toContain('Mar 2, 2026 – Sep 8, 2026');
    expect(row.textContent).toContain('$27,631.00*');
    expect(row.textContent).toContain('$276.31');
    expect(el.textContent).toContain('No open-market buys.');
    expect(el.textContent).toContain('Some trades had no price');
  });

  it('a verdict overrides the computed result and can be cleared', async () => {
    const { http, el, settle } = await mount();
    http.expectOne('/api/principles/JNJ?evidence=true').flush(scorecard());
    await settle();
    http
      .expectOne('/api/principles/JNJ/peers')
      .flush({ symbol: 'JNJ', peers: [], failed: [], stats: [], stale: false });
    await settle();

    const select = rowOf(el, 'Price / earnings').querySelector('select') as HTMLSelectElement;
    select.value = 'pass';
    select.dispatchEvent(new Event('change'));
    const put = http.expectOne('/api/principles/JNJ/checks/pe');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ verdict: 'pass', note: '' });
    put.flush({ verdict: 'pass', note: '', updated_at: '2026-10-08T20:00:00Z' });
    await settle();
    expect(rowOf(el, 'Price / earnings').textContent).toContain('✓ Pass');
    expect(rowOf(el, 'Price / earnings').textContent).toContain('computed: ✗ Fail');

    const again = rowOf(el, 'Price / earnings').querySelector('select') as HTMLSelectElement;
    again.value = '';
    again.dispatchEvent(new Event('change'));
    const del = http.expectOne('/api/principles/JNJ/checks/pe');
    expect(del.request.method).toBe('DELETE');
    del.flush(null);
    await settle();
    expect(rowOf(el, 'Price / earnings').textContent).toContain('✗ Fail');
  });

  it('saving a note without a verdict marks it unsure', async () => {
    const { http, el, settle } = await mount();
    http.expectOne('/api/principles/JNJ?evidence=true').flush(scorecard());
    await settle();
    http
      .expectOne('/api/principles/JNJ/peers')
      .flush({ symbol: 'JNJ', peers: [], failed: [], stats: [], stale: false });
    await settle();
    (rowOf(el, 'Wide moat').querySelector('button') as HTMLButtonElement).click();
    await settle();
    const ta = el.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'Brand + scale';
    ta.dispatchEvent(new Event('input'));
    [...el.querySelectorAll('button')].find((b) => b.textContent === 'Save note')!.click();
    const put = http.expectOne('/api/principles/JNJ/checks/wide_moat');
    expect(put.request.body).toEqual({ verdict: 'unsure', note: 'Brand + scale' });
    put.flush({ verdict: 'unsure', note: 'Brand + scale', updated_at: 'x' });
    await settle();
    expect(el.querySelector('textarea')).toBeNull();
    expect(el.textContent).toContain('Your note: Brand + scale');
    expect(rowOf(el, 'Wide moat').textContent).toContain('? Unsure');
  });

  it('a fund gets no table and no peer lookup', async () => {
    const { http, el, settle } = await mount();
    http.expectOne('/api/principles/JNJ?evidence=true').flush(
      scorecard({
        applicable: false,
        principles: [],
        evidence: null,
        warnings: ['looks like a fund'],
      }),
    );
    await settle();
    http.expectNone('/api/principles/JNJ/peers');
    expect(el.querySelector('table')).toBeNull();
    expect(el.textContent).toContain('looks like a fund');
  });

  it('says when an API key is needed', async () => {
    const { http, el, settle } = await mount();
    http
      .expectOne('/api/principles/JNJ?evidence=true')
      .flush({ detail: 'needs key' }, { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(el.textContent).toContain('needs a Finnhub API key');
  });

  it('a failed peer lookup leaves the scorecard usable', async () => {
    const { http, el, settle } = await mount();
    http.expectOne('/api/principles/JNJ?evidence=true').flush(scorecard());
    await settle();
    http
      .expectOne('/api/principles/JNJ/peers')
      .flush(
        { detail: 'Company fundamentals are unavailable right now (rate limit).' },
        { status: 502, statusText: 'Bad Gateway' },
      );
    await settle();
    expect(el.textContent).toContain('Peer comparison unavailable');
    expect(rowOf(el, 'Price / earnings').textContent).toContain('29.01');
  });
});
