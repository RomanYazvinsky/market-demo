import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSortModule, type Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import type { MetricsRow } from '../producer/protocol';
import { BigIntPipe } from '../shared/bigint.pipe';
import { CentsPipe } from '../shared/cents.pipe';

const SORT_KEYS = {
  symbol: 'symbol',
  last: 'lastPriceCents',
  spread: 'spreadCents',
  volume: 'volume',
  vwap: 'vwapCents',
  imbalance: 'imbalance',
} as const satisfies Record<string, keyof MetricsRow>;

type Column = keyof typeof SORT_KEYS;

@Component({
  selector: 'app-market-table',
  imports: [MatTableModule, RouterLink, MatSortModule, MatFormFieldModule, MatInputModule, CurrencyPipe, DecimalPipe, CentsPipe, BigIntPipe],
  host: { class: 'flex flex-col gap-3' },
  styleUrl: './market-table.scss',
  templateUrl: './market-table.html',
})
export class MarketTable {
  readonly rows = input.required<MetricsRow[]>();
  protected readonly columns = Object.keys(SORT_KEYS) as Column[];
  protected readonly query = signal('');
  protected readonly sort = signal<Sort>({ active: '', direction: '' });
  protected readonly trackBySymbol = (_: number, row: MetricsRow) => row.symbol;

  protected readonly visibleRows = computed(() => {
    const query = this.query().trim().toUpperCase();
    const matching = query ? this.rows().filter((row) => row.symbol.includes(query)) : this.rows();
    const { active, direction } = this.sort();
    if (!direction) return matching;
    const key = SORT_KEYS[active as Column];
    const sign = direction === 'asc' ? 1 : -1;
    return [...matching].sort((left, right) => compareNullsLast(left[key], right[key], sign));
  });
}

/** Rows without a value stay at the end in both directions. */
function compareNullsLast<T extends string | number | bigint | null>(left: T, right: T, sign: number): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return (left < right ? -1 : 1) * sign;
}
