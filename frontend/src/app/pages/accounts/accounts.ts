import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { ConfirmService } from '../../components/confirm-dialog/confirm-dialog';
import { AccountsService } from '../../core/accounts.service';
import { apiError } from '../../core/errors';
import { Account } from '../../core/models';

@Component({
  selector: 'app-accounts',
  imports: [
    ReactiveFormsModule,
    DatePipe,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  template: `
    <h3>Accounts</h3>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

    @if (loading()) {
      <p>Loading…</p>
    } @else if (accounts().length === 0) {
      <p class="hint">No accounts yet. Add one below, then import holdings into it later.</p>
    } @else {
      <ul class="accounts">
        @for (a of accounts(); track a.id) {
          <li>
            @if (editingId() === a.id) {
              <input #nick class="rename" [value]="a.nickname" aria-label="Nickname"
                     (keyup.enter)="saveRename(a, nick.value)" (keyup.escape)="editingId.set(null)" />
              <button mat-flat-button type="button" (click)="saveRename(a, nick.value)">Save</button>
              <button mat-button type="button" (click)="editingId.set(null)">Cancel</button>
            } @else {
              <strong>{{ a.nickname }}</strong> <span class="platform">{{ a.platform }}
                · @if (a.position_count) {
                  {{ a.position_count }} position(s), imported {{ a.last_import_at | date: 'medium' }}
                } @else { no holdings yet }
              </span>
              <span class="actions">
                <a mat-flat-button [routerLink]="['/settings/accounts', a.id, 'import']">Import</a>
                <button mat-stroked-button type="button" (click)="editingId.set(a.id)">Rename</button>
                <button mat-button type="button" class="del" (click)="remove(a)">Delete</button>
              </span>
            }
          </li>
        }
      </ul>
    }

    <form class="card" [formGroup]="form" (ngSubmit)="add()">
      <h3>Add account</h3>
      <mat-form-field>
        <mat-label>Platform</mat-label>
        <input matInput formControlName="platform" list="platforms" placeholder="robinhood" />
      </mat-form-field>
      <datalist id="platforms"><option value="robinhood"></option><option value="m1"></option></datalist>
      <mat-form-field>
        <mat-label>Nickname</mat-label>
        <input matInput formControlName="nickname" placeholder="Main brokerage" />
      </mat-form-field>
      <button mat-flat-button type="submit" [disabled]="form.invalid || busy()">Add account</button>
    </form>
  `,
  styles: `
    .actions { display: flex; gap: 0.25rem; margin-left: auto; }
    .del { --mat-button-text-label-text-color: var(--loss); }
    .rename { flex: 1; }
  `,
})
export class Accounts {
  private readonly api = inject(AccountsService);
  private readonly confirm = inject(ConfirmService);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly editingId = signal<number | null>(null);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    platform: ['', Validators.required],
    nickname: ['', Validators.required],
  });

  constructor() {
    void this.reload();
  }

  private async reload(): Promise<void> {
    try {
      this.accounts.set(await firstValueFrom(this.api.list()));
    } catch (e) {
      this.error.set(apiError(e, 'Could not load accounts'));
    } finally {
      this.loading.set(false);
    }
  }

  protected async add(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const { platform, nickname } = this.form.getRawValue();
      const created = await firstValueFrom(this.api.create(platform, nickname));
      this.accounts.update((list) => [...list, created]);
      this.form.reset();
    } catch (e) {
      this.error.set(apiError(e, 'Could not add account'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveRename(a: Account, nickname: string): Promise<void> {
    this.error.set('');
    try {
      const updated = await firstValueFrom(this.api.rename(a.id, nickname));
      this.accounts.update((list) => list.map((x) => (x.id === a.id ? updated : x)));
      this.editingId.set(null);
    } catch (e) {
      this.error.set(apiError(e, 'Could not rename account'));
    }
  }

  protected async remove(a: Account): Promise<void> {
    const ok = await this.confirm.ask({
      title: `Delete "${a.nickname}"?`,
      message: 'Its imported holdings will be deleted too. This cannot be undone.',
      confirm: 'Delete',
      danger: true,
    });
    if (!ok) return;
    this.error.set('');
    try {
      await firstValueFrom(this.api.remove(a.id));
      this.accounts.update((list) => list.filter((x) => x.id !== a.id));
    } catch (e) {
      this.error.set(apiError(e, 'Could not delete account'));
    }
  }
}
