import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Peers, PrincipleCheck, Scorecard, Verdict } from './models';

@Injectable({ providedIn: 'root' })
export class PrinciplesService {
  private readonly http = inject(HttpClient);

  /** `evidence: false` skips insider trades and splits (watchlist rows don't show them). */
  scorecard(symbol: string, evidence = true): Observable<Scorecard> {
    return this.http.get<Scorecard>(`/api/principles/${encodeURIComponent(symbol)}`, {
      params: new HttpParams().set('evidence', String(evidence)),
    });
  }

  /** Slow the first time for a peer group (several upstream calls per peer), then cached a day. */
  peers(symbol: string): Observable<Peers> {
    return this.http.get<Peers>(`/api/principles/${encodeURIComponent(symbol)}/peers`);
  }

  setCheck(
    symbol: string,
    key: string,
    verdict: Verdict,
    note: string,
  ): Observable<PrincipleCheck> {
    return this.http.put<PrincipleCheck>(
      `/api/principles/${encodeURIComponent(symbol)}/checks/${encodeURIComponent(key)}`,
      { verdict, note },
    );
  }

  clearCheck(symbol: string, key: string): Observable<void> {
    return this.http.delete<void>(
      `/api/principles/${encodeURIComponent(symbol)}/checks/${encodeURIComponent(key)}`,
    );
  }
}
