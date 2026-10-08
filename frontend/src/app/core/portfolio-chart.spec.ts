import { PortfolioHistory } from './models';
import { fmtPoints, portfolioPoints, portfolioUp, spyPoints } from './portfolio-chart';

const h = (over: Partial<PortfolioHistory> = {}): PortfolioHistory => ({
  basis: 'backcast',
  range: '1m',
  intraday: false,
  points: [
    { t: 1, d: '2026-09-01', value: '100.00', spy_value: '100.00' },
    { t: 2, d: '2026-09-02', value: '90.00', spy_value: '105.00' },
  ],
  start_value: '100.00',
  end_value: '90.00',
  change: '-10.00',
  change_pct: '-10.00',
  spy: { change_pct: '5.00', difference_pp: '-15.00' },
  symbols: ['A'],
  covered_value_pct: '100.00',
  warnings: [],
  stale: false,
  as_of: null,
  ...over,
});

describe('portfolio chart helpers', () => {
  it('uses dates for daily ranges and epochs for intraday', () => {
    expect(portfolioPoints(h())).toEqual([
      { time: '2026-09-01', value: 100 },
      { time: '2026-09-02', value: 90 },
    ]);
    expect(portfolioPoints(h({ intraday: true }))[1]).toEqual({ time: 2, value: 90 });
  });
  it('returns the SPY overlay only when the comparison came back', () => {
    expect(spyPoints(h())).toEqual([
      { time: '2026-09-01', value: 100 },
      { time: '2026-09-02', value: 105 },
    ]);
    expect(spyPoints(h({ spy: null }))).toBeNull();
    expect(
      spyPoints(h({ points: [{ t: 1, d: '2026-09-01', value: '1', spy_value: null }] })),
    ).toBeNull();
  });
  it('colours by first-to-last', () => {
    expect(portfolioUp(h())).toBe(false);
    expect(portfolioUp(h({ points: [] }))).toBe(true);
  });
  it('formats the gap in percentage points with a real minus sign', () => {
    expect(fmtPoints('1.2')).toBe('+1.20 pp');
    expect(fmtPoints('-15.00')).toBe('−15.00 pp');
    expect(fmtPoints('0')).toBe('0.00 pp');
    expect(fmtPoints(null)).toBe('—');
  });
});
