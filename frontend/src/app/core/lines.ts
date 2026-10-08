/** Display helpers for the per-account lines of a merged holding (Home sub-rows, ticker position). */
import { HoldingLine } from './models';

export interface LineGain {
  gain: string;
  /** null when the cost basis is zero: the amount is still meaningful, a percentage is not. */
  pct: string | null;
}

/** Gain of one account line (value - cost basis). null when the line has no value (no price). */
export function lineGain(l: Pick<HoldingLine, 'value' | 'cost_basis'>): LineGain | null {
  if (l.value === null) return null;
  const cost = Number(l.cost_basis);
  const gain = Number(l.value) - cost;
  return { gain: gain.toFixed(2), pct: cost === 0 ? null : ((gain / cost) * 100).toFixed(4) };
}

/** Show the platform next to an account nickname only when it adds information. */
export function showPlatform(nickname: string, platform: string): boolean {
  const p = platform.trim().toLowerCase();
  return p !== '' && p !== nickname.trim().toLowerCase();
}
