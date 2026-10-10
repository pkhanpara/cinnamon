import { barChart, BarPoint } from './bar-chart';

const opts = { width: 100, height: 120, top: 10, bottom: 10 }; // plot area y 10..110
const pts = (...v: (string | null)[]): BarPoint[] =>
  v.map((value, i) => ({ label: String(2020 + i), value }));

describe('barChart', () => {
  it('all positive: baseline at the bottom, tallest bar fills the plot', () => {
    const l = barChart(pts('50', '100'), opts);
    expect(l.zeroY).toBe(110);
    expect(l.empty).toBe(false);
    expect(l.bars[1]).toMatchObject({ y: 10, h: 100, negative: false });
    expect(l.bars[0]).toMatchObject({ y: 60, h: 50 });
  });

  it('mixed signs: zero line inside the plot, negative bars hang below it', () => {
    const l = barChart(pts('300', '-100'), opts);
    expect(l.zeroY).toBe(85); // 10 + 300 * (100 / 400)
    expect(l.bars[0]).toMatchObject({ y: 10, h: 75, negative: false });
    expect(l.bars[1]).toMatchObject({ y: 85, h: 25, negative: true });
  });

  it('all negative: baseline at the top', () => {
    const l = barChart(pts('-20', '-40'), opts);
    expect(l.zeroY).toBe(10);
    expect(l.bars[1]).toMatchObject({ y: 10, h: 100, negative: true });
  });

  it('slots are evenly spaced, in the given order, bars centred in them', () => {
    const l = barChart(pts('1', '2', '3', '4'), opts);
    expect(l.bars.map((b) => b.label)).toEqual(['2020', '2021', '2022', '2023']);
    expect(l.bars.map((b) => b.cx)).toEqual([12.5, 37.5, 62.5, 87.5]);
    expect(l.bars[0].w).toBe(15);
    expect(l.bars[0].x).toBe(5);
  });

  it('a null keeps its slot with no bar', () => {
    const l = barChart(pts('10', null, '20'), opts);
    expect(l.bars).toHaveLength(3);
    expect(l.bars[1]).toMatchObject({ value: null, h: 0, negative: false });
    expect(l.bars[2].h).toBe(100);
  });

  it('all null is empty', () => {
    expect(barChart(pts(null, null), opts).empty).toBe(true);
    expect(barChart([], opts)).toEqual({ bars: [], zeroY: 110, empty: true });
  });

  it('all zero draws flat bars on the bottom line without dividing by zero', () => {
    const l = barChart(pts('0', '0'), opts);
    expect(l.empty).toBe(false);
    expect(l.zeroY).toBe(110);
    expect(l.bars.every((b) => b.h === 0 && Number.isFinite(b.y))).toBe(true);
  });

  it('a single year', () => {
    const l = barChart(pts('-5'), opts);
    expect(l.bars[0]).toMatchObject({ cx: 50, y: 10, h: 100, negative: true });
  });
});
