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
  spreads: number[];
}

export interface ChartCanvases {
  price: HTMLCanvasElement;
  spread: HTMLCanvasElement;
}

export interface PriceChartHandle {
  update(series: PriceSeries): void;
  destroy(): void;
}

/** Creates the price and spread charts. Default: Chart.js, imported lazily so it stays out of the main bundle. */
export const PRICE_CHART_FACTORY = new InjectionToken<(canvases: ChartCanvases) => Promise<PriceChartHandle>>('PRICE_CHART_FACTORY', {
  providedIn: 'root',
  factory: () => (canvases) => import('./chart-js').then((chartModule) => chartModule.createPriceCharts(canvases)),
});

export function toPriceSeries(events: TickerEvent[]): PriceSeries {
  return {
    sequences: events.map((event) => event.sequence),
    prices: events.map((event) => event.priceCents / 100),
    bids: events.map((event) => event.bidCents / 100),
    asks: events.map((event) => event.askCents / 100),
    spreads: events.map((event) => (event.askCents - event.bidCents) / 100),
  };
}

@Component({
  selector: 'app-price-chart',
  styleUrl: './price-chart.scss',
  templateUrl: './price-chart.html',
})
export class PriceChart {
  readonly events = input.required<TickerEvent[]>();
  private readonly priceCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('priceCanvas');
  private readonly spreadCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('spreadCanvas');
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
        const canvases = { price: this.priceCanvas().nativeElement, spread: this.spreadCanvas().nativeElement };
        void this.createChart(canvases).then((chart) => {
          if (destroyed) chart.destroy();
          else this.chart.set(chart);
        });
      });
    }
    effect(() => this.chart()?.update(toPriceSeries(this.events())));
  }
}
