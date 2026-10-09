import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Connector, ImportPreview, ImportResult } from './models';

@Injectable({ providedIn: 'root' })
export class ImportsService {
  private readonly http = inject(HttpClient);

  connectors(accountId: number): Observable<Connector[]> {
    return this.http.get<Connector[]>(`/api/accounts/${accountId}/connectors`);
  }

  preview(
    accountId: number,
    connector: string,
    file: File,
    averageCosts: Record<string, string> = {},
  ): Observable<ImportPreview> {
    return this.http.post<ImportPreview>(
      `/api/accounts/${accountId}/imports/preview`,
      form(connector, file, averageCosts),
    );
  }

  commit(
    accountId: number,
    connector: string,
    file: File,
    averageCosts: Record<string, string> = {},
  ): Observable<ImportResult> {
    return this.http.post<ImportResult>(
      `/api/accounts/${accountId}/imports`,
      form(connector, file, averageCosts),
    );
  }
}

function form(connector: string, file: File, averageCosts: Record<string, string>): FormData {
  const body = new FormData();
  body.append('connector', connector);
  body.append('file', file, file.name);
  if (Object.keys(averageCosts).length) body.append('average_costs', JSON.stringify(averageCosts));
  return body;
}
