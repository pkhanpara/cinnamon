import { DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { firstValueFrom } from 'rxjs';
import { RANGES } from '../../core/chart-data';
import { apiError } from '../../core/errors';
import { fmtMoney, fmtPct, fmtSigned, tone } from '../../core/format';
import { HistoryRange, PortfolioHistory } from '../../core/models';
import { fmtPoints, portfolioPoints, portfolioUp, spyPoints } from '../../core/portfolio-chart';
import { PortfolioService } from '../../core/portfolio.service';
import { CHART_FACTORY, ChartHandle } from '../price-chart/chart-factory';

/** Portfolio value over a range for the given accounts. A back-cast, and says so (ADR 0010). */
@Component({
  selector: 'app-portfolio-chart',
  imports: [DatePipe, MatButtonToggleModule, MatSlideToggleModule],
  template: `
    <section class="pv" aria-labelledby="pv-h">
      <div class="head">
        <div>
          <h3 id="pv-h">Portfolio value</h3>
          <p class="hint">Current holdings at past prices. Ignores past buys, sells and cash.</p>
        </div>
        <mat-slide-toggle class="spy" [checked]="compare()" (change)="compare.set($event.checked)">
          Compare with SPY</mat-slide-toggle>
      </div>

      <mat-button-toggle-group class="ranges seg" aria-label="Portfolio chart range" hideSingleSelectionIndicator
                               [value]="range()" (change)="range.set($event.value)">
        @for (r of ranges; track r.value) {
          <mat-button-toggle [value]="r.value">{{ r.label }}</mat-button-toggle>
        }
      </mat-button-toggle-group>

      @if (error()) {
        <p class="error" role="alert">{{ error() }} <button type="button" class="link" (click)="reload()">Retry</button></p>
      }
      @if (data(); as d) {
        @if (d.points.length > 0) {
          <p class="summary">
            <strong [class]="tone(d.change)">{{ signed(d.change!) }} <small>{{ pct(d.change_pct) }}</small></strong>
            over this range
            @if (d.spy) {
              · SPY {{ pct(d.spy.change_pct) }} · <strong>{{ points(d.spy.difference_pp) }}</strong> vs SPY
            }
          </p>
        } @else {
          <p class="hint">No priced holdings to chart.</p>
        }
        @if (d.stale) { <p class="warn" role="note">Showing cached prices from {{ d.as_of | date: 'medium' }}.</p> }
        @if (d.covered_value_pct !== null && d.warnings.length > 0) {
          <p class="hint">Chart covers {{ pct(d.covered_value_pct, false) }} of current value.</p>
        }
        @for (w of d.warnings; track w) { <p class="warn" role="note">{{ w }}</p> }
      } @else if (loading() && !error()) {
        <p class="hint">Loading chart…</p>
      }
      <div #host class="chart" role="img" [attr.aria-label]="label()" [hidden]="!hasPoints()"></div>
      @if (data()?.spy; as s) {
        <p class="legend"><span class="sw me"></span> Portfolio <span class="sw spy"></span> SPY (rebased to the starting value)</p>
      }
    </section>
  `,
  styles: `
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem 1rem; flex-wrap: wrap; }
    .head h3 { margin: 0 0 0.15rem; }
    .head .hint { margin: 0; }
    .ranges { margin: 1rem 0 0.5rem; }
    .chart { height: 18rem; width: 100%; }
    .summary { margin: 0.5rem 0 0.25rem; }
    .legend { font-size: 0.85rem; opacity: 0.8; }
    .sw { display: inline-block; width: 0.8rem; height: 0.15rem; margin: 0 0.25rem 0.2rem 0.75rem; }
    .sw.me { background: currentColor; }
    .sw.spy { background: var(--muted); }
  `,
})
export class PortfolioChart {
  /** The accounts to chart; an empty list charts nothing (and asks for nothing). */
  readonly accountIds = input.required<number[]>();

  private readonly api = inject(PortfolioService);
  private readonly factory = inject(CHART_FACTORY);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private handle: Promise<ChartHandle> | null = null;
  private destroyed = false;
  private seq = 0;

  protected readonly ranges = RANGES;
  protected readonly range = signal<HistoryRange>('1m');
  protected readonly compare = signal(false);
  protected readonly data = signal<PortfolioHistory | null>(null);
  protected readonly error = signal('');
  protected readonly loading = signal(false);
  private readonly retry = signal(0);

  protected readonly hasPoints = computed(() => (this.data()?.points.length ?? 0) > 0);
  protected readonly label = computed(() => {
    const d = this.data();
    return d?.points.length
      ? `Portfolio value, ${d.range}, from ${d.start_value} to ${d.end_value}`
      : 'Portfolio value chart';
  });

  protected readonly signed = fmtSigned;
  protected readonly money = fmtMoney;
  protected readonly pct = fmtPct;
  protected readonly tone = tone;
  protected readonly points = fmtPoints;

  constructor() {
    effect(() => {
      const ids = this.accountIds();
      const range = this.range();
      const compare = this.compare();
      this.retry();
      untracked(() => void this.load(ids, range, compare));
    });
    effect(() => {
      const d = this.data();
      if (!d || d.points.length === 0) return;
      const pts = portfolioPoints(d);
      const opts = { intraday: d.intraday, up: portfolioUp(d) };
      const spy = spyPoints(d);
      this.handle ??= this.factory(this.host().nativeElement);
      void this.handle.then((chart) => {
        if (this.destroyed) return;
        chart.setData(pts, opts);
        chart.setCompare?.(spy);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      void this.handle?.then((chart) => chart.destroy());
    });
  }

  protected reload(): void {
    this.retry.update((n) => n + 1);
  }

  private async load(ids: number[], range: HistoryRange, compare: boolean): Promise<void> {
    const seq = ++this.seq;
    this.error.set('');
    if (ids.length === 0) {
      this.data.set(null);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      const result = await firstValueFrom(this.api.history(ids, range, compare));
      if (seq === this.seq) this.data.set(result); // ignore answers to superseded requests
    } catch (e) {
      if (seq === this.seq) {
        this.data.set(null);
        this.error.set(apiError(e, 'Could not load the portfolio chart'));
      }
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }
}
