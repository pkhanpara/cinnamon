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

  preview(accountId: number, connector: string, file: File): Observable<ImportPreview> {
    return this.http.post<ImportPreview>(
      `/api/accounts/${accountId}/imports/preview`,
      form(connector, file),
    );
  }

  commit(accountId: number, connector: string, file: File): Observable<ImportResult> {
    return this.http.post<ImportResult>(
      `/api/accounts/${accountId}/imports`,
      form(connector, file),
    );
  }
}

function form(connector: string, file: File): FormData {
  const body = new FormData();
  body.append('connector', connector);
  body.append('file', file, file.name);
  return body;
}
