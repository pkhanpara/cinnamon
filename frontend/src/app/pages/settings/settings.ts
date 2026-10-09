import { Component, inject } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { FORM_FIELD_DEFAULTS } from '../../core/material';

@Component({
  selector: 'app-settings',
  providers: [FORM_FIELD_DEFAULTS],
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatTabsModule],
  template: `
    <h2>Settings</h2>
    <nav mat-tab-nav-bar mat-stretch-tabs="false" mat-align-tabs="start" [tabPanel]="panel" aria-label="Settings">
      @if (!auth.mustChangePassword()) {
        <a mat-tab-link routerLink="/settings/accounts" routerLinkActive #acc="routerLinkActive"
           [active]="acc.isActive">Accounts</a>
        @if (auth.user()?.is_admin) {
          <a mat-tab-link routerLink="/settings/user-setup" routerLinkActive #usr="routerLinkActive"
             [active]="usr.isActive">User setup</a>
        }
      }
      <a mat-tab-link routerLink="/settings/change-password" routerLinkActive #pw="routerLinkActive"
         [active]="pw.isActive">Change password</a>
    </nav>
    <mat-tab-nav-panel #panel><section><router-outlet /></section></mat-tab-nav-panel>
  `,
  styles: `
    nav { margin-bottom: 1.5rem; border-bottom: 1px solid var(--border); }
    section :first-child { margin-top: 0; }
    @media (max-width: 640px) { .mat-mdc-tab-link { min-width: 0; padding: 0 0.6rem; flex-grow: 0; } }
  `,
})
export class Settings {
  protected readonly auth = inject(AuthService);
}
