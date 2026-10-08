import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from './auth.service';
import { adminGuard, authGuard, guestGuard, sessionGuard } from './auth.guard';
import { authInterceptor } from './auth.interceptor';

const USER = {
  id: 1,
  username: 'a',
  is_admin: false,
  is_active: true,
  must_change_password: false,
};
const ADMIN = { ...USER, is_admin: true };
const PENDING = { ...ADMIN, must_change_password: true };
const UNAUTH = { status: 401, statusText: 'Unauthorized' };

function setup() {
  TestBed.resetTestingModule(); // helpers are called several times per test
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      provideRouter([]),
    ],
  });
  return { http: TestBed.inject(HttpTestingController), auth: TestBed.inject(AuthService) };
}

/** Run a guard with /api/auth/me answering `me` (null = 401); returns the guard's verdict as a string. */
async function verdict(guard: typeof authGuard, me: object | null): Promise<string> {
  const { http } = setup();
  const p = TestBed.runInInjectionContext(() =>
    guard({} as never, {} as never),
  ) as Promise<unknown>;
  const req = http.expectOne('/api/auth/me');
  if (me) req.flush(me);
  else req.flush({}, UNAUTH);
  return String(await p);
}

describe('AuthService', () => {
  it('ensureLoaded fetches /me once and caches', async () => {
    const { http, auth } = setup();
    const p = auth.ensureLoaded();
    http.expectOne('/api/auth/me').flush(USER);
    await p;
    await auth.ensureLoaded();
    http.expectNone('/api/auth/me');
    expect(auth.user()?.username).toBe('a');
  });

  it('ensureLoaded treats 401 as signed out', async () => {
    const { http, auth } = setup();
    const p = auth.ensureLoaded();
    http.expectOne('/api/auth/me').flush({ detail: 'x' }, UNAUTH);
    await p;
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('login returns the user and exposes the pending-password flag', async () => {
    const { http, auth } = setup();
    const p = auth.login('admin', 'pw');
    http.expectOne('/api/auth/login').flush(PENDING);
    expect((await p).must_change_password).toBe(true);
    expect(auth.mustChangePassword()).toBe(true);
  });

  it('changePassword posts snake_case fields and clears the flag from the response', async () => {
    const { http, auth } = setup();
    const l = auth.login('admin', 'pw');
    http.expectOne('/api/auth/login').flush(PENDING);
    await l;
    const p = auth.changePassword('old-password', 'new-password-1');
    const req = http.expectOne('/api/auth/change-password');
    expect(req.request.body).toEqual({
      current_password: 'old-password',
      new_password: 'new-password-1',
    });
    req.flush(ADMIN);
    await p;
    expect(auth.mustChangePassword()).toBe(false);
  });

  it('logout clears the user even if the request fails', async () => {
    const { http, auth } = setup();
    const p = auth.login('a', 'pw');
    http.expectOne('/api/auth/login').flush(USER);
    await p;
    const out = auth.logout().catch(() => undefined);
    http.expectOne('/api/auth/logout').flush(null, { status: 500, statusText: 'err' });
    await out;
    expect(auth.user()).toBeNull();
  });
});

describe('guards', () => {
  it('authGuard: signed out -> /login (there is no first-run setup page any more)', async () => {
    expect(await verdict(authGuard, null)).toBe('/login');
  });
  it('authGuard: pending password change -> /settings/change-password', async () => {
    expect(await verdict(authGuard, PENDING)).toBe('/settings/change-password');
  });
  it('authGuard: allows a normal user', async () => {
    expect(await verdict(authGuard, USER)).toBe('true');
  });

  it('sessionGuard: allows a pending user (so they can reach change-password), blocks anonymous', async () => {
    expect(await verdict(sessionGuard, PENDING)).toBe('true');
    expect(await verdict(sessionGuard, null)).toBe('/login');
  });

  it('guestGuard: lets anonymous through, sends users home or to the forced change', async () => {
    expect(await verdict(guestGuard, null)).toBe('true');
    expect(await verdict(guestGuard, USER)).toBe('/home');
    expect(await verdict(guestGuard, PENDING)).toBe('/settings/change-password');
  });

  it('adminGuard: admins pass; others go home; pending goes to change-password; anonymous to /login', async () => {
    expect(await verdict(adminGuard, ADMIN)).toBe('true');
    expect(await verdict(adminGuard, USER)).toBe('/home');
    expect(await verdict(adminGuard, PENDING)).toBe('/settings/change-password');
    expect(await verdict(adminGuard, null)).toBe('/login');
  });
});

describe('authInterceptor', () => {
  it('401 on a normal call clears auth and goes to /login', async () => {
    const { http, auth } = setup();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const p = auth.login('a', 'pw');
    http.expectOne('/api/auth/login').flush(USER);
    await p;
    TestBed.inject(HttpClient)
      .get('/api/accounts')
      .subscribe({ error: () => undefined });
    http.expectOne('/api/accounts').flush({}, UNAUTH);
    expect(auth.user()).toBeNull();
    expect(nav).toHaveBeenCalledWith('/login');
  });

  it('401 from /api/auth/* does not redirect (wrong password)', () => {
    const { http } = setup();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    TestBed.inject(HttpClient)
      .post('/api/auth/login', {})
      .subscribe({ error: () => undefined });
    http.expectOne('/api/auth/login').flush({}, UNAUTH);
    expect(nav).not.toHaveBeenCalled();
  });

  it('403 "Password change required" keeps the session and sends the user to change it', async () => {
    const { http, auth } = setup();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const p = auth.login('a', 'pw');
    http.expectOne('/api/auth/login').flush(USER);
    await p;
    TestBed.inject(HttpClient)
      .get('/api/accounts')
      .subscribe({ error: () => undefined });
    http
      .expectOne('/api/accounts')
      .flush({ detail: 'Password change required' }, { status: 403, statusText: 'Forbidden' });
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.mustChangePassword()).toBe(true);
    expect(nav).toHaveBeenCalledWith('/settings/change-password');
  });

  it('other 403s (e.g. admin only) are left to the page', () => {
    const { http } = setup();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    TestBed.inject(HttpClient)
      .get('/api/users')
      .subscribe({ error: () => undefined });
    http
      .expectOne('/api/users')
      .flush({ detail: 'Admin only' }, { status: 403, statusText: 'Forbidden' });
    expect(nav).not.toHaveBeenCalled();
  });
});
