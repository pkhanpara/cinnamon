import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { Import } from './import';

const ACCOUNT = { id: 7, platform: 'robinhood', nickname: 'Main', created_at: '', position_count: 0, last_import_at: null };
const CONNECTORS = [{ slug: 'snapshot', label: 'Positions snapshot (CSV)', description: 'symbol, quantity, cost_basis' }];
const ROW = { symbol: 'ORCL', name: 'Oracle', quantity: '40', cost_basis: '5200.00', market_value: '6800.00', price: '170', as_of: null };
const PREVIEW = {
  connector: 'snapshot', filename: 'a.csv', rows: [ROW], errors: [], warnings: [],
  current_position_count: 0, total_cost_basis: '5200.00', total_market_value: '6800.00',
};
const file = (name = 'a.csv') => new File(['symbol,quantity,cost_basis\nORCL,40,5200\n'], name, { type: 'text/csv' });

async function mount() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', '7']]) } } },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const f = TestBed.createComponent(Import);
  f.detectChanges();
  http.expectOne('/api/accounts').flush([ACCOUNT]);
  await f.whenStable();
  http.expectOne('/api/accounts/7/connectors').flush(CONNECTORS);
  await f.whenStable();
  f.detectChanges();
  const c = f.componentInstance as never as Record<string, any>;
  const el = f.nativeElement as HTMLElement;
  const btn = (text: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
  return { f, http, c, el, btn };
}

async function previewWith(m: Awaited<ReturnType<typeof mount>>, body: object, fl = file()) {
  m.c['file'].set(fl);
  const p = m.c['runPreview']();
  m.http.expectOne('/api/accounts/7/imports/preview').flush(body);
  await p;
  m.f.detectChanges();
}

describe('Import page', () => {
  it('loads the account and connectors, preview disabled without a file', async () => {
    const { el, btn } = await mount();
    expect(el.querySelector('h3')?.textContent).toContain('Main');
    expect(el.querySelector('select')?.textContent).toContain('Positions snapshot');
    expect(btn('Preview')?.disabled).toBe(true);
  });

  it('sends connector + file as multipart and shows the rows', async () => {
    const m = await mount();
    m.c['file'].set(file('rh.csv'));
    const p = m.c['runPreview']();
    const req = m.http.expectOne('/api/accounts/7/imports/preview');
    const body = req.request.body as FormData;
    expect(body.get('connector')).toBe('snapshot');
    expect((body.get('file') as File).name).toBe('rh.csv');
    req.flush(PREVIEW);
    await p; m.f.detectChanges();
    expect(m.el.querySelector('tbody')?.textContent).toContain('ORCL');
    expect(m.el.textContent).toContain('cost basis 5,200.00');
    expect(m.btn('Import')?.disabled).toBe(false);
  });

  it('lists errors with line numbers and blocks confirming', async () => {
    const m = await mount();
    await previewWith(m, { ...PREVIEW, rows: [], errors: [{ row: 3, message: 'quantity is not a number' }, { row: 0, message: 'Missing required column(s): symbol' }] });
    const alert = m.el.querySelector('[role=alert]')?.textContent ?? '';
    expect(alert).toContain('Line 3: quantity is not a number');
    expect(alert).toContain('File: Missing required column(s): symbol');
    expect(m.btn('Import')?.disabled).toBe(true);
  });

  it('blocks confirming when a file with errors still has some valid rows', async () => {
    const m = await mount();
    await previewWith(m, { ...PREVIEW, errors: [{ row: 3, message: 'bad' }] });
    expect(m.btn('Import')?.disabled).toBe(true);
  });

  it('shows warnings and a replace label on the confirm button', async () => {
    const m = await mount();
    await previewWith(m, { ...PREVIEW, current_position_count: 17, warnings: ["Importing will replace this account's 17 current position(s)."] });
    expect(m.el.querySelector('[role=note]')?.textContent).toContain('replace');
    expect(m.btn('Replace 17 position(s)')).toBeTruthy();
  });

  it('commits the same file and shows the result', async () => {
    const m = await mount();
    const fl = file('rh.csv');
    await previewWith(m, PREVIEW, fl);
    const p = m.c['confirm']();
    const req = m.http.expectOne('/api/accounts/7/imports');
    const sent = (req.request.body as FormData).get('file') as File;
    expect(sent.name).toBe(fl.name);
    expect(sent.size).toBe(fl.size);
    req.flush({ id: 1, connector: 'snapshot', filename: 'rh.csv', row_count: 1, created_at: '' });
    await p; m.f.detectChanges();
    expect(m.el.querySelector('[role=status]')?.textContent).toContain('Imported 1 position(s) from rh.csv');
  });

  it('keeps the preview and shows the server message when the commit fails', async () => {
    const m = await mount();
    await previewWith(m, PREVIEW);
    const p = m.c['confirm']();
    m.http.expectOne('/api/accounts/7/imports').flush({ detail: 'File has 1 error(s); nothing was imported.' }, { status: 422, statusText: 'Unprocessable' });
    await p; m.f.detectChanges();
    expect(m.el.querySelector('[role=alert]')?.textContent).toContain('nothing was imported');
    expect(m.c['result']()).toBeNull();
  });

  it('discards a stale preview when a different file is chosen', async () => {
    const m = await mount();
    await previewWith(m, PREVIEW);
    expect(m.c['preview']()).not.toBeNull();
    m.c['onFile']({ item: () => file('other.csv') } as unknown as FileList);
    expect(m.c['preview']()).toBeNull();
  });

  it('shows the server message for an oversized file', async () => {
    const m = await mount();
    m.c['file'].set(file());
    const p = m.c['runPreview']();
    m.http.expectOne('/api/accounts/7/imports/preview').flush({ detail: 'File is larger than 2 MB' }, { status: 413, statusText: 'Too Large' });
    await p; m.f.detectChanges();
    expect(m.el.querySelector('[role=alert]')?.textContent).toContain('larger than 2 MB');
    expect(m.c['preview']()).toBeNull();
  });
});
