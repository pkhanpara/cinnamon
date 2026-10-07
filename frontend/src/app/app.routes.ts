import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard, sessionGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./pages/login/login').then((m) => m.Login) },
  { path: 'home', canActivate: [authGuard], loadComponent: () => import('./pages/holdings/holdings').then((m) => m.Holdings) },
  { path: 'symbol/:ticker', canActivate: [authGuard], loadComponent: () => import('./pages/symbol/symbol').then((m) => m.SymbolPage) },
  {
    path: 'settings',
    canActivate: [sessionGuard], // the shell is reachable during a forced password change; its children are not
    loadComponent: () => import('./pages/settings/settings').then((m) => m.Settings),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'accounts' },
      { path: 'accounts', canActivate: [authGuard], loadComponent: () => import('./pages/accounts/accounts').then((m) => m.Accounts) },
      { path: 'accounts/:id/import', canActivate: [authGuard], loadComponent: () => import('./pages/import/import').then((m) => m.Import) },
      { path: 'user-setup', canActivate: [adminGuard], loadComponent: () => import('./pages/users/users').then((m) => m.Users) },
      { path: 'change-password', loadComponent: () => import('./pages/change-password/change-password').then((m) => m.ChangePassword) },
    ],
  },
  // Old URLs keep working (bookmarks). Query strings survive a redirect.
  { path: 'holdings', redirectTo: 'home' },
  { path: 'accounts', redirectTo: 'settings/accounts' },
  { path: 'accounts/:id/import', redirectTo: 'settings/accounts/:id/import' },
  { path: 'users', redirectTo: 'settings/user-setup' },
  { path: 'setup', redirectTo: 'login' }, // first-run setup was replaced by the seeded default admin
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: '**', redirectTo: 'home' },
];
