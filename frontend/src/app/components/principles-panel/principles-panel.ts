import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiError } from '../../core/errors';
import { BarPoint } from '../../core/bar-chart';
import {
  fmtCompactMoney,
  fmtMoney,
  fmtQty,
  fmtSigned,
  fmtSignedMillions,
  tone,
} from '../../core/format';
import {
  CashYear,
  Evidence,
  Peers,
  PeerStat,
  Principle,
  Scorecard,
  Verdict,
} from '../../core/models';
import {
  effectiveStatus,
  fmtPrincipleValue,
  peerCompare,
  statusLabel,
  summarize,
} from '../../core/principles';
import { PrinciplesService } from '../../core/principles.service';
import { YearBars } from './year-bars';

/** Charted cash-flow series, in the table's column order. */
const CASH_SERIES: { key: keyof Omit<CashYear, 'year' | 'revenue'>; title: string }[] = [
  { key: 'net_income', title: 'Net income' },
  { key: 'owner_earnings', title: 'Owner earnings' },
  { key: 'cfo', title: 'Operating cash' },
  { key: 'cff', title: 'Financing cash' },
  { key: 'acquisitions', title: 'Acquisitions' },
  { key: 'buybacks', title: 'Buybacks' },
  { key: 'rnd', title: 'R&D' },
];

/** Whether "All trades" is expanded; one setting per browser, not per symbol. */
const ALL_TRADES_KEY = 'cinnamon.principles.allTrades';

function readAllTrades(): boolean {
  try {
    return localStorage.getItem(ALL_TRADES_KEY) === '1';
  } catch {
    return false;
  }
}

