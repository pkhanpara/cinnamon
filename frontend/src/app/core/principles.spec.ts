import { describe, expect, it } from 'vitest';
import { Principle, Scorecard } from './models';
import {
  effectiveStatus,
  fmtPrincipleValue,
  mapLimit,
  passesAll,
  peerCompare,
  statusLabel,
  summarize,
} from './principles';

const p = (over: Partial<Principle> = {}): Principle => ({
  key: 'pe',
  label: 'Price / earnings',
  description: '',
  kind: 'computed',
  rule: '< 15',
  unit: 'ratio',
  better: 'lower',
  value: '12.00',
  status: 'pass',
  note: '',
  years: null,
  check: null,
  ...over,
});
const card = (principles: Principle[], applicable = true): Scorecard => ({
  symbol: 'X',
  name: null,
  sector: null,
  industry: null,
  applicable,
  principles,
  evidence: null,
  warnings: [],
  as_of: null,
  stale: false,
});
const check = (verdict: 'pass' | 'fail' | 'unsure') => ({ verdict, note: '', updated_at: '' });

describe('effectiveStatus', () => {
  it('uses the computed status without a verdict', () => {
    expect(effectiveStatus(p())).toBe('pass');
  });
  it('lets the user override it', () => {
    expect(effectiveStatus(p({ check: check('fail') }))).toBe('fail');
    expect(effectiveStatus(p({ kind: 'manual', status: 'manual', check: check('unsure') }))).toBe(
      'unsure',
    );
  });
  it('labels every status with text', () => {
    expect(statusLabel('pass')).toBe('✓ Pass');
    expect(statusLabel('manual')).toBe('Not checked');
  });
});

describe('fmtPrincipleValue', () => {
  it('formats by unit', () => {
    expect(fmtPrincipleValue('45.5', 'pct')).toBe('45.50%');
    expect(fmtPrincipleValue('7.1831', 'ratio')).toBe('7.18');
    expect(fmtPrincipleValue('610355000000', 'usd')).toBe('$610.36B');
    expect(fmtPrincipleValue(null, 'pct')).toBe('—');
  });
});

describe('peerCompare', () => {
  const stat = (median: string | null) => ({ key: 'pe', mean: '30', median, n: 3 });
  it('lower is better', () => {
    expect(peerCompare(p({ value: '10' }), stat('20'))).toBe('better');
    expect(peerCompare(p({ value: '30' }), stat('20'))).toBe('worse');
    expect(peerCompare(p({ value: '20' }), stat('20'))).toBe('same');
  });
  it('higher is better', () => {
    expect(peerCompare(p({ better: 'higher', value: '30' }), stat('20'))).toBe('better');
  });
  it('no verdict without a direction, a value or peers', () => {
    expect(peerCompare(p({ better: null }), stat('20'))).toBeNull();
    expect(peerCompare(p({ value: null }), stat('20'))).toBeNull();
    expect(peerCompare(p(), stat(null))).toBeNull();
    expect(peerCompare(p(), undefined)).toBeNull();
  });
});

describe('summarize and passesAll', () => {
  const sc = card([
    p({ key: 'pe' }),
    p({ key: 'pb', status: 'fail' }),
    p({ key: 'opm', status: 'warn' }),
    p({ key: 'rd', status: 'info' }),
    p({ key: 'cr', status: 'na' }),
    p({ key: 'moat', kind: 'manual', status: 'manual', check: check('pass') }),
  ]);
  it('counts graded answers', () => {
    expect(summarize(sc)).toEqual({ pass: 2, fail: 1, warn: 1, graded: 4 });
  });
  it('passes only when every chosen principle passes', () => {
    expect(passesAll(sc, new Set(['pe', 'moat']))).toBe(true);
    expect(passesAll(sc, new Set(['pe', 'pb']))).toBe(false);
    expect(passesAll(sc, new Set(['opm']))).toBe(false);
    expect(passesAll(sc, new Set(['cr']))).toBe(false);
    expect(passesAll(sc, new Set())).toBe(true);
  });
  it('a fund passes no filter', () => {
    expect(passesAll(card([], false), new Set(['pe']))).toBe(false);
    expect(passesAll(card([], false), new Set())).toBe(true);
  });
});

describe('mapLimit', () => {
  it('keeps order and never runs more than the limit', async () => {
    let running = 0,
      peak = 0;
    const out = await mapLimit([5, 1, 3, 2, 4], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20, 40]);
    expect(peak).toBe(2);
  });
  it('handles an empty list', async () => {
    expect(await mapLimit([], 3, async (x) => x)).toEqual([]);
  });
});
