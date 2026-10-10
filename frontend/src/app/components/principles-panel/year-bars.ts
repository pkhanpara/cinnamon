import { Component, computed, input } from '@angular/core';
import { barChart, BarPoint } from '../../core/bar-chart';
import { fmtCompactMoney } from '../../core/format';
import { chartUnit, fmtInUnit } from './value-unit';

/**
 * One series by fiscal year as a bar chart card; points come oldest first. Bars are positioned in
 * percent from `barChart` (a 100x100 box), and the labels are HTML so they render at real text size
 * however narrow the card is (SVG text scaled down with the chart and became unreadable).
 */
@Component({
  selector: 'app-year-bars',
  template: `
    <figure class="chart-card">
      <figcaption>
        <span class="t">{{ title() }}</span>
        @if (latest(); as l) { <span class="latest">{{ l.label }}: {{ fmt(l.value) }}</span> }
        @if (!layout().empty) { <span class="unit">{{ unit().label }}</span> }
      </figcaption>
      @if (layout().empty) {
        <p class="sub">No data</p>
      } @else {
        <div class="plot" role="img" [attr.aria-label]="aria()" [class.has-neg]="hasNeg()"
             [style.grid-template-columns]="cols()">
          <div class="zero" [style.top.%]="layout().zeroY"></div>
          @for (b of layout().bars; track b.label) {
            <div class="col" [title]="b.label + ': ' + (b.value === null ? 'no data' : fmt(b.value))">
              @if (b.value === null) {
                <span class="na" aria-hidden="true" [style.bottom]="above(0)">n/a</span>
              } @else if (b.negative) {
                <div class="bar neg" [style.top.%]="layout().zeroY" [style.height.%]="b.h"></div>
                <span class="val below" aria-hidden="true" [style.top]="below(b.h)">{{ short(b.value) }}</span>
              } @else {
                <div class="bar pos" [class.nz]="isNonZero(b.value)"
                     [style.bottom.%]="100 - layout().zeroY" [style.height.%]="b.h"></div>
                <span class="val above" aria-hidden="true" [style.bottom]="above(b.h)">{{ short(b.value) }}</span>
              }
            </div>
          }
        </div>
        <div class="years" aria-hidden="true" [style.grid-template-columns]="cols()">
          @for (b of layout().bars; track b.label) { <span class="yr">{{ b.label }}</span> }
        </div>
      }
    </figure>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .chart-card {
      margin: 0; padding: 0.75rem 0.9rem 0.6rem; container-type: inline-size;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm);
    }
    figcaption { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.1rem 0.75rem; font-size: 0.85rem; }
    .t { font-weight: 600; margin-right: auto; }
    .latest { font-variant-numeric: tabular-nums; }
    .unit { flex-basis: 100%; font-size: 0.75rem; color: var(--muted); }
    .sub { margin: 0.5rem 0 0; }
    .plot { position: relative; display: grid; height: 7.5rem; margin: 1.1rem 0 0.35rem; }
    .plot.has-neg { margin-bottom: 1.15rem; }
    .zero { position: absolute; left: 0; right: 0; border-top: 1px solid var(--border-strong); }
    .col { position: relative; min-width: 0; }
    .bar { position: absolute; left: 20%; width: 60%; }
    .bar.pos { background: var(--gain); border-radius: 2px 2px 0 0; }
    .bar.pos.nz, .bar.neg { min-height: 1px; }
    .bar.neg { background: var(--loss); border-radius: 0 0 2px 2px; }
    .val, .na {
      position: absolute; left: 50%; transform: translateX(-50%); white-space: nowrap; line-height: 1;
      font-size: 0.7rem; font-variant-numeric: tabular-nums;
    }
    .val { color: var(--text); }
    .na { color: var(--muted); }
    .years { display: grid; font-size: 0.7rem; color: var(--muted); font-variant-numeric: tabular-nums; }
    .yr { text-align: center; white-space: nowrap; min-width: 0; }
    /* Ten years in a phone-width card: about 26px per column. */
    @container (max-width: 19rem) {
      .val, .na, .years { font-size: 0.62rem; }
    }
  `,
})
export class YearBars {
  readonly title = input.required<string>();
  readonly points = input.required<BarPoint[]>();

  /** Percent geometry: the plot box is 100 x 100. */
  protected readonly layout = computed(() =>
    barChart(this.points(), { width: 100, height: 100, top: 0, bottom: 0 }),
  );
  protected readonly unit = computed(() => chartUnit(this.points().map((p) => p.value)));
  protected readonly hasNeg = computed(() => this.layout().bars.some((b) => b.negative));
  protected readonly cols = computed(() => `repeat(${this.points().length}, minmax(0, 1fr))`);
  protected readonly latest = computed(() => {
    const withValue = this.points().filter((p) => p.value !== null);
    return withValue.length ? withValue[withValue.length - 1] : null;
  });
  protected readonly aria = computed(
    () =>
      `${this.title()} by fiscal year, oldest first: ` +
      this.points()
        .map((p) => `${p.label} ${p.value === null ? 'no data' : this.fmt(p.value)}`)
        .join(', '),
  );

  protected fmt(v: string | null): string {
    return v === null ? '—' : fmtCompactMoney(v);
  }
  protected short(v: string): string {
    return fmtInUnit(v, this.unit());
  }
  protected isNonZero(v: string): boolean {
    return Number(v) !== 0;
  }
  /** CSS offset that puts a label just above the top of a positive bar of height h (percent). */
  protected above(h: number): string {
    return `calc(${100 - this.layout().zeroY + h}% + 3px)`;
  }
  /** CSS offset that puts a label just under a negative bar of height h (percent). */
  protected below(h: number): string {
    return `calc(${this.layout().zeroY + h}% + 3px)`;
  }
}