/** Investing-principles scorecard of one symbol, compared with its Finnhub peer group (ADR 0012). */
@Component({
  selector: 'app-principles-panel',
  imports: [DatePipe, YearBars],
  template: `
    <section aria-labelledby="pr-h" class="principles">
      <div class="news-head">
        <h3 id="pr-h">Investing principles</h3>
        @if (summary(); as s) {
          <span class="sub">{{ s.pass }} pass · {{ s.fail }} fail · {{ s.warn }} to check, of {{ s.graded }} answered</span>
        }
      </div>

      @if (error()) {
        <p class="hint">{{ error() }}</p>
      } @else if (!scorecard()) {
        <p class="hint">Loading the scorecard…</p>
      } @else if (scorecard(); as sc) {
        @for (w of sc.warnings; track w) { <p class="warn" role="note">{{ w }}</p> }
        @if (sc.applicable) {
          <p class="hint peers-line" role="status">
            @if (peersError()) {
              Peer comparison unavailable: {{ peersError() }}
            } @else if (peers(); as pe) {
              Compared with {{ pe.peers.length }} peers in the same sub-industry:
              @for (x of pe.peers; track x.symbol; let last = $last) {
                <abbr [title]="x.name ?? x.symbol">{{ x.symbol }}</abbr>{{ last ? '' : ', ' }}
              }
              @if (pe.failed.length) { <span class="warn"> (no data for {{ pe.failed.join(', ') }})</span> }
              @if (pe.stale) { <span class="warn"> Some peer data is older than a day.</span> }
            } @else {
              Comparing with peers… the first time can take up to a minute.
            }
          </p>
          <div class="table-x">
            <table class="principles-table">
              <thead>
                <tr>
                  <th>Principle</th><th class="num">Value</th><th>Rule</th><th>Result</th>
                  <th class="num">Peer median</th><th class="num">Peer mean (n)</th><th>Your verdict</th>
                </tr>
              </thead>
              <tbody>
                @for (p of sc.principles; track p.key) {
                  <tr [class.manual]="p.kind === 'manual'">
                    <td>
                      <span [title]="p.description">{{ p.label }}</span>
                      @if (p.note) { <div class="sub">{{ p.note }}</div> }
                    </td>
                    <td class="num">{{ p.kind === 'computed' ? value(p) : '' }}</td>
                    <td class="sub">{{ p.rule }}</td>
                    <td><span [class]="'st st-' + status(p)">{{ label(status(p)) }}</span>
                      @if (p.check && p.kind === 'computed') { <div class="sub">computed: {{ label(p.status) }}</div> }
                    </td>
                    @if (stat(p.key); as st) {
                      <td class="num">{{ st.median !== null ? fmtValue(st.median, p.unit) : '—' }}
                        @if (compare(p); as c) { <div class="sub cmp-{{ c }}">{{ c }}</div> }
                      </td>
                      <td class="num">{{ st.mean !== null ? fmtValue(st.mean, p.unit) + ' (' + st.n + ')' : '—' }}</td>
                    } @else {
                      <td class="num muted">—</td><td class="num muted">—</td>
                    }
                    <td>
                      <select [attr.aria-label]="'Your verdict on ' + p.label" [value]="p.check?.verdict ?? ''"
                              [disabled]="saving() === p.key" (change)="setVerdict(p, $any($event.target).value)">
                        <option value="">—</option>
                        <option value="pass">Pass</option>
                        <option value="fail">Fail</option>
                        <option value="unsure">Unsure</option>
                      </select>
                      <button type="button" class="link" (click)="toggleNote(p)"
                              [attr.aria-expanded]="editing() === p.key">{{ p.check?.note ? 'Note ✎' : 'Add note' }}</button>
                    </td>
                  </tr>
                  @if (editing() === p.key) {
                    <tr class="subrow">
                      <td colspan="7">
                        <label>Note on {{ p.label }}
                          <textarea rows="2" maxlength="2000" [value]="draft()" (input)="draft.set($any($event.target).value)"></textarea>
                        </label>
                        <button type="button" (click)="saveNote(p)" [disabled]="saving() === p.key">Save note</button>
                        <button type="button" class="link" (click)="editing.set(null)">Cancel</button>
                        @if (!p.check) { <span class="sub">Saving a note marks the principle Unsure until you pick a verdict.</span> }
                      </td>
                    </tr>
                  } @else if (p.check?.note) {
                    <tr class="subrow"><td colspan="7" class="sub">Your note: {{ p.check!.note }}</td></tr>
                  }
                }
              </tbody>
            </table>
          </div>
          @if (saveError()) { <p class="error" role="alert">{{ saveError() }}</p> }

          @if (sc.evidence; as ev) {
            <details>
              <summary>Insider trades (Form 4, open market, last 12 months)</summary>
              @if (ev.insider_trades.length === 0) {
                <p class="hint">No open-market insider buys or sales in the last 12 months.</p>
              } @else {
                <h4>Insider trades summary</h4>
                <p class="hint">Dollar amounts are sale proceeds or purchase cost, not profit: Form 4 has no cost basis.</p>
                @for (side of [
                  { title: 'Top 10 sellers', rows: ev.insider_summary.sellers, value: 'Sold for', none: 'No open-market sales.' },
                  { title: 'Top 10 buyers', rows: ev.insider_summary.buyers, value: 'Bought for', none: 'No open-market buys.' },
                ]; track side.title) {
                  <h5>{{ side.title }}</h5>
                  @if (side.rows.length === 0) {
                    <p class="hint">{{ side.none }}</p>
                  } @else {
                    <div class="table-x">
                      <table class="lines insider-summary">
                        <thead><tr><th class="num">#</th><th>Insider</th><th>Span</th><th class="num">Trades</th><th class="num">Shares</th>
                          <th class="num">{{ side.value }}</th><th class="num">Avg price</th></tr></thead>
                        <tbody>
                          @for (r of side.rows; track r.name; let i = $index) {
                            <tr>
                              <td class="num">{{ i + 1 }}</td>
                              <td>{{ r.name }}</td>
                              <td class="span">{{ r.first_date | date: 'mediumDate' }}@if (r.last_date !== r.first_date) { – {{ r.last_date | date: 'mediumDate' }} }</td>
                              <td class="num">{{ r.trades }}</td>
                              <td class="num">{{ qty(r.shares.toString()) }}</td>
                              <td class="num">{{ money(r.value) }}@if (r.unpriced) {<span title="{{ r.unpriced }} trade(s) had no price and are left out">*</span>}</td>
                              <td class="num">{{ r.avg_price ? money(r.avg_price) : '—' }}</td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  }
                }
                @if (hasUnpriced(ev)) { <p class="sub">* Some trades had no price; amounts and averages leave them out.</p> }
                <p class="hint net-line">Net of all trades:
                  <span [class]="tone(ev.insider_net_value)" [title]="ev.insider_net_value !== null ? signed(ev.insider_net_value) : ''">{{ ev.insider_net_value !== null ? millions(ev.insider_net_value) : '—' }}</span>.
                  Finnhub does not say which insiders are officers; check the names against the 10-K.</p>
                <h4>
                  <button type="button" class="link all-trades" (click)="toggleAllTrades()"
                          [attr.aria-expanded]="allTrades()" aria-controls="pr-all-trades">
                    <span aria-hidden="true">{{ allTrades() ? '▾' : '▸' }}</span> All trades ({{ ev.insider_trades.length }})
                  </button>
                </h4>
                <div id="pr-all-trades">
                  @if (allTrades()) {
                    <div class="table-x">
                      <table class="lines all-trades-table">
                        <thead><tr><th>Insider</th><th>Date</th><th>Type</th><th class="num">Shares</th><th class="num">Price</th></tr></thead>
                        <tbody>
                          @for (t of ev.insider_trades; track $index) {
                            <tr>
                              <td>{{ t.name }}</td>
                              <td>{{ t.transaction_date | date: 'mediumDate' }}</td>
                              <td>{{ t.code === 'P' ? 'Buy' : 'Sale' }}</td>
                              <td class="num">{{ qty(t.shares_change.toString()) }}</td>
                              <td class="num">{{ t.price ? money(t.price) : '—' }}</td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  }
                </div>
              }
            </details>
            <details>
              <summary>Buybacks against the share price</summary>
              @if (ev.buybacks.length === 0) {
                <p class="hint">No buybacks in the last 5 fiscal years (or no price history).</p>
              } @else {
                <div class="table-x">
                  <table class="lines">
                    <thead><tr><th>Year</th><th class="num">Bought back</th><th class="num">Avg price</th><th class="num">5-year high</th><th>Near high</th></tr></thead>
                    <tbody>
                      @for (b of ev.buybacks; track b.year) {
                        <tr>
                          <td>{{ b.year }}</td><td class="num">{{ compact(b.amount) }}</td>
                          <td class="num">{{ b.avg_price ? money(b.avg_price) : '—' }}</td>
                          <td class="num">{{ b.high_5y ? money(b.high_5y) : '—' }}</td>
                          <td>{{ b.near_high ? 'yes' : 'no' }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </details>
            <details>
              <summary>Cash flows, acquisitions and R&amp;D by year (10-K)</summary>
              @if (ev.years.length) {
                <div class="year-charts">
                  @for (s of cashCharts(); track s.title) { <app-year-bars [title]="s.title" [points]="s.points" /> }
                </div>
              }
              <div class="table-x">
                <table class="lines">
                  <thead>
                    <tr><th>Fiscal year</th><th class="num">Net income</th><th class="num">Owner earnings</th><th class="num">Operating cash</th>
                      <th class="num">Financing cash</th><th class="num">Acquisitions</th><th class="num">Buybacks</th><th class="num">R&amp;D</th></tr>
                  </thead>
                  <tbody>
                    @for (y of ev.years; track y.year) {
                      <tr>
                        <td>{{ y.year }}</td>
                        <td class="num">{{ c(y.net_income) }}</td><td class="num">{{ c(y.owner_earnings) }}</td>
                        <td class="num">{{ c(y.cfo) }}</td><td class="num">{{ c(y.cff) }}</td>
                        <td class="num">{{ c(y.acquisitions) }}</td><td class="num">{{ c(y.buybacks) }}</td>
                        <td class="num">{{ c(y.rnd) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <p class="hint">Owner earnings here = net income + depreciation and amortization − capital spending.</p>
            </details>
            <details>
              <summary>Stock splits</summary>
              @if (ev.splits.length === 0) { <p class="hint">No splits on record.</p> }
              <ul>
                @for (s of ev.splits; track s.date) { <li>{{ s.date | date: 'mediumDate' }}: {{ s.ratio }}-for-1</li> }
              </ul>
            </details>
          }
          @if (sc.as_of) { <p class="sub">Fundamentals as of {{ sc.as_of | date: 'medium' }}. Temporary bad news: see the News section.</p> }
        }
      }
    </section>
  `,
  styles: `
    .principles-table select { font: inherit; }
    .principles-table tr.manual td:first-child { font-style: italic; }
    .st { display: inline-block; padding: 0.1rem 0.55rem; border-radius: 999px; font-size: 0.78rem; font-weight: 600;
          white-space: nowrap; background: var(--surface-2); color: var(--muted); }
    .st-pass { color: var(--gain); background: color-mix(in srgb, var(--gain) 12%, var(--surface)); }
    .st-fail { color: var(--loss); background: color-mix(in srgb, var(--loss) 10%, var(--surface)); }
    .st-warn, .st-unsure { color: var(--warn); background: color-mix(in srgb, var(--warn) 12%, var(--surface)); }
    .cmp-better { color: var(--gain); }
    .cmp-worse { color: var(--loss); }
    .news-head h3 { margin: 0.25rem auto 0.25rem 0; }
    textarea { font: inherit; width: 100%; max-width: 40rem; }
    details { margin: 0.5rem 0; padding: 0.6rem 0.9rem; border: 1px solid var(--border); border-radius: var(--radius-sm); }
    details[open] { background: var(--surface); }
    summary { cursor: pointer; font-weight: 550; }
    .table-x { box-shadow: none; }
    h4 { margin: 0.75rem 0 0.25rem; }
    h5 { margin: 0.5rem 0 0.25rem; }
    .insider-summary .span { white-space: nowrap; }
    h4 .all-trades { font: inherit; padding: 0; }
    .year-charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(16rem, 100%), 1fr));
                   gap: 1rem 1.5rem; margin: 0.75rem 0 1rem; }
  `,
})
export class PrinciplesPanel {
  private readonly api = inject(PrinciplesService);
  readonly symbol = input.required<string>();

