import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '../../core/auth.service';
import { Users } from './users';

const ME = { id: 1, username: 'admin', is_admin: true, is_active: true };
const ALICE = { id: 2, username: 'alice', is_admin: false, is_active: true };

async function mount(list: unknown[] = [ME, ALICE]) {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  (TestBed.inject(AuthService) as unknown as { _user: { set(u: unknown): void } })._user.set(ME);
  const http = TestBed.inject(HttpTestingController);
  const f = TestBed.createComponent(Users);
  f.detectChanges();
  http.expectOne('/api/users').flush(list);
  await f.whenStable();
  f.detectChanges();
  return { f, http, el: f.nativeElement as HTMLElement, c: f.componentInstance as never as Record<string, any> };
}

const buttons = (li: Element) => Array.from(li.querySelectorAll('button')).map((b) => b.textContent?.trim());

describe('Users page', () => {
  it('lists users and hides self-destructive actions on your own row', async () => {
    const { el } = await mount();
    const [mine, alice] = Array.from(el.querySelectorAll('li'));
    expect(mine.textContent).toContain('you');
    expect(buttons(mine)).toEqual(['Reset password']);
    expect(buttons(alice)).toEqual(['Reset password', 'Make admin', 'Deactivate']);
  });

  it('creates a user and shows a notice', async () => {
    const { f, http, el, c } = await mount([ME]);
    c['form'].setValue({ username: 'bob', password: 'bob-password-1', is_admin: true });
    const p = c['add']();
    const req = http.expectOne('/api/users');
    expect(req.request.body).toEqual({ username: 'bob', password: 'bob-password-1', is_admin: true });
    req.flush({ id: 3, username: 'bob', is_admin: true, is_active: true });
    await p; f.detectChanges();
    expect(el.querySelectorAll('li').length).toBe(2);
    expect(el.querySelector('[role=status]')?.textContent).toContain('Created bob');
    expect(c['form'].getRawValue().password).toBe('');
  });

  it('shows the server error for a duplicate username', async () => {
    const { f, http, el, c } = await mount();
    c['form'].setValue({ username: 'alice', password: 'whatever-long-1', is_admin: false });
    const p = c['add']();
    http.expectOne('/api/users').flush({ detail: 'Username already exists' }, { status: 409, statusText: 'Conflict' });
    await p; f.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Username already exists');
  });

  it('deactivates a user and relabels the button', async () => {
    const { f, http, el, c } = await mount();
    const p = c['patch'](ALICE, { is_active: false });
    const req = http.expectOne('/api/users/2');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ is_active: false });
    req.flush({ ...ALICE, is_active: false });
    await p; f.detectChanges();
    const alice = el.querySelectorAll('li')[1];
    expect(alice.textContent).toContain('deactivated');
    expect(buttons(alice)).toContain('Activate');
  });

  it('rejects a short reset password client-side without calling the API', async () => {
    const { http, c, f, el } = await mount();
    await c['resetPassword'](ALICE, 'short');
    http.expectNone('/api/users/2');
    f.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('at least 10');
  });

  it('resets a password and tells the admin sessions were ended', async () => {
    const { http, c, f, el } = await mount();
    const p = c['resetPassword'](ALICE, 'a-brand-new-password');
    const req = http.expectOne('/api/users/2');
    expect(req.request.body).toEqual({ password: 'a-brand-new-password' });
    req.flush({ ...ALICE });
    await p; f.detectChanges();
    expect(el.querySelector('[role=status]')?.textContent).toContain('signed out');
  });

  it('flags created and reset users as needing a new password', async () => {
    const { f, http, el, c } = await mount([ME, { ...ALICE, must_change_password: true }]);
    expect(el.querySelectorAll('li')[1].textContent).toContain('must set a new password');
    const p = c['resetPassword'](ALICE, 'temporary-password');
    http.expectOne('/api/users/2').flush({ ...ALICE, must_change_password: true });
    await p; f.detectChanges();
    expect(el.querySelector('[role=status]')?.textContent).toContain('must set a new password');
  });

  it('rejects a bad username before submitting', async () => {
    const { f, c } = await mount([ME]);
    for (const bad of ['ab', 'has space', 'x'.repeat(65), 'bad!']) {
      c['form'].controls.username.setValue(bad);
      c['form'].controls.username.markAsDirty();
      c['form'].controls.password.setValue('long-enough-pw');
      expect(c['form'].invalid, bad).toBe(true);
    }
    c['form'].controls.username.setValue('Good.Name-1');
    expect(c['form'].valid).toBe(true);
    f.detectChanges();
  });

  it('shows the friendly username message for a 422 on the username field', async () => {
    const { f, http, el, c } = await mount([ME]);
    c['form'].setValue({ username: 'okname', password: 'long-enough-pw', is_admin: false });
    const p = c['add']();
    http.expectOne('/api/users').flush(
      { detail: [{ loc: ['body', 'username'], msg: "String should match pattern '^[a-z0-9_.-]{3,64}$'" }] },
      { status: 422, statusText: 'Unprocessable' },
    );
    await p; f.detectChanges();
    const msg = el.querySelector('[role=alert]')?.textContent ?? '';
    expect(msg).toContain('3-64 letters, digits');
    expect(msg).not.toContain('pattern');
  });
});
