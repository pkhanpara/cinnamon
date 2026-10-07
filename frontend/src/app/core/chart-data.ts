import { HistoryRange, HistoryResponse } from './models';

export const RANGES: { value: HistoryRange; label: string }[] = [
  { value: '1d', label: '1D' },
  { value: '5d', label: '5D' },
  { value: '1m', label: '1M' },
  { value: '6m', label: '6M' },
  { value: 'ytd', label: 'YTD' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
];

/** `time` is a UTC epoch (number) for intraday bars and a YYYY-MM-DD string for daily ones. */
export interface ChartPoint {
  time: number | string;
  value: number;
}

export function toChartPoints(h: HistoryResponse): ChartPoint[] {
  return h.bars.map((b) => ({ time: h.intraday ? b.t : b.d, value: Number(b.c) }));
}

/**
 * Whether the period ended at or above its reference (colours the line). The reference is the first
 * point, except for a single day, where `baseline` is yesterday's close so the line agrees with the
 * day change shown in the page header (a stock can open high, drift down and still be up on the day).
 */
export function periodUp(points: ChartPoint[], baseline: number | null = null): boolean {
  if (points.length === 0) return true;
  const last = points[points.length - 1].value;
  if (baseline !== null) return last >= baseline;
  return points.length < 2 || last >= points[0].value;
}

const NY = 'America/New_York';
const timeOnly = new Intl.DateTimeFormat('en-US', { timeZone: NY, hour: 'numeric', minute: '2-digit' });
const dayOnly = new Intl.DateTimeFormat('en-US', { timeZone: NY, month: 'short', day: 'numeric' });
const dateTime = new Intl.DateTimeFormat('en-US', { timeZone: NY, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fullDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });

/** Crosshair label. Intraday bars are shown in US Eastern time, where the market trades. */
export function formatCrosshairTime(time: number | string): string {
  if (typeof time === 'number') return `${dateTime.format(time * 1000)} ET`;
  return fullDate.format(new Date(`${time}T00:00:00Z`));
}

/** Axis tick label for intraday charts. `type` follows lightweight-charts: 3 = time of day, else a date. */
export function formatIntradayTick(time: number | string, isTimeOfDay: boolean): string {
  if (typeof time !== 'number') return String(time);
  return (isTimeOfDay ? timeOnly : dayOnly).format(time * 1000);
}
