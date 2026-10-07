import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { Login } from './login';

function mount() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  const f = TestBed.createComponent(Login);
  f.detectChanges();
  return { f, http: TestBed.inject(HttpTestingController), el: f.nativeElement as HTMLElement };
}

describe('Login page', () => {
  it('disables submit until both fields are filled', () => {
    const { f, el } = mount();
    const btn = el.querySelector('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    f.componentInstance['form'].setValue({ username: 'a', password: 'b' });
    f.detectChanges();
    expect(btn.disabled).toBe(false);
  });

  it('navigates to /holdings on success', async () => {
    const { f, http } = mount();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    f.componentInstance['form'].setValue({ username: 'a', password: 'b' });
    const p = f.componentInstance['submit']();
    http.expectOne('/api/auth/login').flush({ id: 1, username: 'a', is_admin: false, is_active: true });
    await p;
    expect(nav).toHaveBeenCalledWith('/holdings');
  });

  it('shows an error on bad credentials and stays put', async () => {
    const { f, http, el } = mount();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    f.componentInstance['form'].setValue({ username: 'a', password: 'wrong' });
    const p = f.componentInstance['submit']();
    http.expectOne('/api/auth/login').flush(
      { detail: 'Invalid username or password' }, { status: 401, statusText: 'Unauthorized' });
    await p; f.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Invalid username or password');
    expect(nav).not.toHaveBeenCalled();
  });
});
