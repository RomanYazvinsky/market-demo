import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import type { RouteMeta } from '@analogjs/router';
import { MarketTable } from '../dashboard/market-table';
import { StatusBadge } from '../dashboard/status-badge';
import { ProducerService } from '../producer/producer.service';

export const routeMeta: RouteMeta = { title: 'Dashboard' };

@Component({
  selector: 'app-dashboard-page',
  imports: [MatButtonModule, MarketTable, StatusBadge],
  host: { class: 'block' },
  template: `
    <section class="flex flex-col gap-4">
      <header class="flex flex-wrap items-center justify-between gap-4">
        <h1>Market dashboard</h1>
      </header>

      @if (producer.started()) {
        <div class="flex flex-wrap items-center justify-between gap-4">
          <app-status-badge [status]="producer.status()" [error]="producer.error()" />
          <button matButton="tonal" type="button" [disabled]="!canToggle()" (click)="toggle()">
            {{ producer.status() === 'paused' ? 'Resume' : 'Pause' }}
          </button>
        </div>

        <app-market-table [rows]="producer.rows()" />
      } @else {
        <div class="flex flex-col gap-4" aria-busy="true" aria-label="Loading market data">
          <div class="flex items-center justify-between gap-4">
            <div class="skeleton h-7 w-32 rounded-full"></div>
            <div class="skeleton h-10 w-24 rounded-full"></div>
          </div>
          <div class="flex flex-col gap-2">
            @for (row of skeletonRows; track row) {
              <div class="skeleton h-12"></div>
            }
          </div>
        </div>
      }
    </section>
  `,
})
export default class DashboardPage {
  protected readonly producer = inject(ProducerService);
  protected readonly skeletonRows = [1, 2, 3, 4, 5];
  protected readonly canToggle = computed(() => ['running', 'paused'].includes(this.producer.status()));

  toggle(): void {
    if (this.producer.status() === 'running') this.producer.pause();
    else if (this.producer.status() === 'paused') this.producer.resume();
  }
}
