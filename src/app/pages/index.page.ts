import { Component, inject } from '@angular/core';
import type { RouteMeta } from '@analogjs/router';
import { ProducerService } from '../producer/producer.service';

export const routeMeta: RouteMeta = { title: 'Dashboard' };

@Component({
  selector: 'app-dashboard-page',
  styleUrl: './index.page.scss',
  template: `
    <section class="flex flex-col gap-4">
      <header class="flex flex-wrap items-center justify-between gap-4">
        <h1>Market dashboard</h1>
      </header>

      <div class="flex flex-col gap-4" aria-busy="true" aria-label="Loading market data">
        <div class="flex items-center justify-between gap-4">
          <div class="skeleton skeleton-pill"></div>
          <div class="skeleton skeleton-button"></div>
        </div>
        <div class="flex flex-col gap-2">
          @for (row of skeletonRows; track row) {
            <div class="skeleton skeleton-row"></div>
          }
        </div>
      </div>
    </section>
  `,
})
export default class DashboardPage {
  protected readonly producer = inject(ProducerService);
  protected readonly skeletonRows = [1, 2, 3, 4, 5];
}
