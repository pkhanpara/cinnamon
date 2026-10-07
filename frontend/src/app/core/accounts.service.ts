import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Account } from './models';

@Injectable({ providedIn: 'root' })
export class AccountsService {
  private readonly http = inject(HttpClient);

  list(): Observable<Account[]> {
    return this.http.get<Account[]>('/api/accounts');
  }
  create(platform: string, nickname: string): Observable<Account> {
    return this.http.post<Account>('/api/accounts', { platform, nickname });
  }
  rename(id: number, nickname: string): Observable<Account> {
    return this.http.patch<Account>(`/api/accounts/${id}`, { nickname });
  }
  remove(id: number): Observable<void> {
    return this.http.delete<void>(`/api/accounts/${id}`);
  }
}
