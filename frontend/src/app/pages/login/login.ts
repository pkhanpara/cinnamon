import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { FORM_FIELD_DEFAULTS } from '../../core/material';
import { CHANGE_PASSWORD, HOME } from '../../core/auth.guard';
import { apiError } from '../../core/errors';

@Component({
  selector: 'app-login',
  providers: [FORM_FIELD_DEFAULTS],
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <div class="center">
      <form class="card auth" [formGroup]="form" (ngSubmit)="submit()">
        <div class="head">
          <span class="logo" aria-hidden="true"></span>
          <h2>Sign in</h2>
          <p class="hint">Welcome back to Cinnamon.</p>
        </div>
        <mat-form-field>
          <mat-label>Username</mat-label>
          <input matInput formControlName="username" autocomplete="username" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Password</mat-label>
          <input matInput type="password" formControlName="password" autocomplete="current-password" />
        </mat-form-field>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        <button mat-flat-button type="submit" [disabled]="form.invalid || busy()">Sign in</button>
      </form>
    </div>
  `,
  styles: `
    .center { display: grid; place-items: center; min-height: calc(100vh - 12rem); }
    .auth { width: min(24rem, 100%); box-sizing: border-box; margin: 0; padding: 2rem; gap: 0.5rem; }
    .head { text-align: center; margin-bottom: 0.75rem; }
    .head h2 { margin: 0.75rem 0 0.25rem; }
    .head p { margin: 0; }
    .logo { display: inline-block; width: 2.5rem; height: 2.5rem; border-radius: 12px;
            background: linear-gradient(135deg, #c2410c, #f59e0b); }
    button { height: 2.75rem; }
  `,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const { username, password } = this.form.getRawValue();
      const user = await this.auth.login(username, password);
      await this.router.navigateByUrl(user.must_change_password ? CHANGE_PASSWORD : HOME);
    } catch (e) {
      this.error.set(apiError(e, 'Sign in failed'));
    } finally {
      this.busy.set(false);
    }
  }
}
