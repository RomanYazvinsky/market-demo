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
  templateUrl: './index.page.html',
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