  protected readonly scorecard = signal<Scorecard | null>(null);
  protected readonly error = signal('');
  protected readonly peers = signal<Peers | null>(null);
  protected readonly peersError = signal('');
  protected readonly saving = signal<string | null>(null);
  protected readonly saveError = signal('');
  protected readonly editing = signal<string | null>(null);
  protected readonly draft = signal('');
  protected readonly summary = computed(() => {
    const sc = this.scorecard();
    return sc?.applicable ? summarize(sc) : null;
  });
  private readonly stats = computed(
    () => new Map((this.peers()?.stats ?? []).map((s) => [s.key, s] as const)),
  );
  /** Oldest first: the API sends years newest first. */
  protected readonly cashCharts = computed(() => {
    const years = [...(this.scorecard()?.evidence?.years ?? [])].reverse();
    return CASH_SERIES.map(({ key, title }) => ({
      title,
      points: years.map((y): BarPoint => ({ label: String(y.year), value: y[key] })),
    }));
  });
  protected readonly allTrades = signal(readAllTrades());
  private seq = 0;

  protected readonly status = effectiveStatus;
  protected readonly label = statusLabel;
  protected readonly fmtValue = fmtPrincipleValue;
  protected readonly money = fmtMoney;
  protected readonly signed = fmtSigned;
  protected readonly millions = fmtSignedMillions;
  protected readonly compact = fmtCompactMoney;
  protected readonly qty = fmtQty;
  protected readonly tone = tone;

