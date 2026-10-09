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
    <p><a routerLink="/settings/accounts">← Accounts</a></p>
    <h3>Import into {{ account()?.nickname ?? '…' }}</h3>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

    @if (result(); as r) {
      <p class="notice" role="status">
        Imported {{ r.row_count }} position(s) from {{ r.filename }}.
        <a routerLink="/settings/accounts">Back to accounts</a>
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
        @if (p.needs_average_cost.length) {
          <fieldset class="card wide">
            <legend>Average cost for transferred shares</legend>
            <p class="hint">
              The report has no cost for shares transferred in from another broker. Enter the average cost
              the Robinhood app shows for each, then apply.
            </p>
            @for (s of p.needs_average_cost; track s) {
              <label>{{ s }}
                <input type="text" inputmode="decimal" [attr.aria-label]="'Average cost for ' + s"
                       [value]="costs()[s] || ''" (input)="setCost(s, $any($event.target).value)" />
              </label>
            }
            <button type="button" (click)="runPreview()" [disabled]="busy()">Apply costs</button>
          </fieldset>
        }
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
  protected readonly selectedConnector = computed(() =>
    this.connectors().find((c) => c.slug === this.connector()),
  );
  protected readonly file = signal<File | null>(null);
  protected readonly preview = signal<ImportPreview | null>(null);
  protected readonly result = signal<ImportResult | null>(null);
  /** Average costs being typed, and the ones the current preview was made with (sent on import). */
  protected readonly costs = signal<Record<string, string>>({});
  private appliedCosts: Record<string, string> = {};
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
        await this.router.navigateByUrl('/settings/accounts');
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
    this.costs.set({});
    this.appliedCosts = {};
    this.error.set('');
  }

  protected setCost(symbol: string, value: string): void {
    this.costs.update((c) => ({ ...c, [symbol]: value }));
  }

  protected async runPreview(): Promise<void> {
    const file = this.file();
    if (!file) return;
    this.busy.set(true);
    this.error.set('');
    const costs = Object.fromEntries(
      Object.entries(this.costs())
        .map(([s, v]) => [s, v.trim()] as const)
        .filter(([, v]) => v),
    );
    try {
      this.preview.set(
        await firstValueFrom(this.api.preview(this.accountId, this.connector(), file, costs)),
      );
      this.appliedCosts = costs;
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
      this.result.set(
        await firstValueFrom(
          this.api.commit(this.accountId, this.connector(), file, this.appliedCosts),
        ),
      );
    } catch (e) {
      this.error.set(apiError(e, 'Import failed'));
    } finally {
      this.busy.set(false);
    }
  }
}
