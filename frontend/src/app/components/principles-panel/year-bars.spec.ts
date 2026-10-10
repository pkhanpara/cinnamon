import { TestBed } from '@angular/core/testing';
import { BarPoint } from '../../core/bar-chart';
import { YearBars } from './year-bars';

const pts = (...v: (string | null)[]): BarPoint[] =>
  v.map((value, i) => ({ label: String(2021 + i), value }));

function render(points: BarPoint[], title = 'Net income'): HTMLElement {
  const f = TestBed.createComponent(YearBars);
  f.componentRef.setInput('title', title);
  f.componentRef.setInput('points', points);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}
const texts = (el: Element, sel: string) =>
  [...el.querySelectorAll(sel)].map((t) => t.textContent?.trim());
const style = (el: Element | null) => (el as HTMLElement).style;

describe('YearBars', () => {
  it('a series with no values is a card with its title and "No data"', () => {
    const el = render(pts(null, null), 'Acquisitions');
    expect(el.querySelector('figure.chart-card .t')?.textContent).toBe('Acquisitions');
    expect(el.textContent).toContain('No data');
    expect(el.querySelector('.plot')).toBeNull();
    expect(el.querySelector('.unit')).toBeNull();
    expect(el.querySelector('.latest')).toBeNull();
  });

  it('one year: one bar, its value label and year', () => {
    const el = render(pts('2500000000'));
    expect(el.querySelectorAll('.bar.pos')).toHaveLength(1);
    expect(texts(el, '.val.above')).toEqual(['2.5']);
    expect(texts(el, '.years .yr')).toEqual(['2021']);
    expect(el.querySelector('.latest')?.textContent).toBe('2021: $2.5B');
    expect(el.querySelector('.unit')?.textContent).toBe('USD billions');
    expect(style(el.querySelector('.plot')).gridTemplateColumns).toBe('repeat(1, minmax(0, 1fr))');
  });

  it('all zero: baseline at the bottom, zero-height bars without the 1px minimum, labels 0', () => {
    const el = render(pts('0', '0'));
    expect(style(el.querySelector('.zero')).top).toBe('100%');
    const bars = [...el.querySelectorAll('.bar')];
    expect(bars.map((b) => style(b).height)).toEqual(['0%', '0%']);
    expect(bars.some((b) => b.classList.contains('nz'))).toBe(false);
    expect(texts(el, '.val')).toEqual(['0', '0']);
    expect(el.querySelector('.unit')?.textContent).toBe('USD');
  });

  it('mixed signs: positive bars rise from the zero line, negative ones hang below it', () => {
    const el = render(pts('300000000', '-100000000'));
    const plot = el.querySelector('.plot')!;
    expect(plot.classList.contains('has-neg')).toBe(true);
    expect(style(el.querySelector('.zero')).top).toBe('75%');
    const pos = el.querySelector('.bar.pos')!;
    expect([style(pos).bottom, style(pos).height]).toEqual(['25%', '75%']);
    const neg = el.querySelector('.bar.neg')!;
    expect([style(neg).top, style(neg).height]).toEqual(['75%', '25%']);
    expect(texts(el, '.val.above')).toEqual(['300']);
    expect(texts(el, '.val.below')).toEqual(['-100']);
    expect(style(el.querySelector('.val.above')).bottom).toBe('calc(100% + 3px)');
    expect(style(el.querySelector('.val.below')).top).toBe('calc(100% + 3px)');
    expect(el.querySelector('.unit')?.textContent).toBe('USD millions');
  });

  it('all positive: no extra room kept under the plot', () => {
    expect(render(pts('1', '2')).querySelector('.plot')!.classList.contains('has-neg')).toBe(false);
  });

  it('a null year keeps its slot with "n/a" at the zero line', () => {
    const el = render(pts('5000', null, '7000'));
    expect(el.querySelectorAll('.col')).toHaveLength(3);
    expect(el.querySelectorAll('.bar')).toHaveLength(2);
    expect(texts(el, '.col:nth-child(3) .na')).toEqual(['n/a']);
    expect((el.querySelectorAll('.col')[1] as HTMLElement).title).toBe('2022: no data');
    expect(texts(el, '.years .yr')).toEqual(['2021', '2022', '2023']);
    expect(el.querySelector('.plot')!.getAttribute('aria-label')).toBe(
      'Net income by fiscal year, oldest first: 2021 $5K, 2022 no data, 2023 $7K',
    );
    // The latest value skips the null.
    expect(el.querySelector('.latest')?.textContent).toBe('2023: $7K');
  });

  it('a tiny value next to a huge one still shows a bar and a signed label', () => {
    const el = render(pts('90000000000', '12000000', '-12000000'));
    const bars = el.querySelectorAll('.bar');
    expect(bars[1].classList.contains('nz')).toBe(true);
    expect(texts(el, '.val')).toEqual(['90', '<0.1', '-<0.1']);
  });

  it('every year keeps four digits, also with ten years', () => {
    const el = render(pts(...Array.from({ length: 10 }, (_, i) => String(i * 1e6))));
    expect(texts(el, '.years .yr')).toEqual(Array.from({ length: 10 }, (_, i) => String(2021 + i)));
  });
});
