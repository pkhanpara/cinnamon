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
    <form class="create" (submit)="$event.preventDefault(); create()">
      <input name="name" aria-label="Name" placeholder="New watchlist name" maxlength="100" required
             [value]="name()" (input)="name.set($any($event.target).value)" />
      <button type="submit" [disabled]="busy() || !name().trim()">Create watchlist</button>
    </form>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (lists(); as ls) {
      @if (ls.length === 0) {
        <p class="hint">No watchlists yet.</p>
      } @else {
        <ul class="lists">
          @for (w of ls; track w.id) {
            <li>
              <a class="name" [routerLink]="['/watchlists', w.id]">{{ w.name }}</a>
              <span class="count">{{ w.symbols.length }} symbol{{ w.symbols.length === 1 ? '' : 's' }}</span>
              @if (w.symbols.length) {
                <span class="syms">
                  @for (sym of w.symbols.slice(0, 8); track sym) { <span class="tag">{{ sym }}</span> }
                  @if (w.symbols.length > 8) { <span class="tag more">+{{ w.symbols.length - 8 }}</span> }
                </span>
              }
            </li>
          }
        </ul>
      }
    } @else if (!error()) {
      <p class="hint">Loading…</p>
    }
  `,
  styles: `
    .create { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1rem 0; }
    .create input { flex: 1 1 14rem; max-width: 24rem; }
    .lists { list-style: none; padding: 0; display: grid; gap: 0.75rem;
             grid-template-columns: repeat(auto-fill, minmax(min(18rem, 100%), 1fr)); }
    .lists li { position: relative; display: grid; gap: 0.4rem; padding: 1rem 1.25rem; background: var(--surface);
                border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow);
                transition: box-shadow 0.15s, border-color 0.15s; }
    .lists li:hover { border-color: var(--border-strong); box-shadow: var(--shadow-lg); }
    .name { font-weight: 650; font-size: 1.05rem; color: var(--text); text-decoration: none; }
    .name::after { content: ''; position: absolute; inset: 0; } /* the whole card is the link */
    .count { color: var(--muted); font-size: 0.85rem; }
    .syms { display: flex; flex-wrap: wrap; gap: 0.3rem; }
    .tag { padding: 0.1rem 0.5rem; border-radius: 6px; background: var(--surface-2); font-size: 0.78rem; font-weight: 600; }
    .tag.more { color: var(--muted); }
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
