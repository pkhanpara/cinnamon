import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Subject, catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { apiError } from '../../core/errors';
import { SearchHit } from '../../core/models';
import { SymbolsService } from '../../core/symbols.service';

const SYMBOL_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,14}$/;

@Component({
  selector: 'app-symbol-search',
  template: `
    <div class="search">
      <input type="search" role="combobox" aria-label="Search symbols" aria-autocomplete="list"
             aria-controls="symbol-results" autocomplete="off" placeholder="Search symbol or company"
             [attr.aria-expanded]="open()" [attr.aria-activedescendant]="active() >= 0 ? 'sr-' + active() : null"
             [value]="query()" (input)="onInput($any($event.target).value)"
             (keydown.enter)="enter($event)" (keydown.arrowdown)="move(1, $event)"
             (keydown.arrowup)="move(-1, $event)" (keydown.escape)="close()" />
      @if (open()) {
        <ul id="symbol-results" role="listbox" aria-label="Matching symbols">
          @for (h of hits(); track h.symbol; let i = $index) {
            <li role="option" [id]="'sr-' + i" [attr.aria-selected]="i === active()" [class.active]="i === active()"
                (mousedown)="go(h.symbol, $event)">
              <strong>{{ h.symbol }}</strong> <span class="sub">{{ h.description }}</span>
            </li>
          }
          @if (message()) { <li class="msg" role="presentation">{{ message() }}</li> }
        </ul>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .search { position: relative; }
    input { width: 17rem; max-width: 100%; padding-left: 2rem !important;
            background: var(--surface-2) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%23667085' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='7' cy='7' r='5'/%3E%3Cpath d='m14 14-3.5-3.5'/%3E%3C/svg%3E") no-repeat 0.65rem center !important; }
    input:focus { background-color: var(--surface) !important; }
    ul { position: absolute; z-index: 30; top: 100%; left: 0; min-width: 100%; width: max-content; max-width: min(28rem, 90vw);
         margin: 4px 0 0; padding: 0.3rem; list-style: none; box-sizing: border-box;
         background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); box-shadow: var(--shadow-lg); }
    li { padding: 0.5rem 0.7rem; border-radius: 6px; cursor: pointer; }
    li.active, li:hover { background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
    li.msg { cursor: default; color: var(--muted); }
    .sub { color: var(--muted); font-size: 0.85rem; margin-left: 0.4rem; }
    @media (max-width: 640px) { input { width: 100%; } }
  `,
})
export class SymbolSearch {
  private readonly api = inject(SymbolsService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly typed = new Subject<string>();

  protected readonly query = signal('');
  protected readonly hits = signal<SearchHit[]>([]);
  protected readonly message = signal('');
  protected readonly open = signal(false);
  protected readonly active = signal(-1);
  /** The query the current `hits` belong to, so Enter never acts on results for older text. */
  private hitsFor = '';

  constructor() {
    this.typed
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) =>
          this.api.search(q).pipe(
            switchMap((hits) => of({ q, hits, error: '' })),
            catchError((e) =>
              of({ q, hits: [] as SearchHit[], error: apiError(e, 'Search is unavailable') }),
            ),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ q, hits, error }) => {
        this.hits.set(hits);
        this.hitsFor = q;
        this.active.set(-1);
        this.message.set(
          error || (hits.length === 0 ? 'No matches. Press Enter to try the symbol as typed.' : ''),
        );
        this.open.set(true);
      });
  }

  protected onInput(value: string): void {
    this.query.set(value);
    const q = value.trim();
    if (!q) {
      this.close();
      return;
    }
    this.typed.next(q);
  }

  protected move(delta: number, event: Event): void {
    const n = this.hits().length;
    if (!this.open() || n === 0) return;
    event.preventDefault();
    // n results plus one extra slot for "nothing highlighted" (-1), wrapping around both ends.
    const slots = n + 1;
    this.active.set(((((this.active() + 1 + delta) % slots) + slots) % slots) - 1);
  }

  protected enter(event: Event): void {
    event.preventDefault();
    const q = this.query().trim();
    const fresh = this.hitsFor === q ? this.hits() : [];
    const chosen =
      this.active() >= 0
        ? this.hits()[this.active()]?.symbol
        : (fresh.find((h) => h.symbol === q.toUpperCase())?.symbol ??
          fresh[0]?.symbol ??
          (SYMBOL_RE.test(q) ? q.toUpperCase() : undefined));
    if (chosen) this.go(chosen);
  }

  protected go(symbol: string, event?: Event): void {
    event?.preventDefault(); // mousedown: keep the input from blurring before we navigate
    this.close();
    this.query.set('');
    void this.router.navigate(['/symbol', symbol]);
  }

  protected close(): void {
    this.open.set(false);
    this.active.set(-1);
  }

  @HostListener('document:click', ['$event'])
  protected outside(event: Event): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.close();
  }
}
