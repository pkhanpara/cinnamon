import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';
import { ConfirmService } from '../../components/confirm-dialog/confirm-dialog';
import { apiError } from '../../core/errors';
import { Principle, Scorecard, WatchlistDetail } from '../../core/models';
import {
  effectiveStatus,
  fmtPrincipleValue,
  mapLimit,
  passesAll,
  summarize,
} from '../../core/principles';
import { PrinciplesService } from '../../core/principles.service';
import { WatchlistsService } from '../../core/watchlists.service';

interface Row {
  symbol: string;
  scorecard: Scorecard | null;
  error: string;
}

/** Scorecards are fetched this many at a time so a long list doesn't burst the upstream budget. */
const CONCURRENCY = 3;

@Component({
  selector: 'app-watchlist',
  imports: [RouterLink],
  template: `
    <p><a class="back" routerLink="/watchlists">← Watchlists</a></p>
    @if (loadError()) {
      <p class="error" role="alert">{{ loadError() }}</p>
    } @else if (list(); as wl) {
      <header class="wl-head">
        @if (renaming()) {
          <form class="check" (submit)="$event.preventDefault(); rename()">
            <input aria-label="Watchlist name" maxlength="100" [value]="nameDraft()" (input)="nameDraft.set($any($event.target).value)" />
            <button type="submit" [disabled]="!nameDraft().trim()">Save</button>
            <button type="button" class="link" (click)="renaming.set(false)">Cancel</button>
          </form>
        } @else {
          <h2>{{ wl.name }}</h2>
          <span class="head-actions">
            <button type="button" (click)="startRename()">Rename</button>
            <button type="button" class="danger" (click)="remove()">Delete</button>
          </span>
        }
      </header>

      <form class="check add" (submit)="$event.preventDefault(); add()">
        <input aria-label="Symbol to add" placeholder="Symbol, e.g. JNJ" maxlength="15"
               [value]="symbolDraft()" (input)="symbolDraft.set($any($event.target).value)" />
        <button type="submit" [disabled]="busy() || !symbolDraft().trim()">Add</button>
      </form>
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      @if (noKey()) { <p class="warn" role="note">Scores need a Finnhub API key (FINNHUB_API_KEY).</p> }

      @if (rows().length === 0) {
        <p class="hint">No symbols yet. Add one above, or use "Add to watchlist" on a ticker page.</p>
      } @else {
        <fieldset class="accounts-filter">
          <legend>Show only symbols that pass</legend>
          @for (p of filterable(); track p.key) {
            <label class="chip" [class.on]="filters().has(p.key)"><input type="checkbox" [checked]="filters().has(p.key)" (change)="toggleFilter(p.key)" />{{ p.label }}</label>
          }
          @if (filters().size) { <button type="button" class="link" (click)="clearFilters()">Clear</button> }
        </fieldset>
        <p class="hint" role="status">{{ visible().length }} of {{ rows().length }} shown</p>

        <div class="table-x">
          <table class="wl-table">
            <thead>
              <tr>
                <th>Symbol</th><th>Score</th>
                @for (p of columns(); track p.key) { <th class="num" [title]="p.description">{{ p.label }}<div class="sub">{{ p.rule }}</div></th> }
                <th><span class="visually-hidden">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              @for (r of visible(); track r.symbol) {
                <tr>
                  <td><a class="sym" [routerLink]="['/symbol', r.symbol]">{{ r.symbol }}</a>
                    @if (r.scorecard?.name) { <div class="sub">{{ r.scorecard!.name }}</div> }</td>
                  @if (r.scorecard; as sc) {
                    @if (!sc.applicable) {
                      <td class="sub" [attr.colspan]="columns().length + 1">Fund: the principles don't apply.</td>
                    } @else {
                      <td>@if (score(sc); as s) { {{ s.pass }}/{{ s.graded }} pass@if (s.warn) { <div class="sub">{{ s.warn }} to check</div> } }</td>
                      @for (p of columns(); track p.key) {
                        @if (cell(sc, p.key); as c) {
                          <td class="num"><span [class]="'st st-' + status(c)">{{ mark(c) }}</span> {{ value(c) }}</td>
                        } @else { <td class="num muted">—</td> }
                      }
                    }
                  } @else if (r.error) {
                    <td class="error" [attr.colspan]="columns().length + 1">{{ r.error }}</td>
                  } @else {
                    <td class="hint" [attr.colspan]="columns().length + 1">Loading…</td>
                  }
                  <td><button type="button" class="link" [attr.aria-label]="'Remove ' + r.symbol" (click)="removeSymbol(r.symbol)">Remove</button></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="hint">✓ pass · ✗ fail · ! check · ? unsure · – n/a. Your own verdicts (set on the ticker page) override the computed result.</p>
      }
    } @else {
      <p class="hint">Loading…</p>
    }
  `,
  styles: `
    .wl-head { display: flex; gap: 0.75rem; align-items: baseline; flex-wrap: wrap; }
    .wl-table th { vertical-align: bottom; min-width: 5.5rem; }
    .wl-table td.num { white-space: nowrap; }
    .wl-table td:first-child { min-width: 8rem; }
    .back { text-decoration: none; font-size: 0.875rem; font-weight: 550; }
    .wl-head { align-items: center; }
    .wl-head h2 { margin: 0; }
    .head-actions { display: flex; gap: 0.4rem; margin-left: auto; }
    .danger { color: var(--loss) !important; }
    .add { flex-wrap: wrap; margin: 1rem 0; }
    .chip { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.25rem 0.75rem; border-radius: 999px;
            border: 1px solid var(--border-strong); background: var(--surface); font-size: 0.8rem; font-weight: 550; cursor: pointer; }
    .chip input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .chip.on { color: var(--accent); border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); }
    .chip.on::before { content: '✓'; }
    .chip:focus-within { box-shadow: var(--focus); }
    .accounts-filter { align-items: center; }
    .st { font-weight: 700; }
    .st-pass { color: var(--gain); }
    .st-fail { color: var(--loss); }
    .st-warn, .st-unsure { color: var(--warn); }
    .st-na, .st-manual, .st-info { color: var(--muted); }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  `,
})
export class WatchlistPage {
  private readonly api = inject(WatchlistsService);
  private readonly principles = inject(PrinciplesService);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  protected readonly id = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((p) => Number(p.get('id')))),
    { initialValue: 0 },
  );

  protected readonly list = signal<WatchlistDetail | null>(null);
  protected readonly loadError = signal('');
  protected readonly rows = signal<Row[]>([]);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly noKey = signal(false);
  protected readonly symbolDraft = signal('');
  protected readonly renaming = signal(false);
  protected readonly nameDraft = signal('');
  protected readonly filters = signal<ReadonlySet<string>>(new Set());
  private seq = 0;

  /** Principle definitions, taken from the first scorecard that has them. */
  private readonly definitions = computed<Principle[]>(
    () => this.rows().find((r) => r.scorecard?.applicable)?.scorecard?.principles ?? [],
  );
  protected readonly columns = computed(() =>
    this.definitions().filter((p) => p.kind === 'computed' && p.unit !== null && p.rule),
  );
  protected readonly filterable = computed(() =>
    this.definitions().filter((p) => p.kind === 'manual' || p.rule),
  );
  protected readonly visible = computed(() => {
    const f = this.filters();
    if (f.size === 0) return this.rows();
    return this.rows().filter((r) => r.scorecard && passesAll(r.scorecard, f));
  });

  protected readonly status = effectiveStatus;
  protected readonly score = summarize;

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) untracked(() => void this.load(id));
    });
  }

  protected cell(sc: Scorecard, key: string): Principle | undefined {
    return sc.principles.find((p) => p.key === key);
  }
  protected value(p: Principle): string {
    return p.value === null ? '' : fmtPrincipleValue(p.value, p.unit);
  }
  protected mark(p: Principle): string {
    const s = effectiveStatus(p);
    const marks: Record<string, string> = { pass: '✓', fail: '✗', warn: '!', unsure: '?' };
    return marks[s] ?? '–';
  }

  protected clearFilters(): void {
    this.filters.set(new Set());
  }

  protected toggleFilter(key: string): void {
    const next = new Set(this.filters());
    if (!next.delete(key)) next.add(key);
    this.filters.set(next);
  }

  private async load(id: number): Promise<void> {
    const seq = ++this.seq;
    this.list.set(null);
    this.loadError.set('');
    this.rows.set([]);
    this.noKey.set(false);
    try {
      const wl = await firstValueFrom(this.api.get(id));
      if (seq !== this.seq) return;
      this.list.set(wl);
      const symbols = wl.items.map((i) => i.symbol);
      this.rows.set(symbols.map((symbol) => ({ symbol, scorecard: null, error: '' })));
      await mapLimit(symbols, CONCURRENCY, (s) => this.loadRow(s, seq));
    } catch (e) {
      if (seq === this.seq) this.loadError.set(apiError(e, 'Could not load the watchlist'));
    }
  }

  private async loadRow(symbol: string, seq: number): Promise<void> {
    let patch: Partial<Row>;
    try {
      patch = { scorecard: await firstValueFrom(this.principles.scorecard(symbol, false)) };
    } catch (e) {
      const noKey = e instanceof HttpErrorResponse && e.status === 503;
      if (noKey) this.noKey.set(true);
      patch = { error: noKey ? 'No score without an API key.' : apiError(e, 'Score unavailable') };
    }
    if (seq !== this.seq) return;
    this.rows.update((rs) => rs.map((r) => (r.symbol === symbol ? { ...r, ...patch } : r)));
  }

  protected async add(): Promise<void> {
    const wl = this.list();
    const symbol = this.symbolDraft().trim().toUpperCase();
    if (!wl || !symbol || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.api.addSymbol(wl.id, symbol));
      // Only clear what was submitted: the user may have typed the next symbol meanwhile.
      if (this.symbolDraft().trim().toUpperCase() === symbol) this.symbolDraft.set('');
      if (!this.rows().some((r) => r.symbol === symbol)) {
        this.rows.update((rs) => [...rs, { symbol, scorecard: null, error: '' }]);
        void this.loadRow(symbol, this.seq);
      }
    } catch (e) {
      this.error.set(apiError(e, `Could not add ${symbol}`));
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeSymbol(symbol: string): Promise<void> {
    const wl = this.list();
    if (!wl) return;
    this.error.set('');
    try {
      await firstValueFrom(this.api.removeSymbol(wl.id, symbol));
      this.rows.update((rs) => rs.filter((r) => r.symbol !== symbol));
    } catch (e) {
      this.error.set(apiError(e, `Could not remove ${symbol}`));
    }
  }

  protected startRename(): void {
    this.nameDraft.set(this.list()?.name ?? '');
    this.renaming.set(true);
  }

  protected async rename(): Promise<void> {
    const wl = this.list();
    const name = this.nameDraft().trim();
    if (!wl || !name) return;
    this.error.set('');
    try {
      const updated = await firstValueFrom(this.api.rename(wl.id, name));
      this.list.set({ ...wl, name: updated.name });
      this.renaming.set(false);
    } catch (e) {
      this.error.set(apiError(e, 'Could not rename the watchlist'));
    }
  }

  protected async remove(): Promise<void> {
    const wl = this.list();
    if (
      !wl ||
      !(await this.confirm.ask({
        title: `Delete "${wl.name}"?`,
        message: 'The watchlist is removed. Your verdicts on its symbols are kept.',
        confirm: 'Delete',
        danger: true,
      }))
    )
      return;
    try {
      await firstValueFrom(this.api.remove(wl.id));
      await this.router.navigateByUrl('/watchlists');
    } catch (e) {
      this.error.set(apiError(e, 'Could not delete the watchlist'));
    }
  }
}
