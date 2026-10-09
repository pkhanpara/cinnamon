import {
  AreaSeries,
  ColorType,
  createChart,
  ISeriesApi,
  LineSeries,
  TickMarkType,
  UTCTimestamp,
} from 'lightweight-charts';
import { ChartPoint, formatCrosshairTime, formatIntradayTick } from '../../core/chart-data';
import { ChartHandle } from './chart-factory';

/** A colour token from styles.scss (`--gain`, ...), with a fallback for jsdom and missing tokens. */
const token = (name: string, fallback: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

const alpha = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** TradingView lightweight-charts (Apache-2.0). Its attribution logo is left on, as the licence asks. */
export function createLightweightChart(el: HTMLElement): ChartHandle {
  const gridColor = 'rgba(16, 24, 40, 0.06)';
  const crossColor = 'rgba(102, 112, 133, 0.5)';
  const gain = token('--gain', '#0f8a4f');
  const loss = token('--loss', '#d92d20');
  const chart = createChart(el, {
    autoSize: true, // follows the container's size (set in CSS)
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: token('--muted', getComputedStyle(el).color),
    },
    grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
    crosshair: { vertLine: { color: crossColor }, horzLine: { color: crossColor } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false },
    localization: {
      timeFormatter: (t: unknown) => formatCrosshairTime(t as number | string),
      priceFormatter: (p: number) => p.toFixed(2),
    },
  });
  const series = chart.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false });

  let compare: ISeriesApi<'Line'> | null = null;

  return {
    setCompare(points: ChartPoint[] | null) {
      if (points === null) {
        if (compare) chart.removeSeries(compare);
        compare = null;
        return;
      }
      compare ??= chart.addSeries(LineSeries, {
        lineWidth: 2,
        color: token('--muted', '#667085'),
        priceLineVisible: false,
        lastValueVisible: false,
      });
      compare.setData(
        points.map((p) => ({ time: p.time as UTCTimestamp | string, value: p.value })) as never,
      );
    },
    setData(points: ChartPoint[], { intraday, up }) {
      const color = up ? gain : loss;
      series.applyOptions({
        lineColor: color,
        topColor: alpha(color, 0.2),
        bottomColor: alpha(color, 0),
      });
      chart.applyOptions({
        timeScale: {
          timeVisible: intraday,
          // Intraday ticks are shown in US Eastern time; daily ticks use the library's default (null).
          tickMarkFormatter: intraday
            ? (time: unknown, type: TickMarkType) =>
                formatIntradayTick(time as number, type === TickMarkType.Time)
            : () => null,
        },
      });
      // Empty the overlay first: if it still holds the previous range's times when the area series
      // gets new ones, lightweight-charts paints the area at indices it has no bar for and throws
      // "Value is null" (seen switching 1M -> 6M with SPY on). The caller sets the overlay again next.
      compare?.setData([]);
      series.setData(
        points.map((p) => ({ time: p.time as UTCTimestamp | string, value: p.value })) as never,
      );
      chart.timeScale().fitContent();
    },
    destroy: () => chart.remove(),
  };
}
