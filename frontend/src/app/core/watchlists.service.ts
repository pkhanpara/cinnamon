import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Watchlist, WatchlistDetail } from './models';

@Injectable({ providedIn: 'root' })
export class WatchlistsService {
  private readonly http = inject(HttpClient);

  list(): Observable<Watchlist[]> {
    return this.http.get<Watchlist[]>('/api/watchlists');
  }
  get(id: number): Observable<WatchlistDetail> {
    return this.http.get<WatchlistDetail>(`/api/watchlists/${id}`);
  }
  create(name: string): Observable<WatchlistDetail> {
    return this.http.post<WatchlistDetail>('/api/watchlists', { name });
  }
  rename(id: number, name: string): Observable<WatchlistDetail> {
    return this.http.patch<WatchlistDetail>(`/api/watchlists/${id}`, { name });
  }
  remove(id: number): Observable<void> {
    return this.http.delete<void>(`/api/watchlists/${id}`);
  }
  /** Idempotent: adding a symbol that is already there changes nothing. */
  addSymbol(id: number, symbol: string): Observable<WatchlistDetail> {
    return this.http.post<WatchlistDetail>(`/api/watchlists/${id}/items`, { symbol });
  }
  removeSymbol(id: number, symbol: string): Observable<void> {
    return this.http.delete<void>(`/api/watchlists/${id}/items/${encodeURIComponent(symbol)}`);
  }
}
