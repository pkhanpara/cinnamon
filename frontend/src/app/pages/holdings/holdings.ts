import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AccountsService } from '../../core/accounts.service';
import { loadSelection, parseUrlSelection, reconcile, saveSelection } from '../../core/account-selection';
import { AuthService } from '../../core/auth.service';
import { apiError } from '../../core/errors';
import { HoldingsService } from '../../core/holdings.service';
import { Account, Holding, HoldingsResponse } from '../../core/models';
import { Donut } from '../../components/donut/donut';
import { fmtMoney, fmtPct, fmtQty, fmtSigned, tone } from '../../core/format';

type SortKey = 'symbol' | 'quantity' | 'price' | 'cost_basis' | 'value' | 'day_change' | 'gain' | 'weight_pct';

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'symbol', label: 'Symbol', numeric: false },
  { key: 'quantity', label: 'Quantity', numeric: true },
  { key: 'price', label: 'Price', numeric: true },
  { key: 'cost_basis', label: 'Cost basis', numeric: true },
  { key: 'value', label: 'Value', numeric: true },
  { key: 'day_change', label: 'Day change', numeric: true },
  { key: 'gain', label: 'Gain / loss', numeric: true },
  { key: 'weight_pct', label: 'Weight', numeric: true },
];

@Component({
  selector: 'app-holdings',
  imports: [DatePipe, RouterLink, Donut],
  template: `
    <h2>Home</h2>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

    @if (loadingAccounts()) {
      <p>Loading…</p>
    } @else if (accounts().length === 0) {
      <p class="hint">No accounts yet. <a routerLink="/settings/accounts">Add an account</a> and import its holdings.</p>
    } @else {
      <fieldset class="accounts-filter">
        <legend>Accounts</legend>
        <label class="check">
          <input type="checkbox" aria-label="All accounts" [checked]="allSelected()"
                 [indeterminate]="someSelected()" (change)="toggleAll()" /> All
        </label>
        @for (a of accounts(); track a.id) {
          <label class="check">
            <input type="checkbox" [attr.aria-label]="a.nickname" [checked]="selected().includes(a.id)"
                   (change)="toggle(a.id)" /> {{ a.nickname }}
            <span class="platform">{{ a.platform }}</span>
          </label>
        }
      </fieldset>

      @if (selected().length === 0) {
        <p class="hint">Select at least one account to see holdings.</p>
      } @else if (data(); as d) {
        @for (w of d.warnings; track w) { <p class="warn" role="note">{{ w }}</p> }

        @if (d.holdings.length === 0) {
          <p class="hint">The selected accounts have no holdings yet. <a routerLink="/settings/accounts">Import a file</a>.</p>
        } @else {
          <div class="tiles">
            <div class="tile"><span class="k">Total value</span><strong>{{ fmt(d.summary.total_value) }}</strong></div>
            <div class="tile"><span class="k">Day change</span>
              @if (d.summary.day_change !== null) {
                <strong [class]="tone(d.summary.day_change)">{{ signed(d.summary.day_change) }}
                  <small>{{ pct(d.summary.day_change_pct) }}</small></strong>
              } @else { <strong class="muted">—</strong> }
            </div>
            <div class="tile"><span class="k">Gain / loss</span>
              <strong [class]="tone(d.summary.gain)">{{ signed(d.summary.gain) }}
                <small>{{ pct(d.summary.gain_pct) }}</small></strong>
            </div>
            <div class="tile"><span class="k">Cost basis</span><strong>{{ fmt(d.summary.total_cost_basis) }}</strong></div>
          </div>

          <app-donut [holdings]="d.holdings" />

          <div class="scroll tall">
            <table>
              <thead>
                <tr>
                  <th></th>
                  @for (c of columns; track c.key) {
                    <th [class.num]="c.numeric" [attr.aria-sort]="ariaSort(c.key)">
                      <button type="button" class="link" (click)="sortBy(c.key)">
                        {{ c.label }}{{ sortKey() === c.key ? (sortDir() === 'asc' ? ' ▲' : ' ▼') : '' }}
                      </button>
                    </th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (h of sorted(); track h.symbol) {
                  <tr>
                    <td>
                      @if (h.lines.length > 1) {
                        <button type="button" class="link" [attr.aria-expanded]="expanded().has(h.symbol)"
                                [attr.aria-label]="'Show accounts for ' + h.symbol" (click)="toggleRow(h.symbol)">
                          {{ expanded().has(h.symbol) ? '▾' : '▸' }}</button>
                      }
                    </td>
                    <td>
                      <a class="sym" [routerLink]="['/symbol', h.symbol]"><strong>{{ h.symbol }}</strong></a> {{ badge(h) }}
                      <div class="sub">{{ h.name }}@if (h.lines.length === 1) { · {{ h.lines[0].account_nickname }} }</div>
                    </td>
                    <td class="num">{{ qty(h.quantity) }}</td>
                    <td class="num">{{ h.price ? fmt(h.price) : '—' }}</td>
                    <td class="num">{{ fmt(h.cost_basis) }}</td>
                    <td class="num">{{ h.value ? fmt(h.value) : '—' }}</td>
                    <td class="num" [class]="tone(h.day_change)">
                      @if (h.day_change !== null) { {{ signed(h.day_change) }}<div class="sub">{{ pct(h.day_change_pct) }}</div> } @else { — }
                    </td>
                    <td class="num" [class]="tone(h.gain)">
                      @if (h.gain !== null) { {{ signed(h.gain) }}<div class="sub">{{ pct(h.gain_pct) }}</div> } @else { — }
                    </td>
                    <td class="num">{{ h.weight_pct ? pct(h.weight_pct, false) : '—' }}</td>
                  </tr>
                  @if (expanded().has(h.symbol)) {
                    @for (l of h.lines; track l.account_id) {
                      <tr class="subrow">
                        <td></td>
                        <td class="sub">{{ l.account_nickname }} <span class="platform">{{ l.platform }}</span></td>
                        <td class="num">{{ qty(l.quantity) }}</td><td></td>
                        <td class="num">{{ fmt(l.cost_basis) }}</td>
                        <td class="num">{{ l.value ? fmt(l.value) : '—' }}</td><td></td><td></td><td></td>
                      </tr>
                    }
                  }
                }
              </tbody>
            </table>
          </div>

          <p class="hint foot">
            USD.
            @if (d.prices_as_of) { Live prices from Finnhub as of {{ d.prices_as_of | date: 'mediumTime' }} (cached up to a minute). }
            @else { No live prices. }
            <button type="button" class="link" (click)="refresh()" [disabled]="busy()">Refresh</button>
          </p>
        }
      }
    }
  `,
})
export class Holdings {
  private readonly accountsApi = inject(AccountsService);
  private readonly api = inject(HoldingsService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly columns = COLUMNS;
  protected readonly accounts = signal<Account[]>([]);
  protected readonly selected = signal<number[]>([]);
  protected readonly data = signal<HoldingsResponse | null>(null);
  protected readonly loadingAccounts = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());
  protected readonly sortKey = signal<SortKey>('value');
  protected readonly sortDir = signal<'asc' | 'desc'>('desc');

