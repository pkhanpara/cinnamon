import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Accounts } from './accounts';

const A = { id: 1, platform: 'robinhood', nickname: 'Main', created_at: '2026-01-01T00:00:00', position_count: 0, last_import_at: null };

async function mount(initial: unknown[]) {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
  const http = TestBed.inject(HttpTestingController);
  const f = TestBed.createComponent(Accounts);
  f.detectChanges();
  http.expectOne('/api/accounts').flush(initial);
  await f.whenStable();
  f.detectChanges();
  return { f, http, el: f.nativeElement as HTMLElement };
}

describe('Accounts page', () => {
  it('shows an empty state', async () => {
    const { el } = await mount([]);
    expect(el.textContent).toContain('No accounts yet');
  });

  it('lists accounts', async () => {
    const { el } = await mount([A]);
    expect(el.querySelector('li')?.textContent).toContain('Main');
    expect(el.querySelector('li')?.textContent).toContain('robinhood');
  });

  it('shows import status and links to the import page', async () => {
    const { el } = await mount([{ ...A, position_count: 17, last_import_at: '2026-10-07T10:00:00Z' }, { ...A, id: 2, nickname: 'New' }]);
    const [imported, empty] = Array.from(el.querySelectorAll('li'));
    expect(imported.textContent).toContain('17 position(s), imported');
    expect(empty.textContent).toContain('no holdings yet');
    expect(imported.querySelector('a')?.getAttribute('href')).toBe('/settings/accounts/1/import');
  });

  it('adds an account and resets the form', async () => {
    const { f, http, el } = await mount([]);
    f.componentInstance['form'].setValue({ platform: 'm1', nickname: 'Roth' });
    const p = f.componentInstance['add']();
    const req = http.expectOne('/api/accounts');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ platform: 'm1', nickname: 'Roth' });
    req.flush({ ...A, id: 2, platform: 'm1', nickname: 'Roth' });
    await p; f.detectChanges();
    expect(el.querySelectorAll('li').length).toBe(1);
    expect(f.componentInstance['form'].getRawValue()).toEqual({ platform: '', nickname: '' });
  });

  it('shows the server message on a duplicate nickname', async () => {
    const { f, http, el } = await mount([A]);
    f.componentInstance['form'].setValue({ platform: 'robinhood', nickname: 'Main' });
    const p = f.componentInstance['add']();
    http.expectOne('/api/accounts').flush(
      { detail: 'You already have an account with that nickname' }, { status: 409, statusText: 'Conflict' });
    await p; f.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('already have an account');
    expect(el.querySelectorAll('li').length).toBe(1);
  });

  it('deletes only after confirmation', async () => {
    const { f, http, el } = await mount([A]);
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    await f.componentInstance['remove'](A);
    http.expectNone('/api/accounts/1');
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    const p = f.componentInstance['remove'](A);
    http.expectOne('/api/accounts/1').flush(null, { status: 204, statusText: 'No Content' });
    await p; f.detectChanges();
    expect(el.querySelectorAll('li').length).toBe(0);
  });

  it('renames an account', async () => {
    const { f, http } = await mount([A]);
    const p = f.componentInstance['saveRename'](A, 'Roth');
    const req = http.expectOne('/api/accounts/1');
    expect(req.request.body).toEqual({ nickname: 'Roth' });
    req.flush({ ...A, nickname: 'Roth' });
    await p;
    expect(f.componentInstance['accounts']()[0].nickname).toBe('Roth');
  });
});
