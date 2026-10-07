import { fmtCompactMoney, fmtCompactNumber, fmtMoney, fmtPct, fmtQty, fmtSigned, tone } from './format';

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
});
