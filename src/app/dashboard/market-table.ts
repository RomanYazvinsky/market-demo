import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import type { MetricsRow } from '../producer/protocol';
import { BigIntPipe } from '../shared/bigint.pipe';
import { CentsPipe } from '../shared/cents.pipe';

@Component({
  selector: 'app-market-table',
  imports: [MatTableModule, CurrencyPipe, DecimalPipe, CentsPipe, BigIntPipe],
  styleUrl: './market-table.scss',
  template: `
    <div class="wrap">
      <table mat-table [dataSource]="rows()" [trackBy]="trackBySymbol" aria-label="Instruments">
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
  `,
})
export class MarketTable {
  readonly rows = input.required<MetricsRow[]>();
  protected readonly columns = ['symbol', 'last', 'spread', 'volume', 'vwap', 'imbalance'] as const;
  protected readonly trackBySymbol = (_: number, row: MetricsRow) => row.symbol;
}
