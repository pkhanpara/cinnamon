import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Principle, Scorecard } from '../../core/models';
import { WatchlistPage } from './watchlist';

const p = (
  key: string,
  label: string,
  status: Principle['status'],
  value: string | null,
): Principle => ({
  key,
  label,
  description: '',
  kind: 'computed',
  rule: '< 15',
  unit: 'ratio',
  better: 'lower',
  value,
  status,
  note: '',
  years: null,
  check: null,
});
const card = (symbol: string, pe: Principle['status'], pb: Principle['status']): Scorecard => ({
  symbol,
  name: `${symbol} Inc`,
  sector: null,
  industry: null,
  applicable: true,
  principles: [p('pe', 'Price / earnings', pe, '12.00'), p('pb', 'Price / book', pb, '1.10')],
  evidence: null,
  warnings: [],
  as_of: null,
  stale: false,
});
const detail = (symbols: string[]) => ({
  id: 7,
  name: 'Value',
  created_at: '2026-10-08T00:00:00Z',
  items: symbols.map((symbol) => ({ symbol, added_at: '2026-10-08T00:00:00Z' })),
});

async function mount() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { paramMap: new BehaviorSubject(convertToParamMap({ id: '7' })) },
      },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const f = TestBed.createComponent(WatchlistPage);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const settle = async () => {
    await f.whenStable();
    f.detectChanges();
  };
  return { f, http, el, settle };
}

const symbolsShown = (el: HTMLElement) =>
  [...el.querySelectorAll('tbody tr a.sym')].map((a) => a.textContent?.trim());

describe('WatchlistPage', () => {
  it('loads rows, at most three scorecards at a time, and filters them', async () => {
    const { http, el, settle } = await mount();
    http.expectOne('/api/watchlists/7').flush(detail(['AAA', 'BBB', 'CCC', 'DDD']));
    await settle();
    const first = http.match((r) => r.url.startsWith('/api/principles/'));
    expect(first.map((r) => r.request.urlWithParams)).toEqual([
      '/api/principles/AAA?evidence=false',
      '/api/principles/BBB?evidence=false',
      '/api/principles/CCC?evidence=false',
    ]);
    expect(el.textContent).toContain('Loading…');
    first[0].flush(card('AAA', 'pass', 'pass'));
    first[1].flush(card('BBB', 'pass', 'fail'));
    first[2].flush({ detail: 'down' }, { status: 502, statusText: 'Bad Gateway' });
    await settle();
    http.expectOne('/api/principles/DDD?evidence=false').flush(card('DDD', 'fail', 'pass'));
    await settle();

    expect(symbolsShown(el)).toEqual(['AAA', 'BBB', 'CCC', 'DDD']);
    expect(el.textContent).toContain('2/2 pass');
    expect(el.textContent).toContain('down');

    const box = (label: string) =>
      [...el.querySelectorAll('fieldset label')]
        .find((l) => l.textContent?.includes(label))!
        .querySelector('input') as HTMLInputElement;
    box('Price / earnings').click();
    await settle();
    expect(symbolsShown(el)).toEqual(['AAA', 'BBB']);
    box('Price / book').click();
    await settle();
    expect(symbolsShown(el)).toEqual(['AAA']);
    expect(el.textContent).toContain('1 of 4 shown');
  });

  it('adds and removes symbols', async () => {
    const { http, el, settle } = await mount();
    http.expectOne('/api/watchlists/7').flush(detail([]));
    await settle();
    expect(el.textContent).toContain('No symbols yet');
    const input = el.querySelector('input[aria-label="Symbol to add"]') as HTMLInputElement;
    input.value = ' jnj ';
    input.dispatchEvent(new Event('input'));
    await settle();
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add')!.click();
    const post = http.expectOne('/api/watchlists/7/items');
    expect(post.request.body).toEqual({ symbol: 'JNJ' });
    post.flush(detail(['JNJ']));
    await settle();
    http.expectOne('/api/principles/JNJ?evidence=false').flush(card('JNJ', 'pass', 'pass'));
    await settle();
    expect(symbolsShown(el)).toEqual(['JNJ']);

    (el.querySelector('button[aria-label="Remove JNJ"]') as HTMLButtonElement).click();
    http
      .expectOne((r) => r.method === 'DELETE' && r.url === '/api/watchlists/7/items/JNJ')
      .flush(null);
    await settle();
    expect(symbolsShown(el)).toEqual([]);
  });

  it('keeps a symbol typed while the previous add is still in flight', async () => {
    const { http, el, settle } = await mount();
    http.expectOne('/api/watchlists/7').flush(detail([]));
    await settle();
    const input = el.querySelector('input[aria-label="Symbol to add"]') as HTMLInputElement;
    const type = async (v: string) => {
      input.value = v;
      input.dispatchEvent(new Event('input'));
      await settle();
    };
    await type('JNJ');
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add')!.click();
    await type('KO');
    http.expectOne('/api/watchlists/7/items').flush(detail(['JNJ']));
    await settle();
    expect(input.value).toBe('KO');
  });

  it('says once that scores need an API key', async () => {
    const { http, el, settle } = await mount();
    http.expectOne('/api/watchlists/7').flush(detail(['AAA']));
    await settle();
    http
      .expectOne('/api/principles/AAA?evidence=false')
      .flush({ detail: 'needs key' }, { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(el.textContent).toContain('Scores need a Finnhub API key');
    expect(symbolsShown(el)).toEqual(['AAA']);
  });

  it('renames and deletes', async () => {
    const { http, el, settle } = await mount();
    http.expectOne('/api/watchlists/7').flush(detail([]));
    await settle();
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Rename')!.click();
    await settle();
    const name = el.querySelector('input[aria-label="Watchlist name"]') as HTMLInputElement;
    name.value = 'Deep value';
    name.dispatchEvent(new Event('input'));
    await settle();
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save')!.click();
    http.expectOne((r) => r.method === 'PATCH').flush({ ...detail([]), name: 'Deep value' });
    await settle();
    expect(el.querySelector('h2')?.textContent).toBe('Deep value');

    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Delete')!.click();
    http.expectOne((r) => r.method === 'DELETE' && r.url === '/api/watchlists/7').flush(null);
    await settle();
    expect(nav).toHaveBeenCalledWith('/watchlists');
  });
});
