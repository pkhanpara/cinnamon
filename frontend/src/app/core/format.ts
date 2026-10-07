/** Display formatting. The API sends exact decimals as strings; convert only here, only to show them. */

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const signedMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', signDisplay: 'exceptZero' });
const compactMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });
const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const quantity = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });

export const fmtMoney = (v: string): string => money.format(Number(v));
export const fmtSigned = (v: string): string => signedMoney.format(Number(v));
export const fmtCompactMoney = (v: string): string => compactMoney.format(Number(v));
export const fmtCompactNumber = (v: string): string => compactNumber.format(Number(v));
export const fmtQty = (v: string): string => quantity.format(Number(v));

export function fmtPct(v: string | null, signed = true): string {
  if (v === null) return '';
  const n = Number(v);
  return `${signed && n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

/** CSS class for a signed amount. The sign is always printed too, so colour is never the only signal. */
export function tone(v: string | null): string {
  if (v === null) return 'muted';
  return Number(v) > 0 ? 'gain' : Number(v) < 0 ? 'loss' : '';
}
