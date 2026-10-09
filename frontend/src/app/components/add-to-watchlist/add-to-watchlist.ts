import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { apiError } from '../../core/errors';
import { Watchlist } from '../../core/models';
import { WatchlistsService } from '../../core/watchlists.service';

/** "Add to watchlist" control for the ticker page. */
@Component({
  selector: 'app-add-to-watchlist',
  imports: [RouterLink],
  template: `
    <div class="add-wl" role="group" aria-label="Watchlists">
      @if (on().length) {
        <span class="sub">On
          @for (w of on(); track w.id; let last = $last) {
            <a [routerLink]="['/watchlists', w.id]">{{ w.name }}</a>{{ last ? '' : ', ' }}
          }
        </span>
      }
      @if (lists(); as ls) {
        @if (ls.length === 0) {
          <button type="button" (click)="createAndAdd()" [disabled]="busy()">Add to a new watchlist</button>
        } @else if (offList().length) {
          <select aria-label="Watchlist" [value]="chosen()" (change)="chosen.set(+$any($event.target).value)">
            @for (w of offList(); track w.id) { <option [value]="w.id">{{ w.name }}</option> }
          </select>
          <button type="button" (click)="add()" [disabled]="busy()">Add to watchlist</button>
        }
      }
      @if (error()) { <span class="error" role="alert">{{ error() }}</span> }
    </div>
  `,
  styles: `
    .add-wl { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin: 0.75rem 0 0.25rem; }
    select { max-width: 14rem; }
    a { font-weight: 550; text-decoration: none; }
  `,
})
export class AddToWatchlist {
  private readonly api = inject(WatchlistsService);
  readonly symbol = input.required<string>();

  protected readonly lists = signal<Watchlist[] | null>(null);
  protected readonly chosen = signal(0);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly on = computed(() =>
    (this.lists() ?? []).filter((w) => w.symbols.includes(this.symbol())),
  );
  protected readonly offList = computed(() =>
    (this.lists() ?? []).filter((w) => !w.symbols.includes(this.symbol())),
  );

  constructor() {
    effect(() => {
      this.symbol();
      untracked(() => void this.load());
    });
  }

  private async load(): Promise<void> {
    try {
      const ls = await firstValueFrom(this.api.list());
      this.lists.set(ls);
      this.pickFirst();
    } catch {
      this.lists.set(null); // the control simply doesn't show; the page is about the symbol
    }
  }

  private pickFirst(): void {
    const off = this.offList();
    if (!off.some((w) => w.id === this.chosen())) this.chosen.set(off[0]?.id ?? 0);
  }

  protected async add(): Promise<void> {
    const id = this.chosen();
    if (!id) return;
    await this.run(async () => {
      const d = await firstValueFrom(this.api.addSymbol(id, this.symbol()));
      this.lists.update((ls) =>
        (ls ?? []).map((w) => (w.id === id ? { ...w, symbols: d.items.map((i) => i.symbol) } : w)),
      );
    });
  }

  protected async createAndAdd(): Promise<void> {
    await this.run(async () => {
      const created = await firstValueFrom(this.api.create('Watchlist'));
      const d = await firstValueFrom(this.api.addSymbol(created.id, this.symbol()));
      this.lists.set([
        { id: d.id, name: d.name, created_at: d.created_at, symbols: d.items.map((i) => i.symbol) },
      ]);
    });
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await fn();
      this.pickFirst();
    } catch (e) {
      this.error.set(apiError(e, 'Could not add to the watchlist'));
    } finally {
      this.busy.set(false);
    }
  }
}
