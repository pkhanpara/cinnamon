import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { Holdings } from './holdings';

const acct = (id: number, nickname: string, platform = 'robinhood') => ({ id, platform, nickname, created_at: '', position_count: 1, last_import_at: null });
const line = (id: number, nick: string, quantity: string, value: string | null, over: Record<string, unknown> = {}) => ({ account_id: id, account_nickname: nick, platform: 'x', quantity, cost_basis: '100', value, source: 'live', ...over });
const holding = (symbol: string, over: Record<string, unknown> = {}) => ({
  symbol, name: `${symbol} Inc.`, quantity: '10', cost_basis: '100', price: '12', source: 'live', value: '120.00',
  gain: '20.00', gain_pct: '20.0000', weight_pct: '50.0000', day_change: '5.00', day_change_pct: '4.3478',
  lines: [line(1, 'RH', '10', '120.00')], ...over,
});
const response = (holdings: object[], over: Record<string, unknown> = {}) => ({
  account_ids: [1, 2],
  summary: { total_value: '1000.00', total_cost_basis: '800.00', gain: '200.00', gain_pct: '25.0000', day_change: '10.00', day_change_pct: '1.0000', live_count: 1, stale_count: 0, file_count: 0, unpriced_count: 0 },
  holdings, warnings: [], prices_as_of: '2026-10-07T10:00:00Z', ...over,
});

async function mount(opts: { accounts?: object[]; query?: string | null; saved?: unknown } = {}) {
  localStorage.clear();
  if (opts.saved) localStorage.setItem('cinnamon.holdings.selection.5', JSON.stringify(opts.saved));
  const qp = opts.query === undefined || opts.query === null ? {} : { accounts: opts.query };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(qp) } } },
    ],
  });
  (TestBed.inject(AuthService) as unknown as { _user: { set(u: unknown): void } })._user.set({ id: 5, username: 'u', is_admin: false, is_active: true });
  const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const http = TestBed.inject(HttpTestingController);
  const f = TestBed.createComponent(Holdings);
  f.detectChanges();
  http.expectOne('/api/accounts').flush(opts.accounts ?? [acct(1, 'RH'), acct(2, 'M1', 'm1')]);
  await f.whenStable();
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const c = f.componentInstance as never as Record<string, any>;
  const holdingsReqs = () => http.match((r) => r.url === '/api/holdings');
  const reply = async (body: object, ids?: string) => {
    const [req] = holdingsReqs();
    if (ids !== undefined) expect(req.request.params.get('account_ids')).toBe(ids);
    req.flush(body);
    await f.whenStable(); f.detectChanges();
  };
  const box = (name: string) => Array.from(el.querySelectorAll('input[type=checkbox]')).find((i) => i.getAttribute('aria-label') === name) as HTMLInputElement;
  const symbols = () => Array.from(el.querySelectorAll('tbody tr:not(.subrow) td:nth-child(2) strong')).map((e) => e.textContent?.trim());
  return { f, http, el, c, nav, reply, box, symbols, holdingsReqs };
}

