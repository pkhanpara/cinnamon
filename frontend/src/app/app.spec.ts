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
    })
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
      id: 1, username: 'poojan', is_admin: true, is_active: true,
    });
    const f = TestBed.createComponent(App);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.who')?.textContent).toContain('poojan');
    expect(el.querySelector('.who')?.textContent).toContain('admin');
    expect(el.querySelector('button')?.textContent).toContain('Sign out');
  });
});
