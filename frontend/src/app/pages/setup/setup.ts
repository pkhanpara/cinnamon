import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { apiError } from '../../core/errors';

@Component({
  selector: 'app-setup',
  imports: [ReactiveFormsModule],
  template: `
    <form class="card" [formGroup]="form" (ngSubmit)="submit()">
      <h2>Create the admin account</h2>
      <p class="hint">First run: this account manages users. 3+ characters for the username,
        10+ for the password.</p>
      <label>Username <input formControlName="username" autocomplete="username" /></label>
      <label>Password
        <input type="password" formControlName="password" autocomplete="new-password" />
      </label>
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      <button type="submit" [disabled]="form.invalid || busy()">Create admin</button>
    </form>
  `,
})
export class Setup {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3)]],
    password: ['', [Validators.required, Validators.minLength(10)]],
  });

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const { username, password } = this.form.getRawValue();
      await this.auth.setup(username, password);
      await this.router.navigateByUrl('/holdings');
    } catch (e) {
      this.error.set(apiError(e, 'Setup failed'));
    } finally {
      this.busy.set(false);
    }
  }
}
