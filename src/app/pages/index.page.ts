import { Component, inject } from '@angular/core';
import type { RouteMeta } from '@analogjs/router';
import { MarketTable } from '../dashboard/market-table/market-table';
import { ProducerToggle } from '../dashboard/producer-toggle/producer-toggle';
import { StatusBadge } from '../dashboard/status-badge/status-badge';
import { ProducerService } from '../producer/producer.service';

export const routeMeta: RouteMeta = { title: 'Dashboard' };

@Component({
  selector: 'app-dashboard-page',
  imports: [MarketTable, ProducerToggle, StatusBadge],
  host: { class: 'block' },
  templateUrl: './index.page.html',
})
export default class DashboardPage {
  protected readonly producer = inject(ProducerService);
  protected readonly skeletonRows = [1, 2, 3, 4, 5];
}
