/** One display unit per chart, so bar labels stay short ("-1.5") and the unit is printed once. */

export interface ChartUnit {
  /** Divisor applied to each value. */
  div: number;
  /** Caption under the chart title, e.g. "USD billions". */
  label: string;
}

const UNITS: ChartUnit[] = [
  { div: 1e12, label: 'USD trillions' },
  { div: 1e9, label: 'USD billions' },
  { div: 1e6, label: 'USD millions' },
  { div: 1e3, label: 'USD thousands' },
];
const DOLLARS: ChartUnit = { div: 1, label: 'USD' };

// Pin both min and max digits: ICU builds differ in their defaults (see the cash-flow charts log).
const oneDecimal = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const noDecimals = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Picks the unit from the largest absolute value; nulls are ignored, all null or zero gives USD. */
export function chartUnit(values: (string | null)[]): ChartUnit {
  const max = Math.max(0, ...values.flatMap((v) => (v === null ? [] : [Math.abs(Number(v))])));
  return UNITS.find((u) => max >= u.div) ?? DOLLARS;
}

/**
 * "1.5", "-0.4", "27", "0": one decimal below 10, whole numbers from 10 (ten labels must fit a phone-width
 * card). A non-zero value that would print as 0.0 keeps its sign: "-<0.1". */
export function fmtInUnit(v: string, unit: ChartUnit): string {
  const n = Number(v) / unit.div;
  if (n === 0) return '0';
  if (Math.abs(n) < 0.05) return `${n < 0 ? '-' : ''}<0.1`;
  // 9.96 would print "10.0"; switch to whole numbers where the rounding does.
  return (Math.abs(n) >= 9.95 ? noDecimals : oneDecimal).format(n);
}
