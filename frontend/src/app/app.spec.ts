import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { AuthService } from './core/auth.service';

describe('App shell', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }),
  );

  it('shows only the title when signed out', async () => {
    const f = TestBed.createComponent(App);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Cinnamon');
    expect(el.querySelector('button')).toBeNull();
  });

  it('shows the user and Sign out when signed in', async () => {
    const auth = TestBed.inject(AuthService);
    (auth as unknown as { _user: { set(u: unknown): void } })._user.set({
      id: 1,
      username: 'poojan',
      is_admin: true,
      is_active: true,
      must_change_password: false,
    });
    const f = TestBed.createComponent(App);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.who')?.textContent).toContain('poojan');
    expect(el.querySelector('.who')?.textContent).toContain('admin');
    // Sign out lives in the user menu, which renders into the CDK overlay on open.
    (el.querySelector('button.who') as HTMLButtonElement).click();
    await f.whenStable();
    const items = Array.from(document.querySelectorAll('[role=menuitem]')).map((i) =>
      i.textContent?.trim(),
    );
    expect(items).toEqual(['Change password', 'Sign out']);
    expect(Array.from(el.querySelectorAll('nav a')).map((a) => a.textContent?.trim())).toEqual([
      'Home',
      'Watchlists',
      'Settings',
    ]);
    expect(el.querySelector('input[role=combobox]')).not.toBeNull(); // symbol search
  });

  it('hides symbol search while a password change is pending (the API would refuse it anyway)', async () => {
    const auth = TestBed.inject(AuthService);
    (auth as unknown as { _user: { set(u: unknown): void } })._user.set({
      id: 1,
      username: 'admin',
      is_admin: true,
      is_active: true,
      must_change_password: true,
    });
    const f = TestBed.createComponent(App);
    await f.whenStable();
    expect((f.nativeElement as HTMLElement).querySelector('input[role=combobox]')).toBeNull();
  });

  it('shows no search box when signed out', async () => {
    const f = TestBed.createComponent(App);
    await f.whenStable();
    expect((f.nativeElement as HTMLElement).querySelector('input[role=combobox]')).toBeNull();
  });
});
