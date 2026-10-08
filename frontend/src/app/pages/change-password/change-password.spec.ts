import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ChangePassword } from './change-password';

const user = (pending: boolean) => ({
  id: 1,
  username: 'admin',
  is_admin: true,
  is_active: true,
  must_change_password: pending,
});

function mount(pending: boolean) {
  TestBed.resetTestingModule(); // called twice in one test
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  (TestBed.inject(AuthService) as unknown as { _user: { set(u: unknown): void } })._user.set(
    user(pending),
  );
  const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  const f = TestBed.createComponent(ChangePassword);
  f.detectChanges();
  const c = f.componentInstance as never as Record<string, any>;
  const el = f.nativeElement as HTMLElement;
  const fill = (current: string, next: string, confirm: string) => {
    c['form'].setValue({ current, next, confirm });
    f.detectChanges();
  };
  return { f, c, el, nav, fill, http: TestBed.inject(HttpTestingController) };
}

describe('Change password page', () => {
  it('explains why when the account still has the default password', () => {
    expect(mount(true).el.querySelector('[role=note]')?.textContent).toContain('default password');
    expect(mount(false).el.querySelector('[role=note]')).toBeNull();
  });

  it('blocks submit for short passwords and for mismatched confirmation', () => {
    const m = mount(false);
    const btn = m.el.querySelector('button[type=submit]') as HTMLButtonElement;
    m.fill('old', 'short', 'short');
    expect(btn.disabled).toBe(true);
    m.fill('old-password', 'long-enough-1', 'long-enough-2');
    expect(btn.disabled).toBe(true);
    m.c['form'].controls.confirm.markAsDirty();
    m.f.detectChanges();
    expect(m.el.querySelector('[role=alert]')?.textContent).toContain("don't match");
    m.fill('old-password', 'long-enough-1', 'long-enough-1');
    expect(btn.disabled).toBe(false);
  });

  it('a forced change sends the right body and then goes home', async () => {
    const m = mount(true);
    m.fill('$admin123456', 'my-new-password', 'my-new-password');
    const p = m.c['submit']();
    const req = m.http.expectOne('/api/auth/change-password');
    expect(req.request.body).toEqual({
      current_password: '$admin123456',
      new_password: 'my-new-password',
    });
    req.flush(user(false));
    await p;
    expect(m.nav).toHaveBeenCalledWith('/home');
  });

  it('a voluntary change stays on the page and says so', async () => {
    const m = mount(false);
    m.fill('old-password', 'my-new-password', 'my-new-password');
    const p = m.c['submit']();
    m.http.expectOne('/api/auth/change-password').flush(user(false));
    await p;
    m.f.detectChanges();
    expect(m.nav).not.toHaveBeenCalled();
    expect(m.el.querySelector('[role=status]')?.textContent).toContain('Password changed');
  });

  it('shows the server message for a wrong current password and does not navigate', async () => {
    const m = mount(true);
    m.fill('wrong', 'my-new-password', 'my-new-password');
    const p = m.c['submit']();
    m.http
      .expectOne('/api/auth/change-password')
      .flush(
        { detail: 'Current password is incorrect' },
        { status: 400, statusText: 'Bad Request' },
      );
    await p;
    m.f.detectChanges();
    expect(m.el.querySelector('[role=alert]')?.textContent).toContain(
      'Current password is incorrect',
    );
    expect(m.nav).not.toHaveBeenCalled();
    expect(m.el.querySelector('[role=note]')).not.toBeNull(); // still forced
  });
});