describe('Holdings page', () => {
  it('shows the portfolio chart for the selected accounts and follows the selection', async () => {
    const m = await mount();
    await m.reply(response([holding('ORCL')]), '1,2');
    expect(m.el.querySelector('app-portfolio-chart')).not.toBeNull();
    const charts = () => m.http.match((r) => r.url === '/api/portfolio/history');
    const first = charts();
    expect(first.map((r) => r.request.params.get('account_ids'))).toEqual(['1,2']);
    m.box('M1').click();
    await m.f.whenStable(); m.f.detectChanges();
    expect(charts().map((r) => r.request.params.get('account_ids'))).toEqual(['1']);
  });

  it('selects every account by default and requests them explicitly', async () => {
    const m = await mount();
    await m.reply(response([holding('ORCL')]), '1,2');
    expect(m.box('All accounts').checked).toBe(true);
    expect(m.box('RH').checked && m.box('M1').checked).toBe(true);
    expect(m.el.querySelector('.tiles')?.textContent).toContain('$1,000.00');
    expect(m.symbols()).toEqual(['ORCL']);
  });

  it('unticking an account refetches with only the remaining ids, saves it, and updates the URL', async () => {
    const m = await mount();
    await m.reply(response([holding('ORCL')]));
    m.box('M1').click(); await m.f.whenStable();
    await m.reply(response([holding('DIS')]), '1');
    expect(m.symbols()).toEqual(['DIS']);
    expect(m.box('All accounts').indeterminate).toBe(true);
    expect(JSON.parse(localStorage.getItem('cinnamon.holdings.selection.5')!)).toEqual({ selected: [1], known: [1, 2] });
    expect(m.nav).toHaveBeenLastCalledWith([], { queryParams: { accounts: '1' }, replaceUrl: true });
  });

  it('All toggle clears then restores everything; none selected makes no request', async () => {
    const m = await mount();
    await m.reply(response([holding('ORCL')]));
    m.box('All accounts').click(); await m.f.whenStable(); m.f.detectChanges();
    expect(m.holdingsReqs()).toHaveLength(0);
    expect(m.el.textContent).toContain('Select at least one account');
    m.box('All accounts').click(); await m.f.whenStable();
    await m.reply(response([holding('ORCL')]), '1,2');
  });

  it('restores a saved selection and ticks accounts created since', async () => {
    const m = await mount({ accounts: [acct(1, 'RH'), acct(2, 'M1'), acct(3, 'New')], saved: { selected: [1], known: [1, 2] } });
    await m.reply(response([holding('ORCL')]), '1,3');
    expect(m.box('M1').checked).toBe(false);
    expect(m.box('New').checked).toBe(true);
  });

  it('the URL selection wins over the saved one', async () => {
    const m = await mount({ query: '2', saved: { selected: [1], known: [1, 2] } });
    await m.reply(response([holding('ORCL')]), '2');
  });

  it('ignores a stale response that arrives after a newer one', async () => {
    const m = await mount();
    await m.reply(response([holding('FIRST')]));
    m.box('M1').click(); await m.f.whenStable();           // request A (ids=1)
    m.box('RH').click(); await m.f.whenStable();           // request B (ids=none) -> no request
    m.box('RH').click(); await m.f.whenStable();           // request C (ids=1)
    const [a, c] = m.holdingsReqs();
    c.flush(response([holding('NEWEST')])); await m.f.whenStable();
    a.flush(response([holding('OLDER')])); await m.f.whenStable(); m.f.detectChanges();
    expect(m.symbols()).toEqual(['NEWEST']);
  });

  it('shows an empty state with no accounts and does not call the API', async () => {
    const m = await mount({ accounts: [] });
    expect(m.el.textContent).toContain('No accounts yet');
    expect(m.holdingsReqs()).toHaveLength(0);
  });

  it('each symbol links to its detail page', async () => {
    const m = await mount();
    await m.reply(response([holding('ORCL'), holding('BRK.B')]));
    const hrefs = Array.from(m.el.querySelectorAll('a.sym')).map((a) => a.getAttribute('href'));
    expect(hrefs.sort()).toEqual(['/symbol/BRK.B', '/symbol/ORCL']); // table order is by value, not by this test
  });

  it('shows warnings, badges for non-live prices, and dashes for missing values', async () => {
    const m = await mount();
    await m.reply(response([
      holding('LIVE'),
      holding('OLD', { source: 'stale', day_change: null, day_change_pct: null }),
      holding('IMP', { source: 'file' }),
      holding('NOPE', { source: 'none', price: null, value: null, gain: null, gain_pct: null, weight_pct: null, day_change: null, day_change_pct: null }),
    ], { warnings: ['Live prices unavailable (Finnhub rate limit reached); showing the last known or imported values.'] }));
    expect(m.el.querySelector('[role=note]')?.textContent).toContain('rate limit');
    const text = m.el.querySelector('tbody')!.textContent!;
    expect(text).toContain('(stale price)');
    expect(text).toContain('(imported value)');
    expect(text).toContain('(no price)');
    const nope = Array.from(m.el.querySelectorAll('tbody tr')).find((r) => r.textContent?.includes('NOPE'))!;
    expect(nope.textContent).toContain('—');
  });

  it('formats money and prints the sign as well as colouring it', async () => {
    const m = await mount();
    await m.reply(response([holding('ORCL', { gain: '-1234.5', gain_pct: '-3.5000', day_change: '5.00', day_change_pct: '0.5000' })]));
    const row = m.el.querySelector('tbody tr')!;
    expect(row.textContent).toContain('-$1,234.50');
    expect(row.textContent).toContain('-3.50%');
    expect(row.textContent).toContain('+$5.00');
    expect(row.querySelector('.loss')).toBeTruthy();
    expect(row.querySelector('.gain')).toBeTruthy();
  });

  it('merged symbols expand to per-account lines; single-account rows show the account inline', async () => {
    const m = await mount();
    await m.reply(response([
      holding('ORCL', { quantity: '50', lines: [line(2, 'M1', '10', '1705.50'), line(1, 'RH', '40', '6822.00')] }),
      holding('DIS'),
    ]));
    expect(m.el.querySelectorAll('tr.subrow')).toHaveLength(0);
    expect(m.el.querySelectorAll('button[aria-expanded]')).toHaveLength(1);
    expect(m.el.textContent).toContain('DIS Inc. · RH');
    (m.el.querySelector('button[aria-expanded]') as HTMLButtonElement).click(); m.f.detectChanges();
    const subs = Array.from(m.el.querySelectorAll('tr.subrow')).map((r) => r.textContent);
    expect(subs).toHaveLength(2);
    expect(subs[0]).toContain('M1'); expect(subs[0]).toContain('$1,705.50');
    expect(subs[1]).toContain('RH');
  });

  it('expanded lines show their own gain (amount and percent), dashes without a price, no percent at zero cost', async () => {
    const m = await mount();
    await m.reply(response([
      holding('ORCL', { lines: [
        line(1, 'RH', '40', '120.00'),
        line(2, 'M1', '10', '80.00'),
        line(3, 'X1', '1', null, { source: 'none' }),
        line(4, 'Z0', '1', '50.00', { cost_basis: '0' }),
      ] }),
    ]));
    (m.el.querySelector('button[aria-expanded]') as HTMLButtonElement).click(); m.f.detectChanges();
    const gains = Array.from(m.el.querySelectorAll('tr.subrow td.line-gain'));
    expect(gains).toHaveLength(4);
    expect(gains[0].textContent).toContain('+$20.00'); expect(gains[0].textContent).toContain('+20.00%');
    expect(gains[0].classList.contains('gain')).toBe(true);
    expect(gains[1].textContent).toContain('-$20.00'); expect(gains[1].textContent).toContain('-20.00%');
    expect(gains[1].classList.contains('loss')).toBe(true);
    expect(gains[2].textContent!.trim()).toBe('—');
    expect(gains[3].textContent).toContain('+$50.00'); expect(gains[3].textContent).not.toContain('%');
  });

  it('shows the platform next to an account only when it differs from the nickname', async () => {
    const m = await mount({ accounts: [acct(1, 'Robinhood', 'robinhood'), acct(2, 'Roth', 'robinhood')] });
    expect(Array.from(m.el.querySelectorAll('.accounts-filter .platform')).map((e) => e.textContent!.trim())).toEqual(['robinhood']);
    await m.reply(response([
      holding('ORCL', { lines: [line(1, 'Robinhood', '40', '120.00', { platform: 'robinhood' }), line(2, 'Roth', '10', '80.00', { platform: 'robinhood' })] }),
    ]));
    (m.el.querySelector('button[aria-expanded]') as HTMLButtonElement).click(); m.f.detectChanges();
    const subs = Array.from(m.el.querySelectorAll('tr.subrow'));
    expect(subs[0].querySelector('.platform')).toBeNull();
    expect(subs[0].textContent).not.toMatch(/robinhood\s+robinhood/i);
    expect(subs[1].querySelector('.platform')?.textContent).toBe('robinhood');
  });

  it('has a single vertical scroller: the table sits in no max-height scroll box', async () => {
    const m = await mount();
    await m.reply(response([holding('DIS')]));
    const table = m.el.querySelector('table')!;
    expect(table.closest('.scroll')).toBeNull();
    expect(table.parentElement!.classList.contains('table-x')).toBe(true);
  });

  it('sorts by value descending by default and toggles on header click, sinking rows with no value', async () => {
    const m = await mount();
    await m.reply(response([
      holding('SMALL', { value: '10.00', gain: '1.00' }),
      holding('NONE', { value: null, gain: null }),
      holding('BIG', { value: '900.00', gain: '-5.00' }),
    ]));
    expect(m.symbols()).toEqual(['BIG', 'SMALL', 'NONE']);
    m.c['sortBy']('value'); m.f.detectChanges();
    expect(m.symbols()).toEqual(['SMALL', 'BIG', 'NONE']);   // ascending, NONE still last
    m.c['sortBy']('gain'); m.f.detectChanges();
    expect(m.symbols()).toEqual(['SMALL', 'BIG', 'NONE']);   // gain desc: 1 then -5
    m.c['sortBy']('symbol'); m.f.detectChanges();
    expect(m.symbols()).toEqual(['BIG', 'NONE', 'SMALL']);   // text sort, ascending first
    expect(m.el.querySelector('th[aria-sort=ascending]')?.textContent).toContain('Symbol');
  });

  it('says so when the selected accounts hold nothing', async () => {
    const m = await mount();
    await m.reply(response([]));
    expect(m.el.textContent).toContain('no holdings yet');
  });

  it('shows the server error', async () => {
    const m = await mount();
    const [req] = m.holdingsReqs();
    req.flush({ detail: 'Account not found' }, { status: 404, statusText: 'Not Found' });
    await m.f.whenStable(); m.f.detectChanges();
    expect(m.el.querySelector('[role=alert]')?.textContent).toContain('Account not found');
  });
});
