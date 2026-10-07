import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-settings',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <h2>Settings</h2>
    <div class="settings">
      <nav aria-label="Settings">
        @if (!auth.mustChangePassword()) {
          <a routerLink="/settings/accounts" routerLinkActive="active">Accounts</a>
          @if (auth.user()?.is_admin) {
            <a routerLink="/settings/user-setup" routerLinkActive="active">User setup</a>
          }
        }
        <a routerLink="/settings/change-password" routerLinkActive="active">Change password</a>
      </nav>
      <section><router-outlet /></section>
    </div>
  `,
  styles: `
    .settings { display: grid; grid-template-columns: 11rem 1fr; gap: 2rem; align-items: start; }
    nav { display: grid; gap: 0.25rem; }
    nav a { color: inherit; text-decoration: none; padding: 0.4rem 0.6rem; border-radius: 6px; }
    nav a.active { background: color-mix(in srgb, CanvasText 8%, Canvas); font-weight: 600; }
    section :first-child { margin-top: 0; }
    @media (max-width: 40rem) { .settings { grid-template-columns: 1fr; gap: 1rem; } nav { grid-auto-flow: column; overflow-x: auto; } }
  `,
})
export class Settings {
  protected readonly auth = inject(AuthService);
}
