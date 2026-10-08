import { lineGain, showPlatform } from './lines';

const l = (cost_basis: string, value: string | null) => ({ cost_basis, value });

describe('lineGain', () => {
  it('computes amount and percent for gains and losses', () => {
    expect(lineGain(l('100', '120.50'))).toEqual({ gain: '20.50', pct: '20.5000' });
    expect(lineGain(l('200', '150'))).toEqual({ gain: '-50.00', pct: '-25.0000' });
    expect(lineGain(l('100', '100'))).toEqual({ gain: '0.00', pct: '0.0000' });
  });

  it('has no gain without a value (no price)', () => {
    expect(lineGain(l('100', null))).toBeNull();
  });

  it('keeps the amount but drops the percent when the cost basis is zero', () => {
    expect(lineGain(l('0', '50'))).toEqual({ gain: '50.00', pct: null });
    expect(lineGain(l('0.00', '0'))).toEqual({ gain: '0.00', pct: null });
  });
});

describe('showPlatform', () => {
  it('hides the platform when it repeats the nickname, ignoring case and whitespace', () => {
    expect(showPlatform('robinhood', 'robinhood')).toBe(false);
    expect(showPlatform('Robinhood', 'robinhood')).toBe(false);
    expect(showPlatform(' ROBINHOOD ', 'robinhood ')).toBe(false);
  });

  it('shows it when it differs, and never shows an empty one', () => {
    expect(showPlatform('Roth', 'robinhood')).toBe(true);
    expect(showPlatform('Robinhood 2', 'robinhood')).toBe(true);
    expect(showPlatform('Roth', '')).toBe(false);
  });
});