  protected readonly allSelected = computed(() => this.selected().length === this.accounts().length);
  protected readonly someSelected = computed(() => this.selected().length > 0 && !this.allSelected());
  protected readonly sorted = computed(() => {
    const rows = this.data()?.holdings ?? [];
    const key = this.sortKey();
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = this.sortValue(a, key);
      const y = this.sortValue(b, key);
      if (x === null && y === null) return a.symbol.localeCompare(b.symbol);
      if (x === null) return 1; // rows without a value always sink to the bottom
      if (y === null) return -1;
      const c = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
      return c === 0 ? a.symbol.localeCompare(b.symbol) : c * dir;
    });
  });

  private requestSeq = 0;

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      const accounts = await firstValueFrom(this.accountsApi.list());
      this.accounts.set(accounts);
      const userId = this.auth.user()?.id ?? 0;
      this.selected.set(
        reconcile(
          accounts.map((a) => a.id),
          parseUrlSelection(this.route.snapshot.queryParamMap.get('accounts')),
          loadSelection(userId),
        ),
      );
    } catch (e) {
      this.error.set(apiError(e, 'Could not load accounts'));
    } finally {
      this.loadingAccounts.set(false);
    }
    await this.load();
  }

  private async load(): Promise<void> {
    const ids = this.selected();
    const seq = ++this.requestSeq;
    if (ids.length === 0) {
      this.data.set(null);
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await firstValueFrom(this.api.get(ids));
      if (seq === this.requestSeq) this.data.set(result); // ignore answers to superseded requests
    } catch (e) {
      if (seq === this.requestSeq) this.error.set(apiError(e, 'Could not load holdings'));
    } finally {
      if (seq === this.requestSeq) this.busy.set(false);
    }
  }

  private async changeSelection(ids: number[]): Promise<void> {
    this.selected.set(ids);
    saveSelection(this.auth.user()?.id ?? 0, ids, this.accounts().map((a) => a.id));
    void this.router.navigate([], {
      queryParams: { accounts: ids.join(',') },
      replaceUrl: true,
    });
    await this.load();
  }

  protected toggle(id: number): Promise<void> {
    const next = this.selected().includes(id) ? this.selected().filter((x) => x !== id) : [...this.selected(), id];
    return this.changeSelection(this.accounts().map((a) => a.id).filter((x) => next.includes(x)));
  }

  protected toggleAll(): Promise<void> {
    return this.changeSelection(this.allSelected() ? [] : this.accounts().map((a) => a.id));
  }

  protected refresh(): Promise<void> {
    return this.load();
  }

  protected toggleRow(symbol: string): void {
    this.expanded.update((s) => {
      const next = new Set(s);
      if (!next.delete(symbol)) next.add(symbol);
      return next;
    });
  }

  protected sortBy(key: SortKey): void {
    if (this.sortKey() === key) this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      this.sortKey.set(key);
      this.sortDir.set(key === 'symbol' ? 'asc' : 'desc');
    }
  }

  protected ariaSort(key: SortKey): string {
    return this.sortKey() === key ? (this.sortDir() === 'asc' ? 'ascending' : 'descending') : 'none';
  }

  private sortValue(h: Holding, key: SortKey): string | number | null {
    if (key === 'symbol') return h.symbol;
    const raw = h[key];
    return raw === null || raw === undefined ? null : Number(raw);
  }

  // --- formatting (display only: values arrive as exact decimal strings) ---
  protected readonly fmt = fmtMoney;
  protected readonly signed = fmtSigned;
  protected readonly qty = fmtQty;
  protected readonly pct = fmtPct;
  protected readonly tone = tone;
  protected badge(h: Holding): string {
    return h.source === 'stale' ? '(stale price)' : h.source === 'file' ? '(imported value)' : h.source === 'none' ? '(no price)' : '';
  }
}