  protected hasUnpriced(ev: Evidence): boolean {
    const s = ev.insider_summary;
    return [...s.sellers, ...s.buyers].some((r) => r.unpriced > 0);
  }

  constructor() {
    effect(() => {
      const symbol = this.symbol();
      untracked(() => void this.load(symbol));
    });
  }

  protected toggleAllTrades(): void {
    const open = !this.allTrades();
    this.allTrades.set(open);
    try {
      localStorage.setItem(ALL_TRADES_KEY, open ? '1' : '0');
    } catch {
      // Storage blocked (private window, quota): the toggle still works for this page.
    }
  }

  protected value(p: Principle): string {
    return fmtPrincipleValue(p.value, p.unit);
  }
  protected stat(key: string): PeerStat | undefined {
    return this.stats().get(key);
  }
  protected compare(p: Principle) {
    return peerCompare(p, this.stat(p.key));
  }
  protected c(v: string | null): string {
    return v === null ? '—' : fmtCompactMoney(v);
  }

  private async load(symbol: string): Promise<void> {
    const seq = ++this.seq;
    this.scorecard.set(null);
    this.error.set('');
    this.peers.set(null);
    this.peersError.set('');
    this.editing.set(null);
    this.saveError.set('');
    try {
      const sc = await firstValueFrom(this.api.scorecard(symbol));
      if (seq !== this.seq) return;
      this.scorecard.set(sc);
      if (sc.applicable) void this.loadPeers(symbol, seq);
    } catch (e) {
      if (seq !== this.seq) return;
      const noKey = e instanceof HttpErrorResponse && e.status === 503;
      this.error.set(
        noKey
          ? 'The scorecard needs a Finnhub API key.'
          : apiError(e, 'The scorecard is unavailable'),
      );
    }
  }

