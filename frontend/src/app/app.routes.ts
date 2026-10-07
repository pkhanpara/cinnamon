import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./pages/login/login').then((m) => m.Login) },
  { path: 'setup', canActivate: [guestGuard], loadComponent: () => import('./pages/setup/setup').then((m) => m.Setup) },
  { path: 'accounts', canActivate: [authGuard], loadComponent: () => import('./pages/accounts/accounts').then((m) => m.Accounts) },
  { path: '', pathMatch: 'full', redirectTo: 'accounts' },
  { path: '**', redirectTo: 'accounts' },
];
