import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { apiError } from '../../core/errors';
import { User } from '../../core/models';
import { UserPatch, UsersService } from '../../core/users.service';

const USERNAME_HINT = 'Usernames: 3-64 letters, digits, . _ -';
// Mirrors the backend Username type (it trims and lowercases first).
const USERNAME_PATTERN = /^[a-z0-9_.-]{3,64}$/i;

function usernameValidator(c: AbstractControl): ValidationErrors | null {
  const v = String(c.value ?? '').trim();
  return v === '' || USERNAME_PATTERN.test(v) ? null : { username: true };
}

/** A 422 whose first problem is on the username field (pydantic prints the raw regex otherwise). */
function isUsernameRejected(e: unknown): boolean {
  const d = e instanceof HttpErrorResponse && e.status === 422 ? e.error?.detail : null;
  return Array.isArray(d) && Array.isArray(d[0]?.loc) && d[0].loc.includes('username');
}

@Component({
  selector: 'app-users',
  imports: [ReactiveFormsModule],
  template: `
    <h3>User setup</h3>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (notice()) { <p class="notice" role="status">{{ notice() }}</p> }

    @if (loading()) {
      <p>Loading…</p>
    } @else {
      <ul class="accounts">
        @for (u of users(); track u.id) {
          <li [class.inactive]="!u.is_active">
            <strong>{{ u.username }}</strong>
            <span class="platform">
              {{ u.is_admin ? 'admin' : 'user' }}{{ u.is_active ? '' : ' · deactivated' }}
              @if (u.id === me()?.id) { · you }
              @if (u.must_change_password) { · must set a new password at next sign-in }
            </span>
            @if (resettingId() === u.id) {
              <input #pw type="password" aria-label="Temporary password" placeholder="Temporary password (10+ chars)"
                     autocomplete="new-password" (keyup.enter)="resetPassword(u, pw.value)"
                     (keyup.escape)="resettingId.set(null)" />
              <button type="button" (click)="resetPassword(u, pw.value)">Save</button>
              <button type="button" (click)="resettingId.set(null)">Cancel</button>
            } @else {
              <button type="button" (click)="resettingId.set(u.id)">Reset password</button>
              @if (u.id !== me()?.id) {
                <button type="button" (click)="patch(u, { is_admin: !u.is_admin })">
                  {{ u.is_admin ? 'Remove admin' : 'Make admin' }}</button>
                <button type="button" (click)="patch(u, { is_active: !u.is_active })">
                  {{ u.is_active ? 'Deactivate' : 'Activate' }}</button>
              }
            }
          </li>
        }
      </ul>
    }

    <form class="card" [formGroup]="form" (ngSubmit)="add()">
      <h3>Add user</h3>
      <label>Username <input formControlName="username" autocomplete="off" /></label>
      <label>Temporary password
        <input type="password" formControlName="password" autocomplete="new-password" />
      </label>
      <label class="check"><input type="checkbox" formControlName="is_admin" /> Administrator</label>
      <p class="hint" [class.error]="usernameInvalid()">{{ USERNAME_HINT }}</p>
      <p class="hint">They will be asked to choose their own password at first sign-in.</p>
      <button type="submit" [disabled]="form.invalid || busy()">Add user</button>
    </form>
  `,
})
export class Users {
  protected readonly USERNAME_HINT = USERNAME_HINT;
  private readonly api = inject(UsersService);
  protected readonly me = inject(AuthService).user;
  protected readonly users = signal<User[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly resettingId = signal<number | null>(null);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    username: ['', [Validators.required, usernameValidator]],
    password: ['', [Validators.required, Validators.minLength(10)]],
    is_admin: [false],
  });

  protected usernameInvalid(): boolean {
    const c = this.form.controls.username;
    return c.dirty && c.invalid;
  }

  constructor() {
    void this.reload();
  }

  private async reload(): Promise<void> {
    try {
      this.users.set(await firstValueFrom(this.api.list()));
    } catch (e) {
      this.error.set(apiError(e, 'Could not load users'));
    } finally {
      this.loading.set(false);
    }
  }

  private clearMessages(): void {
    this.error.set('');
    this.notice.set('');
  }

  protected async add(): Promise<void> {
    this.busy.set(true);
    this.clearMessages();
    try {
      const { username, password, is_admin } = this.form.getRawValue();
      const created = await firstValueFrom(this.api.create(username, password, is_admin));
      this.users.update((list) => [...list, created]);
      this.form.reset();
      this.notice.set(
        `Created ${created.username}. They must set a new password at first sign-in.`,
      );
    } catch (e) {
      this.error.set(isUsernameRejected(e) ? USERNAME_HINT : apiError(e, 'Could not add user'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async patch(u: User, change: UserPatch): Promise<void> {
    this.clearMessages();
    try {
      const updated = await firstValueFrom(this.api.update(u.id, change));
      this.users.update((list) => list.map((x) => (x.id === u.id ? updated : x)));
    } catch (e) {
      this.error.set(apiError(e, 'Could not update user'));
    }
  }

  protected async resetPassword(u: User, password: string): Promise<void> {
    this.clearMessages();
    if (password.length < 10) {
      this.error.set('Password must be at least 10 characters');
      return;
    }
    try {
      const updated = await firstValueFrom(this.api.update(u.id, { password }));
      this.users.update((list) => list.map((x) => (x.id === u.id ? updated : x)));
      this.resettingId.set(null);
      this.notice.set(
        `Password reset for ${u.username}. Their sessions were signed out and they must set a new password at next sign-in.`,
      );
    } catch (e) {
      this.error.set(apiError(e, 'Could not reset password'));
    }
  }
}