  private async loadPeers(symbol: string, seq: number): Promise<void> {
    try {
      const pe = await firstValueFrom(this.api.peers(symbol));
      if (seq === this.seq) this.peers.set(pe);
    } catch (e) {
      if (seq === this.seq) this.peersError.set(apiError(e, 'please try again later'));
    }
  }

  protected toggleNote(p: Principle): void {
    if (this.editing() === p.key) {
      this.editing.set(null);
      return;
    }
    this.draft.set(p.check?.note ?? '');
    this.editing.set(p.key);
  }

  protected async saveNote(p: Principle): Promise<void> {
    const verdict: Verdict = p.check?.verdict ?? 'unsure';
    if (await this.save(p, verdict, this.draft())) this.editing.set(null);
  }

  protected async setVerdict(p: Principle, verdict: Verdict | ''): Promise<void> {
    await this.save(p, verdict || null, p.check?.note ?? '');
  }

  /** null clears the verdict (and its note). */
  private async save(p: Principle, verdict: Verdict | null, note: string): Promise<boolean> {
    const symbol = this.symbol();
    const seq = this.seq;
    this.saving.set(p.key);
    this.saveError.set('');
    try {
      const check = verdict
        ? await firstValueFrom(this.api.setCheck(symbol, p.key, verdict, note))
        : (await firstValueFrom(this.api.clearCheck(symbol, p.key)), null);
      if (seq !== this.seq) return false;
      this.scorecard.update((sc) =>
        sc
          ? { ...sc, principles: sc.principles.map((x) => (x.key === p.key ? { ...x, check } : x)) }
          : sc,
      );
      return true;
    } catch (e) {
      if (seq === this.seq) this.saveError.set(apiError(e, 'Could not save your verdict'));
      return false;
    } finally {
      if (seq === this.seq) this.saving.set(null);
    }
  }
}
