import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { apiError } from '../../core/errors';
import { Watchlist } from '../../core/models';
import { WatchlistsService } from '../../core/watchlists.service';

@Component({
  selector: 'app-watchlists',
  imports: [RouterLink],
  template: `
    <h2>Watchlists</h2>
    <p class="hint">Each symbol on a watchlist is scored against your investing principles.</p>
    <form class="check" (submit)="$event.preventDefault(); create()">
      <label class="check">Name
        <input name="name" maxlength="100" required [value]="name()" (input)="name.set($any($event.target).value)" />
      </label>
      <button type="submit" [disabled]="busy() || !name().trim()">Create watchlist</button>
    </form>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (lists(); as ls) {
      @if (ls.length === 0) {
        <p class="hint">No watchlists yet.</p>
      } @else {
        <ul class="accounts">
          @for (w of ls; track w.id) {
            <li>
              <a [routerLink]="['/watchlists', w.id]">{{ w.name }}</a>
              <span class="platform">{{ w.symbols.length }} symbol{{ w.symbols.length === 1 ? '' : 's' }}
                @if (w.symbols.length) { · {{ w.symbols.slice(0, 8).join(', ') }}{{ w.symbols.length > 8 ? '…' : '' }} }
              </span>
            </li>
          }
        </ul>
      }
    } @else if (!error()) {
      <p class="hint">Loading…</p>
    }
  `,
})
export class Watchlists {
  private readonly api = inject(WatchlistsService);
  private readonly router = inject(Router);
  protected readonly lists = signal<Watchlist[] | null>(null);
  protected readonly name = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.lists.set(await firstValueFrom(this.api.list()));
    } catch (e) {
      this.error.set(apiError(e, 'Could not load your watchlists'));
    }
  }

  protected async create(): Promise<void> {
    const name = this.name().trim();
    if (!name || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const w = await firstValueFrom(this.api.create(name));
      await this.router.navigate(['/watchlists', w.id]);
    } catch (e) {
      this.error.set(apiError(e, 'Could not create the watchlist'));
    } finally {
      this.busy.set(false);
    }
  }
}
