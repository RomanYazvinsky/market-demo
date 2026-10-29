import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import { tradeSide, type TickerEvent } from '../../producer/protocol';
import { CentsPipe } from '../../shared/cents.pipe';

@Component({
  selector: 'app-event-table',
  imports: [MatTableModule, CurrencyPipe, DatePipe, DecimalPipe, CentsPipe],
  styleUrl: './event-table.scss',
  templateUrl: './event-table.html',
})
export class EventTable {
  /** Oldest first, as the worker sends them. */
  readonly events = input.required<TickerEvent[]>();
  protected readonly newestFirst = computed(() => [...this.events()].reverse());
  protected readonly columns = ['sequence', 'time', 'side', 'price', 'quantity', 'bid', 'ask'];
  protected readonly tradeSide = tradeSide;
  protected readonly trackBySequence = (_: number, event: TickerEvent) => event.sequence;
}
