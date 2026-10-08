import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { HistoryRange, PortfolioHistory } from './models';

@Injectable({ providedIn: 'root' })
export class PortfolioService {
  private readonly http = inject(HttpClient);

  /** Explicit ids, so "none selected" ('') can never be mistaken for "all". */
  history(accountIds: number[], range: HistoryRange, compareSpy: boolean): Observable<PortfolioHistory> {
    let params = new HttpParams().set('account_ids', accountIds.join(',')).set('range', range);
    if (compareSpy) params = params.set('compare', 'spy');
    return this.http.get<PortfolioHistory>('/api/portfolio/history', { params });
  }
}
