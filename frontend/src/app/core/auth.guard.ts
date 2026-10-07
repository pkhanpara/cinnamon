import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const HOME = '/home';
export const CHANGE_PASSWORD = '/settings/change-password';

// inject() must run before the first await, so every guard grabs its dependencies up front.

/** Signed in, and past the forced password change. Everything in the app uses this. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ensureLoaded();
  if (!auth.isAuthenticated()) return router.parseUrl('/login');
  return auth.mustChangePassword() ? router.parseUrl(CHANGE_PASSWORD) : true;
};

/** Signed in, even while a password change is pending (the change-password page itself). */
export const sessionGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ensureLoaded();
  return auth.isAuthenticated() ? true : router.parseUrl('/login');
};

/** For /login: signed-in users go on to the app (or to the forced password change). */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ensureLoaded();
  if (!auth.isAuthenticated()) return true;
  return router.parseUrl(auth.mustChangePassword() ? CHANGE_PASSWORD : HOME);
};

/** Admin-only routes. Non-admins are sent home (the API enforces this too). */
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ensureLoaded();
  if (!auth.isAuthenticated()) return router.parseUrl('/login');
  if (auth.mustChangePassword()) return router.parseUrl(CHANGE_PASSWORD);
  return auth.user()?.is_admin ? true : router.parseUrl(HOME);
};
