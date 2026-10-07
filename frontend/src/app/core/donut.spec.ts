import { donutSlices } from './donut';
import { Holding } from './models';

const h = (symbol: string, value: string | null): Holding => ({
  symbol, name: null, quantity: '1', cost_basis: '1', price: null, source: 'live', value,
  gain: null, gain_pct: null, weight_pct: null, day_change: null, day_change_pct: null, lines: [],
});

describe('donutSlices', () => {
  it('is empty without valued holdings', () => {
    expect(donutSlices([])).toEqual([]);
    expect(donutSlices([h('A', null), h('B', '0')])).toEqual([]);
  });

  it('slices sum to 100 and tile contiguously from 12 o\'clock', () => {
    const s = donutSlices([h('A', '50'), h('B', '30'), h('C', '20')]);
    expect(s.map((x) => x.label)).toEqual(['A', 'B', 'C']);
    expect(s.reduce((t, x) => t + x.pct, 0)).toBeCloseTo(100);
    expect(s[0].offset).toBe(25);
    expect(s[1].offset).toBeCloseTo(25 - 50);
    expect(s[2].offset).toBeCloseTo(25 - 80);
  });

  it('groups everything beyond the top N as Other, in grey', () => {
    const rows = Array.from({ length: 10 }, (_, i) => h(`S${i}`, String(100 - i)));
    const s = donutSlices(rows, 3);
    expect(s.map((x) => x.label)).toEqual(['S0', 'S1', 'S2', 'Other']);
    expect(s[3].color).toBe('#9ca3af');
    expect(s.reduce((t, x) => t + x.pct, 0)).toBeCloseTo(100);
  });

  it('ignores unpriced rows when computing shares', () => {
    const s = donutSlices([h('A', '10'), h('B', null)]);
    expect(s).toHaveLength(1);
    expect(s[0].pct).toBeCloseTo(100);
  });
});
