import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { HistoryRange, HistoryResponse, NewsResponse, SearchHit, SymbolOverview } from './models';

@Injectable({ providedIn: 'root' })
export class SymbolsService {
  private readonly http = inject(HttpClient);

  overview(symbol: string): Observable<SymbolOverview> {
    return this.http.get<SymbolOverview>(`/api/symbols/${encodeURIComponent(symbol)}`);
  }

  history(symbol: string, range: HistoryRange): Observable<HistoryResponse> {
    return this.http.get<HistoryResponse>(`/api/symbols/${encodeURIComponent(symbol)}/history`, {
      params: new HttpParams().set('range', range),
    });
  }

  news(symbol: string): Observable<NewsResponse> {
    return this.http.get<NewsResponse>(`/api/symbols/${encodeURIComponent(symbol)}/news`);
  }

  /** Bypasses the server's 30-minute news cache; rate-limited (429 + Retry-After). */
  refreshNews(symbol: string): Observable<NewsResponse> {
    return this.http.post<NewsResponse>(
      `/api/symbols/${encodeURIComponent(symbol)}/news/refresh`,
      null,
    );
  }

  search(query: string): Observable<SearchHit[]> {
    return this.http.get<SearchHit[]>('/api/symbols/search', {
      params: new HttpParams().set('q', query),
    });
  }
}
