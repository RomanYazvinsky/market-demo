import { CurrencyPipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { RouteMeta } from '@analogjs/router';
import { map } from 'rxjs';
import { ProducerToggle } from '../../dashboard/producer-toggle';
import { StatusBadge } from '../../dashboard/status-badge';
import { EventTable } from '../../instrument/event-table';
import { PriceChart, type ChartWindow } from '../../instrument/price-chart';
import { EVENT_LOG_SIZE } from '../../producer/protocol';
import { ProducerService } from '../../producer/producer.service';
import { CentsPipe } from '../../shared/cents.pipe';
import { instrumentLabel } from '../../shared/instrument-label';

export const routeMeta: RouteMeta = { title: 'Instrument' };

@Component({
  selector: 'app-instrument-page',
  imports: [RouterLink, CurrencyPipe, CentsPipe, ProducerToggle, StatusBadge, MatButtonToggleModule, PriceChart, EventTable],
  host: { class: 'block' },
  templateUrl: './[symbol].page.html',
})
export default class InstrumentPage {
  protected readonly producer = inject(ProducerService);
  protected readonly eventLogSize = EVENT_LOG_SIZE;
  /** The router reuses this page between symbols, so the symbol is a signal of the param. */
  protected readonly symbol = toSignal(inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('symbol') ?? '')), {
    requireSync: true,
  });
  protected readonly label = computed(() => instrumentLabel(this.symbol(), this.producer.names()));
  protected readonly row = computed(() => this.producer.rows().find((row) => row.symbol === this.symbol()));
  protected readonly inRun = computed(() => this.row() !== undefined);
  private readonly watched = computed(() => {
    const watched = this.producer.watched();
    return watched?.symbol === this.symbol() ? watched : null;
  });
  protected readonly events = computed(() => this.watched()?.events ?? []);
  protected readonly seconds = computed(() => this.watched()?.seconds ?? []);
  protected readonly chartWindow = signal<ChartWindow>('live');

  constructor() {
    effect(() => this.producer.watch(this.symbol()));
    inject(DestroyRef).onDestroy(() => this.producer.watch(null));
  }
}
