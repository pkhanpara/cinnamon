import { Component, computed, input } from '@angular/core';
import { donutSlices } from '../../core/donut';
import { Holding } from '../../core/models';

@Component({
  selector: 'app-donut',
  template: `
    @if (slices().length) {
      <div class="donut">
        <svg viewBox="0 0 42 42" role="img" [attr.aria-label]="label()">
          <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--border)" stroke-width="6" />
          @for (s of slices(); track s.label) {
            <circle cx="21" cy="21" r="15.9155" fill="none" [attr.stroke]="s.color" stroke-width="6"
                    [attr.stroke-dasharray]="s.pct + ' ' + (100 - s.pct)" [attr.stroke-dashoffset]="s.offset" />
          }
        </svg>
        <ul class="legend">
          @for (s of slices(); track s.label) {
            <li><span class="swatch" [style.background]="s.color"></span>{{ s.label }}
              <span class="pct">{{ s.pct.toFixed(1) }}%</span></li>
          }
        </ul>
      </div>
    }
  `,
  styles: `
    .donut { display: flex; gap: 1.25rem; align-items: center; flex-wrap: wrap; }
    svg { width: 11rem; height: 11rem; transform: rotate(0deg); }
    .legend { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.25rem; font-size: 0.9rem; }
    .swatch { display: inline-block; width: 0.75rem; height: 0.75rem; border-radius: 2px; margin-right: 0.5rem; }
    .pct { color: var(--muted); margin-left: 0.5rem; font-variant-numeric: tabular-nums; }
  `,
})
export class Donut {
  readonly holdings = input.required<Holding[]>();
  protected readonly slices = computed(() => donutSlices(this.holdings()));
  protected readonly label = computed(
    () =>
      'Allocation by value: ' +
      this.slices()
        .slice(0, 3)
        .map((s) => `${s.label} ${s.pct.toFixed(0)}%`)
        .join(', '),
  );
}
