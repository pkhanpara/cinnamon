import { InjectionToken } from '@angular/core';
import { ChartPoint } from '../../core/chart-data';

export interface ChartHandle {
  setData(points: ChartPoint[], opts: { intraday: boolean; up: boolean }): void;
  /** Overlay a second line (e.g. a benchmark); null removes it. Optional so simple charts need not implement it. */
  setCompare?(points: ChartPoint[] | null): void;
  destroy(): void;
}

/** Creates a chart inside `el`. Injectable so tests can swap in a fake (jsdom has no canvas). */
export type ChartFactory = (el: HTMLElement) => Promise<ChartHandle>;

export const CHART_FACTORY = new InjectionToken<ChartFactory>('CHART_FACTORY', {
  providedIn: 'root',
  factory: () => async (el) => (await import('./lightweight')).createLightweightChart(el),
});
