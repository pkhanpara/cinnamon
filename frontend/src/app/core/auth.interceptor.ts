import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { CHANGE_PASSWORD } from './auth.guard';

/** Matches the backend's PASSWORD_CHANGE_REQUIRED detail. */
const PASSWORD_CHANGE_REQUIRED = 'Password change required';

/**
 * - 401 on a normal API call: the session expired, drop state and go to /login.
 * - 403 "Password change required": the account still has the default password, go change it.
 * Auth endpoints are exempt (a 401 from /login is just "wrong password").
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && !req.url.startsWith('/api/auth/')) {
        if (err.status === 401) {
          auth.clear();
          router.navigateByUrl('/login');
        } else if (err.status === 403 && err.error?.detail === PASSWORD_CHANGE_REQUIRED) {
          auth.markPasswordChangeRequired();
          router.navigateByUrl(CHANGE_PASSWORD);
        }
      }
      return throwError(() => err);
    }),
  );
};
