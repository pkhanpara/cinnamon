import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { User } from './models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly _user = signal<User | null>(null);
  private resolved = false;

  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);

  /** Resolve the current session once per page load; later calls reuse the result. */
  async ensureLoaded(): Promise<void> {
    if (this.resolved) return;
    try {
      this._user.set(await firstValueFrom(this.http.get<User>('/api/auth/me')));
    } catch {
      this._user.set(null);
    }
    this.resolved = true;
  }

  async setupRequired(): Promise<boolean> {
    const s = await firstValueFrom(this.http.get<{ setup_required: boolean }>('/api/auth/status'));
    return s.setup_required;
  }

  async login(username: string, password: string): Promise<void> {
    this.set(await firstValueFrom(this.http.post<User>('/api/auth/login', { username, password })));
  }

  async setup(username: string, password: string): Promise<void> {
    this.set(await firstValueFrom(this.http.post<User>('/api/auth/setup', { username, password })));
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post<void>('/api/auth/logout', {}));
    } finally {
      this.clear();
    }
  }

  /** Called by the interceptor when the server says the session is gone. */
  clear(): void {
    this._user.set(null);
    this.resolved = true;
  }

  private set(user: User): void {
    this._user.set(user);
    this.resolved = true;
  }
}
