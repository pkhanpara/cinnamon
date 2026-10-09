import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AddToWatchlist } from './add-to-watchlist';

async function mount() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  const http = TestBed.inject(HttpTestingController);
  const f = TestBed.createComponent(AddToWatchlist);
  f.componentRef.setInput('symbol', 'JNJ');
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const settle = async () => {
    await f.whenStable();
    f.detectChanges();
  };
  return { http, el, settle };
}
const wl = (id: number, name: string, symbols: string[]) => ({
  id,
  name,
  created_at: '2026-10-08T00:00:00Z',
  symbols,
});
const text = (el: HTMLElement) => el.textContent!.replace(/\s+/g, ' ');
const button = (el: HTMLElement) => el.querySelector('button') as HTMLButtonElement;

describe('AddToWatchlist', () => {
  it('lists where the symbol already is and adds it to another list', async () => {
    const { http, el, settle } = await mount();
    http.expectOne('/api/watchlists').flush([wl(1, 'Value', ['JNJ']), wl(2, 'Ideas', ['MSFT'])]);
    await settle();
    expect(el.textContent).toContain('On Value');
    expect([...el.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Ideas']);
    button(el).click();
    const post = http.expectOne('/api/watchlists/2/items');
    expect(post.request.body).toEqual({ symbol: 'JNJ' });
    post.flush({
      id: 2,
      name: 'Ideas',
      created_at: '',
      items: [
        { symbol: 'MSFT', added_at: '' },
        { symbol: 'JNJ', added_at: '' },
      ],
    });
    await settle();
    expect(text(el)).toContain('On Value, Ideas');
    expect(el.querySelector('select')).toBeNull();
  });

  it('creates a first watchlist when there is none', async () => {
    const { http, el, settle } = await mount();
    http.expectOne('/api/watchlists').flush([]);
    await settle();
    expect(button(el).textContent).toContain('new watchlist');
    button(el).click();
    http
      .expectOne((r) => r.method === 'POST' && r.url === '/api/watchlists')
      .flush({ id: 5, name: 'Watchlist', created_at: '', items: [] });
    await settle();
    http.expectOne('/api/watchlists/5/items').flush({
      id: 5,
      name: 'Watchlist',
      created_at: '',
      items: [{ symbol: 'JNJ', added_at: '' }],
    });
    await settle();
    expect(el.textContent).toContain('On Watchlist');
  });

  it('shows an error when adding fails', async () => {
    const { http, el, settle } = await mount();
    http.expectOne('/api/watchlists').flush([wl(1, 'Value', [])]);
    await settle();
    button(el).click();
    http
      .expectOne('/api/watchlists/1/items')
      .flush(
        { detail: 'A watchlist holds at most 100 symbols' },
        { status: 409, statusText: 'Conflict' },
      );
    await settle();
    expect(el.textContent).toContain('at most 100 symbols');
  });
});
