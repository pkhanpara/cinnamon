import { ChartPoint, periodUp } from './chart-data';
import { PortfolioHistory } from './models';

const time = (h: PortfolioHistory, p: { t: number; d: string }): number | string => (h.intraday ? p.t : p.d);

export function portfolioPoints(h: PortfolioHistory): ChartPoint[] {
  return h.points.map((p) => ({ time: time(h, p), value: Number(p.value) }));
}

/** The benchmark overlay, or null when the comparison is off or unavailable. */
export function spyPoints(h: PortfolioHistory): ChartPoint[] | null {
  if (!h.spy) return null;
  const pts = h.points.filter((p) => p.spy_value !== null).map((p) => ({ time: time(h, p), value: Number(p.spy_value) }));
  return pts.length > 0 ? pts : null;
}

export function portfolioUp(h: PortfolioHistory): boolean {
  return periodUp(portfolioPoints(h));
}

/** "+1.2 pp" / "-0.4 pp" for the gap between the portfolio's and SPY's change over the range. */
export function fmtPoints(pp: string | null): string {
  if (pp === null) return '—';
  const n = Number(pp);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)} pp`;
}
