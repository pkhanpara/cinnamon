import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from './auth.service';
import { adminGuard, authGuard, guestGuard } from './auth.guard';
import { authInterceptor } from './auth.interceptor';

const USER = { id: 1, username: 'a', is_admin: false, is_active: true };

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      provideRouter([]),
    ],
  });
  return { http: TestBed.inject(HttpTestingController), auth: TestBed.inject(AuthService) };
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
    http.expectOne('/api/auth/me').flush({ detail: 'x' }, { status: 401, statusText: 'Unauthorized' });
    await p;
    expect(auth.isAuthenticated()).toBe(false);
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
  it('authGuard sends signed-out users to /setup on first run', async () => {
    const { http } = setup();
    const p = TestBed.runInInjectionContext(() => authGuard({} as never, {} as never)) as Promise<unknown>;
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    await Promise.resolve(); await Promise.resolve();
    http.expectOne('/api/auth/status').flush({ setup_required: true });
    expect(String(await p)).toBe('/setup');
  });

  it('authGuard sends signed-out users to /login otherwise', async () => {
    const { http } = setup();
    const p = TestBed.runInInjectionContext(() => authGuard({} as never, {} as never)) as Promise<unknown>;
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    await Promise.resolve(); await Promise.resolve();
    http.expectOne('/api/auth/status').flush({ setup_required: false });
    expect(String(await p)).toBe('/login');
  });

  it('guestGuard redirects signed-in users to /accounts', async () => {
    const { http } = setup();
    const p = TestBed.runInInjectionContext(() => guestGuard({} as never, {} as never)) as Promise<unknown>;
    http.expectOne('/api/auth/me').flush(USER);
    expect(String(await p)).toBe('/accounts');
  });
});

describe('adminGuard', () => {
  const run = (user: unknown) => {
    const { http } = setup();
    const p = TestBed.runInInjectionContext(() => adminGuard({} as never, {} as never)) as Promise<unknown>;
    if (user) http.expectOne('/api/auth/me').flush(user);
    else http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    return p;
  };

  it('allows admins', async () => expect(await run({ ...USER, is_admin: true })).toBe(true));
  it('sends non-admins to /accounts', async () => expect(String(await run(USER))).toBe('/accounts'));
  it('sends signed-out users to /login', async () => expect(String(await run(null))).toBe('/login'));
});

describe('authInterceptor', () => {
  it('401 on a normal call clears auth and goes to /login', async () => {
    const { http, auth } = setup();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const p = auth.login('a', 'pw'); http.expectOne('/api/auth/login').flush(USER); await p;
    TestBed.inject(HttpClient).get('/api/accounts').subscribe({ error: () => undefined });
    http.expectOne('/api/accounts').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.user()).toBeNull();
    expect(nav).toHaveBeenCalledWith('/login');
  });

  it('401 from /api/auth/* does not redirect (wrong password)', () => {
    const { http } = setup();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    TestBed.inject(HttpClient).post('/api/auth/login', {}).subscribe({ error: () => undefined });
    http.expectOne('/api/auth/login').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(nav).not.toHaveBeenCalled();
  });
});
