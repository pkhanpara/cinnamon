import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HistoryResponse } from '../../core/models';
import { CHART_FACTORY, ChartHandle } from './chart-factory';
import { PriceChart } from './price-chart';

const hist = (closes: string[], intraday = false): HistoryResponse => ({
  symbol: 'NVDA', range: intraday ? '1d' : '1m', intraday, stale: false, as_of: '',
  bars: closes.map((c, i) => ({ t: 1791316800 + i * 300, d: `2026-10-0${i + 1}`, o: c, h: c, l: c, c, v: 1 })),
});

function setup() {
  const handle = { setData: vi.fn(), destroy: vi.fn() } satisfies ChartHandle;
  const created = vi.fn(async (_el: HTMLElement) => handle);
  TestBed.configureTestingModule({ providers: [{ provide: CHART_FACTORY, useValue: created }] });

  @Component({ imports: [PriceChart], template: `<app-price-chart [history]="h()" />` })
  class Host { h = signal(hist(['10', '12'])); }

  const f = TestBed.createComponent(Host);
  f.detectChanges();
  return { f, handle, created, host: f.componentInstance };
}
const flush = () => new Promise((r) => setTimeout(r));

describe('PriceChart', () => {
  it('creates one chart in its container and feeds it the points', async () => {
    const { handle, created, f } = setup();
    await flush();
    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0][0]).toBeInstanceOf(HTMLElement);
    expect(handle.setData).toHaveBeenCalledWith(
      [{ time: '2026-10-01', value: 10 }, { time: '2026-10-02', value: 12 }],
      { intraday: false, up: true },
    );
    expect((f.nativeElement as HTMLElement).querySelector('[role=img]')?.getAttribute('aria-label')).toContain('NVDA, 1m, from 10 to 12');
  });

  it('reuses the chart when the data changes and flips the colour flag for a falling period', async () => {
    const { handle, created, f, host } = setup();
    await flush();
    host.h.set(hist(['12', '9'], true));
    f.detectChanges(); await flush();
    expect(created).toHaveBeenCalledTimes(1);
    expect(handle.setData).toHaveBeenLastCalledWith(
      [{ time: 1791316800, value: 12 }, { time: 1791317100, value: 9 }],
      { intraday: true, up: false },
    );
  });

  it('colours a 1-day chart against the previous close, other ranges first-to-last', async () => {
    const handle = { setData: vi.fn(), destroy: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: CHART_FACTORY, useValue: async () => handle }] });
    @Component({ imports: [PriceChart], template: `<app-price-chart [history]="h()" [baseline]="238.9" />` })
    class Host { h = signal<HistoryResponse>({ ...hist(['241', '239.17'], true), range: '1d' }); }
    const f = TestBed.createComponent(Host);
    f.detectChanges(); await flush();
    expect(handle.setData).toHaveBeenLastCalledWith(expect.anything(), { intraday: true, up: true }); // 239.17 >= 238.9
    f.componentInstance.h.set({ ...hist(['241', '239.17'], true), range: '5d' });
    f.detectChanges(); await flush();
    expect(handle.setData).toHaveBeenLastCalledWith(expect.anything(), { intraday: true, up: false }); // 5d ignores the baseline
  });

  it('destroys the chart with the component', async () => {
    const { handle, f } = setup();
    await flush();
    f.destroy(); await flush();
    expect(handle.destroy).toHaveBeenCalledTimes(1);
  });

  it('never feeds or leaks a chart that resolves after the component is gone', async () => {
    let resolve!: (h: ChartHandle) => void;
    const late: ChartHandle = { setData: vi.fn(), destroy: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: CHART_FACTORY, useValue: () => new Promise<ChartHandle>((r) => (resolve = r)) }] });
    @Component({ imports: [PriceChart], template: `<app-price-chart [history]="h" />` })
    class Host { h = hist(['1', '2']); }
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    f.destroy();
    resolve(late); await flush();
    expect(late.setData).not.toHaveBeenCalled();
    expect(late.destroy).toHaveBeenCalledTimes(1);
  });
});
