import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  PLATFORM_ID,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import type { TickerEvent } from '../producer/protocol';

/** Chart points in dollars; x is the event's sequence number. */
export interface PriceSeries {
  sequences: number[];
  prices: number[];
  bids: number[];
  asks: number[];
}

export interface PriceChartHandle {
  update(series: PriceSeries): void;
  destroy(): void;
}

/** Creates the chart on a canvas. Default: Chart.js, imported lazily so it stays out of the main bundle. */
export const PRICE_CHART_FACTORY = new InjectionToken<(canvas: HTMLCanvasElement) => Promise<PriceChartHandle>>('PRICE_CHART_FACTORY', {
  providedIn: 'root',
  factory: () => (canvas) => import('./chart-js').then((chartModule) => chartModule.createPriceChart(canvas)),
});

export function toPriceSeries(events: TickerEvent[]): PriceSeries {
  return {
    sequences: events.map((event) => event.sequence),
    prices: events.map((event) => event.priceCents / 100),
    bids: events.map((event) => event.bidCents / 100),
    asks: events.map((event) => event.askCents / 100),
  };
}

@Component({
  selector: 'app-price-chart',
  styleUrl: './price-chart.scss',
  templateUrl: './price-chart.html',
})
export class PriceChart {
  readonly events = input.required<TickerEvent[]>();
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly createChart = inject(PRICE_CHART_FACTORY);
  private readonly chart = signal<PriceChartHandle | null>(null);

  constructor() {
    let destroyed = false;
    inject(DestroyRef).onDestroy(() => {
      destroyed = true;
      this.chart()?.destroy();
    });
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      afterNextRender(() => {
        void this.createChart(this.canvas().nativeElement).then((chart) => {
          if (destroyed) chart.destroy();
          else this.chart.set(chart);
        });
      });
    }
    effect(() => this.chart()?.update(toPriceSeries(this.events())));
  }
}
