import { AreaSeries, ColorType, createChart, TickMarkType, UTCTimestamp } from 'lightweight-charts';
import { ChartPoint, formatCrosshairTime, formatIntradayTick } from '../../core/chart-data';
import { ChartHandle } from './chart-factory';

// Mid-tone colours that stay readable on both light and dark backgrounds.
const GAIN = '#16a34a';
const LOSS = '#dc2626';

const alpha = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** TradingView lightweight-charts (Apache-2.0). Its attribution logo is left on, as the licence asks. */
export function createLightweightChart(el: HTMLElement): ChartHandle {
  const gridColor = 'rgba(128, 128, 128, 0.15)';
  const chart = createChart(el, {
    autoSize: true, // follows the container's size (set in CSS)
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: getComputedStyle(el).color,
    },
    grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false },
    localization: {
      timeFormatter: (t: unknown) => formatCrosshairTime(t as number | string),
      priceFormatter: (p: number) => p.toFixed(2),
    },
  });
  const series = chart.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false });

  return {
    setData(points: ChartPoint[], { intraday, up }) {
      const color = up ? GAIN : LOSS;
      series.applyOptions({ lineColor: color, topColor: alpha(color, 0.28), bottomColor: alpha(color, 0) });
      chart.applyOptions({
        timeScale: {
          timeVisible: intraday,
          // Intraday ticks are shown in US Eastern time; daily ticks use the library's default (null).
          tickMarkFormatter: intraday
            ? (time: unknown, type: TickMarkType) => formatIntradayTick(time as number, type === TickMarkType.Time)
            : () => null,
        },
      });
      series.setData(points.map((p) => ({ time: p.time as UTCTimestamp | string, value: p.value })) as never);
      chart.timeScale().fitContent();
    },
    destroy: () => chart.remove(),
  };
}
