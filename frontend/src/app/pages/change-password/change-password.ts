import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { HOME } from '../../core/auth.guard';
import { apiError } from '../../core/errors';

const matches = (group: AbstractControl): ValidationErrors | null =>
  group.get('next')?.value === group.get('confirm')?.value ? null : { mismatch: true };

@Component({
  selector: 'app-change-password',
  imports: [ReactiveFormsModule],
  template: `
    <h3>Change password</h3>
    @if (forced) {
      <p class="warn" role="note">
        This account still has the default password. Choose a new one to continue.
      </p>
    }
    <form class="card" [formGroup]="form" (ngSubmit)="submit()">
      <label>Current password
        <input type="password" formControlName="current" autocomplete="current-password" />
      </label>
      <label>New password
        <input type="password" formControlName="next" autocomplete="new-password" />
      </label>
      <label>Confirm new password
        <input type="password" formControlName="confirm" autocomplete="new-password" />
      </label>
      <p class="hint">At least 10 characters. Other devices will be signed out.</p>
      @if (form.hasError('mismatch') && form.controls.confirm.dirty) {
        <p class="error" role="alert">The new passwords don't match.</p>
      }
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      @if (done()) { <p class="notice" role="status">Password changed.</p> }
      <button type="submit" [disabled]="form.invalid || busy()">Change password</button>
    </form>
  `,
})
export class ChangePassword {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  /** Captured once: the flag clears after a successful change, but the banner must not flicker. */
  protected readonly forced = this.auth.mustChangePassword();
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      current: ['', Validators.required],
      next: ['', [Validators.required, Validators.minLength(10)]],
      confirm: ['', Validators.required],
    },
    { validators: matches },
  );

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.done.set(false);
    try {
      const { current, next } = this.form.getRawValue();
      await this.auth.changePassword(current, next);
      this.form.reset();
      if (this.forced) await this.router.navigateByUrl(HOME);
      else this.done.set(true);
    } catch (e) {
      this.error.set(apiError(e, 'Could not change the password'));
    } finally {
      this.busy.set(false);
    }
  }
}
