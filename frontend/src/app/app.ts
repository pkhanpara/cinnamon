import { Component, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { catchError, map, of } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly http = inject(HttpClient);

  protected readonly apiStatus = toSignal(
    this.http.get<{ status: string }>('/api/health').pipe(
      map((r) => r.status),
      catchError(() => of('unreachable'))
    ),
    { initialValue: 'checking' }
  );
}
