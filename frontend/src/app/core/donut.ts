import { Holding } from './models';

export interface Slice {
  label: string;
  pct: number; // 0-100, share of the total
  offset: number; // stroke-dashoffset so slices tile around the circle
  color: string;
}

const COLORS = ['#2563eb', '#d97706', '#059669', '#db2777', '#7c3aed', '#0891b2', '#65a30d', '#dc2626'];
const OTHER = '#9ca3af';

/** Largest `max` holdings by value get a slice each; the rest are grouped as "Other". */
export function donutSlices(holdings: Holding[], max = 7): Slice[] {
  const valued = holdings
    .filter((h) => h.value !== null && Number(h.value) > 0)
    .map((h) => ({ label: h.symbol, value: Number(h.value) }))
    .sort((a, b) => b.value - a.value);
  const total = valued.reduce((s, h) => s + h.value, 0);
  if (total <= 0) return [];

  const head = valued.slice(0, max);
  const rest = valued.slice(max).reduce((s, h) => s + h.value, 0);
  const parts = rest > 0 ? [...head, { label: 'Other', value: rest }] : head;

  let cumulative = 0;
  return parts.map((p, i) => {
    const pct = (p.value / total) * 100;
    // SVG strokes start at 3 o'clock; offset 25 moves the start to 12 o'clock.
    const slice: Slice = {
      label: p.label,
      pct,
      offset: 25 - cumulative,
      color: p.label === 'Other' ? OTHER : COLORS[i % COLORS.length],
    };
    cumulative += pct;
    return slice;
  });
}
