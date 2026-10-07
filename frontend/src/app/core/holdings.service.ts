import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { HoldingsResponse } from './models';

@Injectable({ providedIn: 'root' })
export class HoldingsService {
  private readonly http = inject(HttpClient);

  /** Always sends explicit ids, so "none selected" ('') can never be mistaken for "all". */
  get(accountIds: number[]): Observable<HoldingsResponse> {
    return this.http.get<HoldingsResponse>('/api/holdings', {
      params: { account_ids: accountIds.join(',') },
    });
  }
}
