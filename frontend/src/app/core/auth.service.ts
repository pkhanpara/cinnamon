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
  /** True while the account still has a default password that must be changed. */
  readonly mustChangePassword = computed(() => this._user()?.must_change_password === true);

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

  async login(username: string, password: string): Promise<User> {
    const user = await firstValueFrom(this.http.post<User>('/api/auth/login', { username, password }));
    this.set(user);
    return user;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    this.set(
      await firstValueFrom(
        this.http.post<User>('/api/auth/change-password', {
          current_password: currentPassword,
          new_password: newPassword,
        }),
      ),
    );
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

  /** Called by the interceptor when the server blocks a call until the password is changed. */
  markPasswordChangeRequired(): void {
    this._user.update((u) => (u ? { ...u, must_change_password: true } : u));
  }

  private set(user: User): void {
    this._user.set(user);
    this.resolved = true;
  }
}
