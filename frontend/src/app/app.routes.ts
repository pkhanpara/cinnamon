import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./pages/login/login').then((m) => m.Login) },
  { path: 'setup', canActivate: [guestGuard], loadComponent: () => import('./pages/setup/setup').then((m) => m.Setup) },
  { path: 'accounts', canActivate: [authGuard], loadComponent: () => import('./pages/accounts/accounts').then((m) => m.Accounts) },
  { path: 'accounts/:id/import', canActivate: [authGuard], loadComponent: () => import('./pages/import/import').then((m) => m.Import) },
  { path: 'users', canActivate: [adminGuard], loadComponent: () => import('./pages/users/users').then((m) => m.Users) },
  { path: '', pathMatch: 'full', redirectTo: 'accounts' },
  { path: '**', redirectTo: 'accounts' },
];
