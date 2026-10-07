import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AccountsService } from '../../core/accounts.service';
import { apiError } from '../../core/errors';
import { ImportsService } from '../../core/imports.service';
import { Account, Connector, ImportPreview, ImportResult } from '../../core/models';

@Component({
  selector: 'app-import',
  imports: [DecimalPipe, RouterLink],
  template: `
    <p><a routerLink="/accounts">← Accounts</a></p>
    <h2>Import into {{ account()?.nickname ?? '…' }}</h2>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

    @if (result(); as r) {
      <p class="notice" role="status">
        Imported {{ r.row_count }} position(s) from {{ r.filename }}.
        <a routerLink="/accounts">Back to accounts</a>
      </p>
    } @else if (account()) {
      <div class="card wide">
        <label>Format
          <select (change)="connector.set($any($event.target).value); clearPreview()" aria-label="Format">
            @for (c of connectors(); track c.slug) {
              <option [value]="c.slug" [selected]="c.slug === connector()">{{ c.label }}</option>
            }
          </select>
        </label>
        @if (selectedConnector(); as c) { <p class="hint">{{ c.description }}</p> }
        <label>File
          <input type="file" accept=".csv,text/csv" aria-label="File" (change)="onFile($any($event.target).files)" />
        </label>
        <button type="button" (click)="runPreview()" [disabled]="!file() || busy()">Preview</button>
      </div>

      @if (preview(); as p) {
        <h3>Preview: {{ p.filename }}</h3>
        @for (w of p.warnings; track w) { <p class="warn" role="note">{{ w }}</p> }
        @if (p.errors.length) {
          <div class="error" role="alert">
            <strong>{{ p.errors.length }} problem(s). Fix the file and preview again:</strong>
            <ul>
              @for (e of p.errors; track $index) {
                <li>{{ e.row ? 'Line ' + e.row : 'File' }}: {{ e.message }}</li>
              }
            </ul>
          </div>
        }
        @if (p.rows.length) {
          <p>
            {{ p.rows.length }} valid row(s) · cost basis {{ num(p.total_cost_basis) | number: '1.2-2' }}
            @if (p.total_market_value) { · market value {{ num(p.total_market_value) | number: '1.2-2' }} }
          </p>
          <div class="scroll">
            <table>
              <thead><tr><th>Symbol</th><th>Name</th><th class="num">Quantity</th><th class="num">Cost basis</th><th class="num">Market value</th></tr></thead>
              <tbody>
                @for (r of p.rows; track r.symbol) {
                  <tr>
                    <td>{{ r.symbol }}</td><td>{{ r.name }}</td>
                    <td class="num">{{ num(r.quantity) | number: '1.0-6' }}</td>
                    <td class="num">{{ num(r.cost_basis) | number: '1.2-2' }}</td>
                    <td class="num">{{ r.market_value ? (num(r.market_value) | number: '1.2-2') : '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        <p>
          <button type="button" (click)="confirm()" [disabled]="!canConfirm() || busy()">
            {{ p.current_position_count ? 'Replace ' + p.current_position_count + ' position(s) and import' : 'Import' }}
          </button>
          <button type="button" (click)="clearPreview()">Cancel</button>
        </p>
      }
    }
  `,
})
export class Import {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accounts = inject(AccountsService);
  private readonly api = inject(ImportsService);

  private readonly accountId = Number(this.route.snapshot.paramMap.get('id'));
  protected readonly account = signal<Account | null>(null);
  protected readonly connectors = signal<Connector[]>([]);
  protected readonly connector = signal('');
  protected readonly selectedConnector = computed(() => this.connectors().find((c) => c.slug === this.connector()));
  protected readonly file = signal<File | null>(null);
  protected readonly preview = signal<ImportPreview | null>(null);
  protected readonly result = signal<ImportResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly canConfirm = computed(() => {
    const p = this.preview();
    return !!p && p.errors.length === 0 && p.rows.length > 0;
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const list = await firstValueFrom(this.accounts.list());
      const account = list.find((a) => a.id === this.accountId) ?? null;
      if (!account) {
        await this.router.navigateByUrl('/accounts');
        return;
      }
      const connectors = await firstValueFrom(this.api.connectors(this.accountId));
      this.account.set(account);
      this.connectors.set(connectors);
      this.connector.set(connectors[0]?.slug ?? '');
    } catch (e) {
      this.error.set(apiError(e, 'Could not load the import page'));
    }
  }

  protected num(v: string): number {
    return Number(v);
  }

  protected onFile(files: FileList | null): void {
    this.file.set(files?.item(0) ?? null);
    this.clearPreview();
  }

  protected clearPreview(): void {
    this.preview.set(null);
    this.error.set('');
  }

  protected async runPreview(): Promise<void> {
    const file = this.file();
    if (!file) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.preview.set(await firstValueFrom(this.api.preview(this.accountId, this.connector(), file)));
    } catch (e) {
      this.preview.set(null);
      this.error.set(apiError(e, 'Could not read the file'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async confirm(): Promise<void> {
    const file = this.file();
    if (!file || !this.canConfirm()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.result.set(await firstValueFrom(this.api.commit(this.accountId, this.connector(), file)));
    } catch (e) {
      this.error.set(apiError(e, 'Import failed'));
    } finally {
      this.busy.set(false);
    }
  }
}
