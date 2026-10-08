import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { periodUp, toChartPoints } from '../../core/chart-data';
import { HistoryResponse } from '../../core/models';
import { CHART_FACTORY, ChartHandle } from './chart-factory';

@Component({
  selector: 'app-price-chart',
  template: `<div #host class="chart" role="img" [attr.aria-label]="label()"></div>`,
  styles: `.chart { height: 22rem; width: 100%; }`,
})
export class PriceChart {
  readonly history = input.required<HistoryResponse>();
  /** Previous close, used to colour a 1-day chart (see periodUp). */
  readonly baseline = input<number | null>(null);

  private readonly factory = inject(CHART_FACTORY);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private handle: Promise<ChartHandle> | null = null;
  private destroyed = false;

  protected readonly label = computed(() => {
    const h = this.history();
    const first = h.bars[0];
    const last = h.bars[h.bars.length - 1];
    return `Price chart for ${h.symbol}, ${h.range}, from ${first?.c} to ${last?.c}`;
  });

  constructor() {
    effect(() => {
      const h = this.history();
      const points = toChartPoints(h);
      const opts = {
        intraday: h.intraday,
        up: periodUp(points, h.range === '1d' ? this.baseline() : null),
      };
      // One chart per component; later data goes through the same promise so updates stay in order.
      this.handle ??= this.factory(this.host().nativeElement);
      void this.handle.then((chart) => {
        if (!this.destroyed) chart.setData(points, opts);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      void this.handle?.then((chart) => chart.destroy());
    });
  }
}
