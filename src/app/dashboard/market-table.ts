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
  templateUrl: './market-table.html',
})
export class MarketTable {
  readonly rows = input.required<MetricsRow[]>();
  protected readonly columns = ['symbol', 'last', 'spread', 'volume', 'vwap', 'imbalance'] as const;
  protected readonly trackBySymbol = (_: number, row: MetricsRow) => row.symbol;
}
