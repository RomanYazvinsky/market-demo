import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  InjectionToken,
  PLATFORM_ID,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import type { PricePoint, TickerEvent } from '../../producer/protocol';

/** Live: the last 100 updates; the time windows: one point per second. */
export type ChartWindow = 'live' | 'last60s' | 'last5m';

const WINDOW_MS = { last60s: 60_000, last5m: 300_000 } as const;

/** Chart points in dollars; x is the event's sequence number (`event`) or its time in ms (`time`). */
export interface PriceSeries {
  axis: 'event' | 'time';
  xMin: number | undefined;
  xMax: number | undefined;
  xs: number[];
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

function dollarSeries(quotes: Array<{ priceCents: number; bidCents: number; askCents: number }>) {
  return {
    prices: quotes.map((quote) => quote.priceCents / 100),
    bids: quotes.map((quote) => quote.bidCents / 100),
    asks: quotes.map((quote) => quote.askCents / 100),
    spreads: quotes.map((quote) => (quote.askCents - quote.bidCents) / 100),
  };
}

export function toPriceSeries(events: TickerEvent[]): PriceSeries {
  const xs = events.map((event) => event.sequence);
  return { axis: 'event', xMin: xs.at(0), xMax: xs.at(-1), xs, ...dollarSeries(events) };
}

/** The points of the `windowMs` that ends at the newest point. */
export function _toTimeSeries(points: PricePoint[], windowMs: number): PriceSeries {
  const end = points.at(-1)?.timeMs;
  const inWindow = end === undefined ? [] : points.filter((point) => point.timeMs > end - windowMs);
  return {
    axis: 'time',
    xMin: end === undefined ? undefined : end - windowMs,
    xMax: end,
    xs: inWindow.map((point) => point.timeMs),
    ...dollarSeries(inWindow),
  };
}

@Component({
  selector: 'app-price-chart',
  styleUrl: './price-chart.scss',
  templateUrl: './price-chart.html',
})
export class PriceChart {
  readonly events = input.required<TickerEvent[]>();
  readonly seconds = input<PricePoint[]>([]);
  readonly window = input<ChartWindow>('live');
  private readonly series = computed(() => {
    const window = this.window();
    return window === 'live' ? toPriceSeries(this.events()) : _toTimeSeries(this.seconds(), WINDOW_MS[window]);
  });
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
    effect(() => this.chart()?.update(this.series()));
  }
}
