import { Component, computed, input } from '@angular/core';
import { barChart, BarPoint } from '../../core/bar-chart';
import { fmtCompactMoney } from '../../core/format';

const W = 320;
const H = 140;

/** One series by fiscal year as an inline SVG bar chart; points come oldest first. */
@Component({
  selector: 'app-year-bars',
  template: `
    <figure>
      <figcaption>
        <span class="t">{{ title() }}</span>
        @if (latest(); as l) { <span class="sub">{{ l.label }}: {{ fmt(l.value) }}</span> }
      </figcaption>
      @if (layout().empty) {
        <p class="sub">No data</p>
      } @else {
        <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="aria()">
          @for (b of layout().bars; track b.label) {
            @if (b.value === null) {
              <text class="na" [attr.x]="b.cx" [attr.y]="layout().zeroY - 4" text-anchor="middle">n/a</text>
            } @else {
              <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h"
                    [class]="b.negative ? 'neg' : 'pos'"><title>{{ b.label }}: {{ fmt(b.value) }}</title></rect>
            }
            <text class="yr" [attr.x]="b.cx" [attr.y]="H - 4" text-anchor="middle">{{ short() ? "'" + b.label.slice(-2) : b.label }}</text>
          }
          <line class="zero" x1="0" [attr.x2]="W" [attr.y1]="layout().zeroY" [attr.y2]="layout().zeroY" />
        </svg>
      }
    </figure>
  `,
  styles: `
    figure { margin: 0; min-width: 0; }
    figcaption { display: flex; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; font-size: 0.85rem; }
    .t { font-weight: 550; }
    svg { display: block; width: 100%; height: auto; overflow: visible; }
    .pos { fill: var(--gain); }
    .neg { fill: var(--loss); }
    .zero { stroke: var(--border-strong); stroke-width: 1; vector-effect: non-scaling-stroke; }
    text { font-size: 10px; fill: var(--muted); }
  `,
})
export class YearBars {
  readonly title = input.required<string>();
  readonly points = input.required<BarPoint[]>();

  protected readonly W = W;
  protected readonly H = H;
  protected readonly layout = computed(() =>
    barChart(this.points(), { width: W, height: H, top: 14, bottom: 18 }),
  );
  /** Ten 4-digit years don't fit under 32-unit slots; use '21 style past six. */
  protected readonly short = computed(() => this.points().length > 6);
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
}
