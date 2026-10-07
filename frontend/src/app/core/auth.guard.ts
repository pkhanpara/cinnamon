import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ensureLoaded();
  if (auth.isAuthenticated()) return true;
  return router.parseUrl((await auth.setupRequired()) ? '/setup' : '/login');
};

/** For /login and /setup: signed-in users go to the app instead. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router); // inject() must run before the first await
  await auth.ensureLoaded();
  return auth.isAuthenticated() ? router.parseUrl('/holdings') : true;
};

/** Admin-only routes. Non-admins are sent to /accounts (the API enforces this too). */
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ensureLoaded();
  if (!auth.isAuthenticated()) return router.parseUrl('/login');
  return auth.user()?.is_admin ? true : router.parseUrl('/holdings');
};
