/** Pure helpers for the investing-principles scorecard (ADR 0012). */
import { fmtCompactMoney } from './format';
import { PeerStat, Principle, PrincipleStatus, Scorecard } from './models';

export type EffectiveStatus = PrincipleStatus | 'unsure';

/** The user's own verdict wins over the computed status. */
export function effectiveStatus(p: Principle): EffectiveStatus {
  return p.check ? p.check.verdict : p.status;
}

const LABELS: Record<EffectiveStatus, string> = {
  pass: '✓ Pass',
  fail: '✗ Fail',
  warn: '! Check',
  info: 'Info',
  na: 'n/a',
  manual: 'Not checked',
  unsure: '? Unsure',
};

/** Text labels carry the meaning, so colour is never the only signal. */
export const statusLabel = (s: EffectiveStatus): string => LABELS[s];

export function fmtPrincipleValue(value: string | null, unit: Principle['unit']): string {
  if (value === null) return '—';
  const n = Number(value);
  if (unit === 'pct') return `${n.toFixed(2)}%`;
  if (unit === 'usd') return fmtCompactMoney(value);
  return n.toFixed(2);
}

export type PeerVerdict = 'better' | 'worse' | 'same';

/** Against the peer median (the mean is shown too, but one outlier can drag it anywhere). */
export function peerCompare(p: Principle, stat: PeerStat | undefined): PeerVerdict | null {
  if (!stat || stat.median === null || p.value === null || !p.better) return null;
  const v = Number(p.value),
    m = Number(stat.median);
  if (v === m) return 'same';
  return (p.better === 'lower') === v < m ? 'better' : 'worse';
}

export interface ScoreSummary {
  pass: number;
  fail: number;
  warn: number;
  graded: number; // principles with a pass/fail/warn answer
}

export function summarize(sc: Scorecard): ScoreSummary {
  const s: ScoreSummary = { pass: 0, fail: 0, warn: 0, graded: 0 };
  for (const p of sc.principles) {
    const st = effectiveStatus(p);
    if (st === 'pass' || st === 'fail' || st === 'warn') {
      s[st]++;
      s.graded++;
    }
  }
  return s;
}

/** A row passes when every chosen principle passes (a warning or n/a does not). */
export function passesAll(sc: Scorecard, keys: ReadonlySet<string>): boolean {
  if (!sc.applicable) return keys.size === 0;
  return sc.principles.filter((p) => keys.has(p.key)).every((p) => effectiveStatus(p) === 'pass');
}

/** Run `fn` over `items` with at most `limit` in flight; results keep the input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
