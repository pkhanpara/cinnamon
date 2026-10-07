import { ageLabel, fmtCompactMoney, fmtCompactNumber, fmtMoney, fmtPct, fmtQty, fmtSigned, tone } from './format';

describe('format', () => {
  it('formats money with grouping and cents', () => {
    expect(fmtMoney('1234.5')).toBe('$1,234.50');
    expect(fmtMoney('-0.5')).toBe('-$0.50');
  });
  it('prints the sign on signed amounts, nothing on zero', () => {
    expect(fmtSigned('5')).toBe('+$5.00');
    expect(fmtSigned('-5')).toBe('-$5.00');
    expect(fmtSigned('0')).toBe('$0.00');
  });
  it('percent: optional plus sign, two decimals', () => {
    expect(fmtPct('0.9172')).toBe('+0.92%');
    expect(fmtPct('-3.5')).toBe('-3.50%');
    expect(fmtPct('25', false)).toBe('25.00%');
    expect(fmtPct(null)).toBe('');
  });
  it('quantities keep up to six decimals without padding', () => {
    expect(fmtQty('927.239')).toBe('927.239');
    expect(fmtQty('1000')).toBe('1,000');
    expect(fmtQty('0.123456789')).toBe('0.123457');
  });
  it('compact notation for market cap and volume', () => {
    expect(fmtCompactMoney('5765683852696')).toBe('$5.77T');
    expect(fmtCompactNumber('107921380')).toBe('107.92M');
  });
  it('tone classes', () => {
    expect([tone('1'), tone('-1'), tone('0'), tone(null)]).toEqual(['gain', 'loss', '', 'muted']);
  });
  it('ageLabel: just now under a minute, then minutes, hours, days', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    const ago = (sec: number) => ageLabel(new Date(now - sec * 1000).toISOString(), now);
    expect(ago(0)).toBe('just now');
    expect(ago(59)).toBe('just now');
    expect(ago(60)).toBe('1 min ago');
    expect(ago(12 * 60 + 30)).toBe('12 min ago');
    expect(ago(59 * 60 + 59)).toBe('59 min ago');
    expect(ago(3600)).toBe('1 h ago');
    expect(ago(23 * 3600 + 3599)).toBe('23 h ago');
    expect(ago(48 * 3600)).toBe('2 d ago');
  });
  it('ageLabel: a time ahead of the browser clock (skew) reads as just now; garbage does not print NaN', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    expect(ageLabel('2026-10-07T12:05:00Z', now)).toBe('just now');
    expect(ageLabel('not a date', now)).toBe('recently');
  });
});
