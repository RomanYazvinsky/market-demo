import { Component, inject } from '@angular/core';
import type { RouteMeta } from '@analogjs/router';
import { MarketTable } from '../dashboard/market-table/market-table';
import { ProducerService } from '../producer/producer.service';
import { DisplaySettings } from '../settings/display-settings';

export const routeMeta: RouteMeta = { title: 'Dashboard' };

@Component({
  selector: 'app-dashboard-page',
  imports: [MarketTable],
  host: { class: 'block' },
  templateUrl: './index.page.html',
})
export default class DashboardPage {
  protected readonly producer = inject(ProducerService);
  protected readonly display = inject(DisplaySettings);
  protected readonly skeletonRows = [1, 2, 3, 4, 5];
}
