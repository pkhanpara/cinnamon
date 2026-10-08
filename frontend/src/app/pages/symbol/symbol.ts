import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { NewsChat } from '../../components/news-chat/news-chat';
import { PriceChart } from '../../components/price-chart/price-chart';
import { RANGES } from '../../core/chart-data';
import { loadSelection } from '../../core/account-selection';
import { AuthService } from '../../core/auth.service';
import { apiError } from '../../core/errors';
import {
  ageLabel,
  fmtCompactMoney,
  fmtCompactNumber,
  fmtMoney,
  fmtPct,
  fmtQty,
  fmtSigned,
  tone,
} from '../../core/format';
import { lineGain, showPlatform } from '../../core/lines';
import { HistoryRange, HistoryResponse, NewsResponse, SymbolOverview } from '../../core/models';
import { SymbolsService } from '../../core/symbols.service';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-symbol',
  imports: [DatePipe, RouterLink, PriceChart, NewsChat],
  template: `
    @if (overviewLoading()) {
      <p>Loading {{ ticker() }}…</p>
    } @else if (overviewError()) {
      <p class="error" role="alert">{{ overviewError() }}</p>
      <p><a routerLink="/home">← Home</a></p>
    } @else if (overview(); as o) {
      <header class="sym-head">
        <div>
          <h2>{{ o.name ?? o.symbol }}</h2>
          <p class="hint">
            {{ o.symbol }}@if (o.profile?.exchange) { · {{ o.profile?.exchange }} }
            @if (o.profile?.industry) { · {{ o.profile?.industry }} }
          </p>
        </div>
        @if (o.quote; as q) {
          <div class="price">
            <strong>{{ fmt(q.price) }}</strong>
            @if (q.change !== null) {
              <span [class]="tone(q.change)">{{ signed(q.change) }} ({{ pct(q.change_pct) }})</span>
            }
            @if (q.stale) {
              <span class="warn">Last known price, {{ q.as_of | date: 'medium' }}</span>
            } @else {
              <span class="hint">as of {{ q.as_of | date: 'mediumTime' }}</span>
            }
          </div>
        }
      </header>

      @for (w of o.warnings; track w) { <p class="warn" role="note">{{ w }}</p> }

      <div class="ranges" role="group" aria-label="Chart range">
        @for (r of ranges; track r.value) {
          <button type="button" [class.on]="range() === r.value" [attr.aria-pressed]="range() === r.value"
                  (click)="setRange(r.value)">{{ r.label }}</button>
        }
      </div>

      @if (historyError()) {
        <p class="error" role="alert">{{ historyError() }}
          <button type="button" class="link" (click)="loadHistory()">Retry</button></p>
      } @else if (history(); as h) {
        @if (h.stale) { <p class="warn" role="note">Showing cached prices from {{ h.as_of | date: 'medium' }}.</p> }
        <app-price-chart [history]="h" [baseline]="prevClose()" />
      } @else {
        <p class="hint">Loading chart…</p>
      }

      <div class="cards">
        <section class="card-block" aria-labelledby="stats-h">
          <h3 id="stats-h">Key statistics</h3>
          <dl>
            <dt>Previous close</dt><dd>{{ o.quote?.prev_close ? fmt(o.quote!.prev_close!) : '—' }}</dd>
            <dt>52-week range</dt>
            <dd>{{ o.stats?.week52_low && o.stats?.week52_high ? fmt(o.stats!.week52_low!) + ' – ' + fmt(o.stats!.week52_high!) : '—' }}</dd>
            <dt>Market cap</dt><dd>{{ o.profile?.market_cap ? compactMoney(o.profile!.market_cap!) : '—' }}</dd>
            <dt>Avg volume (10d)</dt><dd>{{ o.stats?.avg_volume_10d ? compactNumber(o.stats!.avg_volume_10d!) : '—' }}</dd>
            <dt>Avg volume (3m)</dt><dd>{{ o.stats?.avg_volume_3m ? compactNumber(o.stats!.avg_volume_3m!) : '—' }}</dd>
            @if (o.profile?.web_url) {
              <dt>Website</dt>
              <dd><a [href]="o.profile!.web_url!" target="_blank" rel="noopener noreferrer">{{ o.profile!.web_url }}</a></dd>
            }
          </dl>
        </section>

        <section class="card-block" aria-labelledby="pos-h">
          <h3 id="pos-h">Your position</h3>
          @if (o.position; as p) {
            <dl>
              <dt>Quantity</dt><dd>{{ qty(p.quantity) }}</dd>
              <dt>Cost basis</dt><dd>{{ fmt(p.cost_basis) }}</dd>
              <dt>Value</dt><dd>{{ p.value ? fmt(p.value) : '—' }}</dd>
              <dt>Gain / loss</dt>
              <dd [class]="tone(p.gain)">{{ p.gain !== null ? signed(p.gain) + ' (' + pct(p.gain_pct) + ')' : '—' }}</dd>
            </dl>
            <p class="hint pos-scope">
              @if (p.lines.length === 1) { In {{ p.lines[0].account_nickname }} }
              @else { Across all your accounts ({{ p.lines.length }}) }
            </p>
            @if (p.lines.length > 1) {
              <div class="table-x">
                <table class="lines">
                  <thead>
                    <tr><th>Account</th><th class="num">Qty</th><th class="num">Cost</th><th class="num">Value</th><th class="num">Gain / loss</th></tr>
                  </thead>
                  <tbody>
                    @for (l of p.lines; track l.account_id) {
                      <tr>
                        <td>
                          {{ l.account_nickname }}@if (showPlatform(l.account_nickname, l.platform)) { <span class="platform">{{ l.platform }}</span> }
                          @if (hiddenOnHome().has(l.account_id)) { <span class="sub hidden-tag">hidden on Home</span> }
                        </td>
                        <td class="num">{{ qty(l.quantity) }}</td>
                        <td class="num">{{ fmt(l.cost_basis) }}</td>
                        <td class="num">{{ l.value ? fmt(l.value) : '—' }}</td>
                        @if (gainOf(l); as g) {
                          <td class="num line-gain" [class]="tone(g.gain)">{{ signed(g.gain) }}@if (g.pct !== null) { <div class="sub">{{ pct(g.pct) }}</div> }</td>
                        } @else { <td class="num line-gain muted">—</td> }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          } @else {
            <p class="hint">You don't hold {{ o.symbol }} in any account.</p>
          }
        </section>
      </div>

      <section aria-labelledby="news-h">
        <div class="news-head">
          <h3 id="news-h">News</h3>
          @if (news(); as n) {
            <span class="sub">Updated <time [attr.datetime]="n.as_of">{{ newsAge() }}</time></span>
          }
          @if (!newsNoKey()) {
            <button type="button" (click)="refreshNews()" [disabled]="newsRefreshing() || retryIn() > 0 || (!news() && !newsError())">
              {{ newsRefreshing() ? 'Refreshing…' : 'Refresh' }}
            </button>
          }
        </div>
        @if (retryIn() > 0) {
          <p class="hint" role="status">Refreshed a moment ago. Try again in {{ retryIn() }} s.</p>
        } @else if (newsNote()) {
          <p class="warn" role="status">{{ newsNote() }}</p>
        }
        @if (newsError()) {
          <p class="hint">{{ newsError() }}</p>
        } @else if (news(); as n) {
          @if (n.stale) { <p class="warn" role="note">Showing cached headlines.</p> }
          @if (n.items.length === 0) { <p class="hint">No recent news.</p> }
          <ul class="news">
            @for (item of n.items; track item.url) {
              <li>
                <a [href]="item.url" target="_blank" rel="noopener noreferrer">{{ item.headline }}</a>
                <div class="sub">{{ item.source }} · {{ item.published_at | date: 'medium' }}</div>
                @if (item.summary) { <p class="summary">{{ item.summary }}</p> }
              </li>
            }
          </ul>
        } @else {
          <p class="hint">Loading news…</p>
        }
      </section>

      <app-news-chat [symbol]="o.symbol" />
    }
  `,
})
export class SymbolPage {
  private readonly api = inject(SymbolsService);
  private readonly auth = inject(AuthService);
  protected readonly ticker = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((p) => (p.get('ticker') ?? '').toUpperCase())),
    { initialValue: '' },
  );

  protected readonly ranges = RANGES;
  protected readonly range = signal<HistoryRange>('6m');
  protected readonly overview = signal<SymbolOverview | null>(null);
  protected readonly overviewLoading = signal(true);
  protected readonly overviewError = signal('');
  protected readonly history = signal<HistoryResponse | null>(null);
  protected readonly historyError = signal('');
  protected readonly prevClose = computed(() => {
    const v = this.overview()?.quote?.prev_close;
    return v ? Number(v) : null;
  });
  /**
   * The position always covers every account (it is what you own, and what the AI chat is told). Home's
   * account ticks are only a view filter, so accounts unticked there are tagged rather than dropped.
   */
  protected readonly hiddenOnHome = computed(() => {
    const user = this.auth.user();
    const saved = user ? loadSelection(user.id) : null;
    const lines = this.overview()?.position?.lines ?? [];
    return new Set(
      saved
        ? lines
            .map((l) => l.account_id)
            .filter((id) => saved.known.includes(id) && !saved.selected.includes(id))
        : [],
    );
  });
  protected readonly news = signal<NewsResponse | null>(null);
  protected readonly newsError = signal('');
  protected readonly newsNoKey = signal(false);
  protected readonly newsRefreshing = signal(false);
  protected readonly newsNote = signal('');
  private readonly retryAt = signal(0);
  // Ticks once a second so "Updated N min ago" and the retry countdown stay current.
  private readonly now = signal(Date.now());
  protected readonly newsAge = computed(() => {
    const n = this.news();
    return n ? ageLabel(n.as_of, this.now()) : '';
  });
  protected readonly retryIn = computed(() =>
    Math.max(0, Math.ceil((this.retryAt() - this.now()) / 1000)),
  );

  // Sequence numbers: a slow answer for a previous symbol/range must never overwrite a newer one.
  private symbolSeq = 0;
  private historySeq = 0;

  protected readonly fmt = fmtMoney;
  protected readonly signed = fmtSigned;
  protected readonly pct = fmtPct;
  protected readonly qty = fmtQty;
  protected readonly tone = tone;
  protected readonly showPlatform = showPlatform;
  protected readonly gainOf = lineGain;
  protected readonly compactMoney = fmtCompactMoney;
  protected readonly compactNumber = fmtCompactNumber;

  constructor() {
    const tick = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
    effect(() => {
      const symbol = this.ticker();
      if (symbol) untracked(() => void this.loadSymbol(symbol));
    });
  }

  private async loadSymbol(symbol: string): Promise<void> {
    const seq = ++this.symbolSeq;
    this.historySeq++; // also invalidates any in-flight history request for the previous symbol
    this.overviewLoading.set(true);
    this.overviewError.set('');
    this.overview.set(null);
    this.history.set(null);
    this.historyError.set('');
    this.news.set(null);
    this.newsError.set('');
    this.newsNoKey.set(false);
    this.newsRefreshing.set(false);
    this.newsNote.set('');
    this.retryAt.set(0);

    // Chart and news don't wait for the overview, and none of them can break the others.
    void this.loadHistory();
    void this.loadNews(symbol, seq);
    try {
      const o = await firstValueFrom(this.api.overview(symbol));
      if (seq === this.symbolSeq) this.overview.set(o);
    } catch (e) {
      if (seq === this.symbolSeq) this.overviewError.set(apiError(e, `Could not load ${symbol}`));
    } finally {
      if (seq === this.symbolSeq) this.overviewLoading.set(false);
    }
  }

  protected setRange(range: HistoryRange): void {
    if (range === this.range()) return;
    this.range.set(range);
    void this.loadHistory();
  }

  protected async loadHistory(): Promise<void> {
    const symbol = this.ticker();
    const range = this.range();
    const seq = ++this.historySeq;
    this.historyError.set('');
    try {
      const h = await firstValueFrom(this.api.history(symbol, range));
      if (seq === this.historySeq) this.history.set(h);
    } catch (e) {
      if (seq === this.historySeq) {
        this.history.set(null);
        this.historyError.set(apiError(e, 'Price history is unavailable'));
      }
    }
  }

  private async loadNews(symbol: string, seq: number): Promise<void> {
    try {
      const n = await firstValueFrom(this.api.news(symbol));
      if (seq === this.symbolSeq) this.news.set(n);
    } catch (e) {
      // 503 means no API key; keep it quiet, the overview already says so.
      if (seq === this.symbolSeq) {
        const noKey = e instanceof HttpErrorResponse && e.status === 503;
        this.newsNoKey.set(noKey);
        this.newsError.set(
          noKey ? 'News needs a Finnhub API key.' : apiError(e, 'News is unavailable'),
        );
      }
    }
  }

  /** Refetch now. The old headlines stay on screen unless the refresh succeeds. */
  protected async refreshNews(): Promise<void> {
    if (this.newsRefreshing() || this.retryIn() > 0) return;
    const symbol = this.ticker();
    const seq = this.symbolSeq;
    this.newsRefreshing.set(true);
    this.newsNote.set('');
    try {
      const n = await firstValueFrom(this.api.refreshNews(symbol));
      if (seq !== this.symbolSeq) return;
      this.news.set(n);
      this.newsError.set('');
      if (n.stale) this.newsNote.set('Could not reach the news source; showing earlier headlines.');
    } catch (e) {
      if (seq !== this.symbolSeq) return;
      if (e instanceof HttpErrorResponse && e.status === 429) {
        const secs = Number(e.headers.get('Retry-After'));
        this.retryAt.set(Date.now() + (Number.isFinite(secs) && secs > 0 ? secs : 60) * 1000);
        this.now.set(Date.now());
      } else {
        this.newsNote.set(
          `${apiError(e, 'Could not refresh the news')}${this.news() ? ' Showing earlier headlines.' : ''}`,
        );
      }
    } finally {
      if (seq === this.symbolSeq) this.newsRefreshing.set(false);
    }
  }
}
