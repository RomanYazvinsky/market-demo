import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import type { RouteMeta } from '@analogjs/router';
import { ProducerService } from '../producer/producer.service';
import type { MetricsRow } from '../producer/protocol';
import { BigIntPipe } from '../shared/bigint.pipe';
import { CentsPipe } from '../shared/cents.pipe';

export const routeMeta: RouteMeta = { title: 'Dashboard' };

@Component({
  selector: 'app-dashboard-page',
  imports: [MatTableModule, MatButtonModule, CurrencyPipe, DecimalPipe, CentsPipe, BigIntPipe],
  styleUrl: './index.page.scss',
  template: `
    <section class="flex flex-col gap-4">
      <header class="flex flex-wrap items-center justify-between gap-4">
        <h1>Market dashboard</h1>
      </header>

      @if (producer.started()) {
        <div class="flex flex-wrap items-center justify-between gap-4">
          <p role="status" class="status" [attr.data-status]="producer.status()">
            <span class="status-word">{{ producer.status() }}</span>
            @if (producer.error(); as error) {
              <span class="status-error">{{ error }}</span>
            }
          </p>
          <button matButton="tonal" type="button" [disabled]="!canToggle()" (click)="toggle()">
            {{ producer.status() === 'paused' ? 'Resume' : 'Pause' }}
          </button>
        </div>

        <div class="table-wrap">
          <table mat-table [dataSource]="producer.rows()" [trackBy]="trackBySymbol" aria-label="Instruments">
            <ng-container matColumnDef="symbol">
              <th mat-header-cell *matHeaderCellDef>Symbol</th>
              <td mat-cell *matCellDef="let row">{{ row.symbol }}</td>
            </ng-container>
            <ng-container matColumnDef="last">
              <th mat-header-cell *matHeaderCellDef class="num">Last price</th>
              <td mat-cell *matCellDef="let row" class="num">{{ (row.lastPriceCents | cents | currency: 'USD') ?? '—' }}</td>
            </ng-container>
            <ng-container matColumnDef="spread">
              <th mat-header-cell *matHeaderCellDef class="num">Spread</th>
              <td mat-cell *matCellDef="let row" class="num">{{ (row.spreadCents | cents | currency: 'USD') ?? '—' }}</td>
            </ng-container>
            <ng-container matColumnDef="volume">
              <th mat-header-cell *matHeaderCellDef class="num">Volume</th>
              <td mat-cell *matCellDef="let row" class="num">{{ row.volume | bigint }}</td>
            </ng-container>
            <ng-container matColumnDef="vwap">
              <th mat-header-cell *matHeaderCellDef class="num">VWAP</th>
              <td mat-cell *matCellDef="let row" class="num">{{ (row.vwapCents | cents | currency: 'USD') ?? '—' }}</td>
            </ng-container>
            <ng-container matColumnDef="imbalance">
              <th mat-header-cell *matHeaderCellDef class="num">Imbalance</th>
              <td mat-cell *matCellDef="let row" class="num">{{ (row.imbalance | number: '1.2-2') ?? '—' }}</td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
        </div>
      } @else {
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
      }
    </section>
  `,
})
export default class DashboardPage {
  protected readonly producer = inject(ProducerService);
  readonly columns = ['symbol', 'last', 'spread', 'volume', 'vwap', 'imbalance'] as const;
  protected readonly skeletonRows = [1, 2, 3, 4, 5];
  protected readonly canToggle = computed(() => ['running', 'paused'].includes(this.producer.status()));
  protected readonly trackBySymbol = (_: number, row: MetricsRow) => row.symbol;

  toggle(): void {
    if (this.producer.status() === 'running') this.producer.pause();
    else if (this.producer.status() === 'paused') this.producer.resume();
  }
}
