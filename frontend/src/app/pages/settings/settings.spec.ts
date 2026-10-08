import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { Settings } from './settings';

function links(user: object): string[] {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  (TestBed.inject(AuthService) as unknown as { _user: { set(u: unknown): void } })._user.set(user);
  const f = TestBed.createComponent(Settings);
  f.detectChanges();
  return Array.from((f.nativeElement as HTMLElement).querySelectorAll('nav a')).map((a) =>
    a.textContent!.trim(),
  );
}
const base = { id: 1, username: 'u', is_active: true };

describe('Settings shell', () => {
  it('admins see Accounts, User setup and Change password', () => {
    expect(links({ ...base, is_admin: true, must_change_password: false })).toEqual([
      'Accounts',
      'User setup',
      'Change password',
    ]);
  });
  it('regular users do not see User setup', () => {
    expect(links({ ...base, is_admin: false, must_change_password: false })).toEqual([
      'Accounts',
      'Change password',
    ]);
  });
  it('during a forced password change only Change password is offered', () => {
    expect(links({ ...base, is_admin: true, must_change_password: true })).toEqual([
      'Change password',
    ]);
  });
});
