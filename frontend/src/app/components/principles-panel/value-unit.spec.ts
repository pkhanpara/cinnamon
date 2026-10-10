import { chartUnit, fmtInUnit } from './value-unit';

describe('chartUnit', () => {
  it('picks the unit from the largest absolute value', () => {
    expect(chartUnit(['2500000000000']).label).toBe('USD trillions');
    expect(chartUnit(['400000000', '-1500000000']).label).toBe('USD billions');
    expect(chartUnit(['-12000000', '5']).label).toBe('USD millions');
    expect(chartUnit(['999999', '1000']).label).toBe('USD thousands');
    expect(chartUnit(['999.99']).label).toBe('USD');
  });

  it('ignores nulls; all null or all zero gives plain dollars', () => {
    expect(chartUnit([null, '3000000000', null])).toEqual({ div: 1e9, label: 'USD billions' });
    expect(chartUnit([null, null])).toEqual({ div: 1, label: 'USD' });
    expect(chartUnit(['0', '0'])).toEqual({ div: 1, label: 'USD' });
    expect(chartUnit([])).toEqual({ div: 1, label: 'USD' });
  });
});

describe('fmtInUnit', () => {
  const b = chartUnit(['1000000000']);

  it('prints one decimal below 10, whole numbers from 10', () => {
    expect(fmtInUnit('1500000000', b)).toBe('1.5');
    expect(fmtInUnit('-400000000', b)).toBe('-0.4');
    expect(fmtInUnit('1000000000', b)).toBe('1.0');
    expect(fmtInUnit('9940000000', b)).toBe('9.9');
    expect(fmtInUnit('9960000000', b)).toBe('10');
    expect(fmtInUnit('-50000000000', b)).toBe('-50');
    expect(fmtInUnit('27400000000', b)).toBe('27');
    expect(fmtInUnit('123400000000', b)).toBe('123');
    expect(fmtInUnit('-250600000000', b)).toBe('-251');
  });

  it('keeps the sign of a value too small for the unit, and prints exact zero as 0', () => {
    expect(fmtInUnit('12000000', b)).toBe('<0.1');
    expect(fmtInUnit('-12000000', b)).toBe('-<0.1');
    expect(fmtInUnit('0', b)).toBe('0');
    expect(fmtInUnit('0.00', b)).toBe('0');
  });

  it('groups thousands past the largest unit', () => {
    expect(fmtInUnit('1234000000000000', chartUnit(['1234000000000000']))).toBe('1,234');
  });
});
