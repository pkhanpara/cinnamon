/** Geometry of a small bar chart with a zero baseline, for inline SVG. Pure, so it is tested without a DOM. */

export interface BarPoint {
  label: string;
  /** Exact decimal from the API; null is a gap (no data that year). */
  value: string | null;
}

export interface Bar {
  label: string;
  value: string | null;
  /** Slot centre, for the label under the bar. */
  cx: number;
  x: number;
  y: number;
  w: number;
  h: number;
  negative: boolean;
}

export interface BarLayout {
  bars: Bar[];
  /** y of the zero line. */
  zeroY: number;
  /** Every value is null: nothing to draw. */
  empty: boolean;
}

export interface BarChartOpts {
  width: number;
  height: number;
  /** Space kept above and below the bars (labels go in `bottom`). */
  top: number;
  bottom: number;
}

/**
 * Lays out one bar per point, left to right in the given order. The domain always includes 0, so
 * positive bars rise from the zero line and negative ones hang below it. A null keeps its slot so
 * charts of the same years line up.
 */
export function barChart(points: BarPoint[], o: BarChartOpts): BarLayout {
  const values = points.flatMap((p) => (p.value === null ? [] : [Number(p.value)]));
  const plotTop = o.top;
  const plotBottom = o.height - o.bottom;
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min;
  // All zero (or no values): put the baseline at the bottom rather than divide by zero.
  const scale = span > 0 ? (plotBottom - plotTop) / span : 0;
  const zeroY = span > 0 ? plotTop + max * scale : plotBottom;
  const slot = points.length ? o.width / points.length : 0;
  const w = slot * 0.6;
  const bars = points.map((p, i): Bar => {
    const x = i * slot + (slot - w) / 2;
    const cx = i * slot + slot / 2;
    const n = p.value === null ? 0 : Number(p.value);
    const h = Math.abs(n) * scale;
    return {
      label: p.label,
      value: p.value,
      cx,
      x,
      y: n < 0 ? zeroY : zeroY - h,
      w,
      h,
      negative: n < 0,
    };
  });
  return { bars, zeroY, empty: values.length === 0 };
}
