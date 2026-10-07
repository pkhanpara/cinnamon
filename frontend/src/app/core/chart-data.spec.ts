import { formatCrosshairTime, formatIntradayTick, periodUp, RANGES, toChartPoints } from './chart-data';
import { Bar, HistoryResponse } from './models';

const bar = (t: number, d: string, c: string): Bar => ({ t, d, o: c, h: c, l: c, c, v: 1 });
const hist = (intraday: boolean, bars: Bar[]): HistoryResponse => ({ symbol: 'X', range: '1m', intraday, bars, stale: false, as_of: '' });

describe('chart data', () => {
  it('daily bars use the exchange date string, intraday bars the epoch', () => {
    const bars = [bar(1791316800, '2026-10-06', '239.24')];
    expect(toChartPoints(hist(false, bars))).toEqual([{ time: '2026-10-06', value: 239.24 }]);
    expect(toChartPoints(hist(true, bars))).toEqual([{ time: 1791316800, value: 239.24 }]);
  });

  it('colours the period by whether it ended at or above its start', () => {
    expect(periodUp([{ time: 1, value: 10 }, { time: 2, value: 10 }])).toBe(true);
    expect(periodUp([{ time: 1, value: 10 }, { time: 2, value: 9.99 }])).toBe(false);
    expect(periodUp([])).toBe(true);
  });

  it('a single day is coloured against the previous close, so it agrees with the header', () => {
    // opened at 241, drifted down to 239.17, but yesterday closed at 238.90: up on the day
    const day = [{ time: 1, value: 241 }, { time: 2, value: 239.17 }];
    expect(periodUp(day)).toBe(false);          // first-to-last would say "down"
    expect(periodUp(day, 238.9)).toBe(true);
    expect(periodUp(day, 240)).toBe(false);
    expect(periodUp(day, 239.17)).toBe(true);   // unchanged counts as up, like the header
  });

  it('offers the PDF ranges in order', () => {
    expect(RANGES.map((r) => r.label)).toEqual(['1D', '5D', '1M', '6M', 'YTD', '1Y', 'All']);
    expect(RANGES.map((r) => r.value)).toEqual(['1d', '5d', '1m', '6m', 'ytd', '1y', 'all']);
  });

  it('shows intraday times in US Eastern regardless of the browser zone', () => {
    // 2026-10-06 19:55:00 UTC is 3:55 PM EDT
    expect(formatCrosshairTime(Date.UTC(2026, 9, 6, 19, 55) / 1000)).toBe('Oct 6, 3:55 PM ET');
    expect(formatIntradayTick(Date.UTC(2026, 9, 6, 19, 55) / 1000, true)).toBe('3:55 PM');
    expect(formatIntradayTick(Date.UTC(2026, 9, 6, 19, 55) / 1000, false)).toBe('Oct 6');
  });

  it('daily crosshair labels do not drift by timezone', () => {
    expect(formatCrosshairTime('2026-01-02')).toBe('Jan 2, 2026');
  });
});
