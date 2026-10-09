import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Principle, Scorecard } from '../../core/models';
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
    expect(el.textContent).toContain('-$27,631.00');
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
