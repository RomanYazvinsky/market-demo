import { Chart, Filler, Legend, LineController, LineElement, LinearScale, PointElement, Ticks, Tooltip, type ChartDataset, type LinearScaleOptions } from 'chart.js';
import type { ChartCanvases, PriceChartHandle, PriceSeries } from './price-chart';

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend, Filler);

type Point = { x: number; y: number };

/** Resolves a Material color token (which may be a light-dark() value) to a color the canvas understands. */
function themeColor(canvas: HTMLCanvasElement, token: string): string {
  canvas.style.color = `var(${token})`;
  const color = getComputedStyle(canvas).color;
  canvas.style.color = '';
  return color;
}

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

type LineChart = Chart<'line', Point[]>;

function line(canvas: HTMLCanvasElement, label: string, token: string, extra: Partial<ChartDataset<'line', Point[]>>): ChartDataset<'line', Point[]> {
  return {
    label,
    data: [],
    borderColor: themeColor(canvas, token),
    backgroundColor: themeColor(canvas, token),
    borderWidth: 1,
    pointRadius: 0,
    ...extra,
  };
}

function lineChart(canvas: HTMLCanvasElement, datasets: ChartDataset<'line', Point[]>[], xTitle: boolean, beginAtZero: boolean): LineChart {
  return new Chart<'line', Point[]>(canvas, {
    type: 'line',
    data: { datasets },
    options: {
      animation: false,
      maintainAspectRatio: false,
      parsing: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      color: themeColor(canvas, '--mat-sys-on-surface'),
      scales: {
        x: { type: 'linear', ticks: { precision: 0 }, title: { display: xTitle, text: 'Event #' } },
        // Same width on both charts, so their x axes line up.
        y: { type: 'linear', beginAtZero, afterFit: (scale) => void (scale.width = 72), ticks: { callback: (value) => dollars.format(Number(value)) } },
      },
      plugins: {
        tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${dollars.format(item.parsed.y ?? 0)}` } },
      },
    },
  });
}

/** A price chart (trade, bid, ask) and a spread chart below it, sharing the event range. */
export function createPriceCharts(canvases: ChartCanvases): PriceChartHandle {
  const priceChart = lineChart(
    canvases.price,
    [
      line(canvases.price, 'Trade', '--mat-sys-on-surface', { showLine: false, pointRadius: 2 }),
      line(canvases.price, 'Bid', '--mat-sys-primary', { stepped: 'after' }),
      line(canvases.price, 'Ask', '--mat-sys-error', { stepped: 'after' }),
    ],
    false,
    false,
  );
  const spreadChart = lineChart(
    canvases.spread,
    [line(canvases.spread, 'Spread', '--mat-sys-tertiary', { stepped: 'after', fill: 'origin', backgroundColor: themeColor(canvases.spread, '--mat-sys-tertiary-container') })],
    true,
    true,
  );
  return {
    update(series: PriceSeries) {
      const points = (values: number[]) => values.map((value, index) => ({ x: series.xs[index], y: value }));
      priceChart.data.datasets[0].data = points(series.prices);
      priceChart.data.datasets[1].data = points(series.bids);
      priceChart.data.datasets[2].data = points(series.asks);
      spreadChart.data.datasets[0].data = points(series.spreads);
      const time = series.axis === 'time';
      for (const chart of [priceChart, spreadChart]) {
        chart.options.scales!['x']!.min = series.xMin;
        chart.options.scales!['x']!.max = series.xMax;
        const x = chart.options.scales!['x'] as LinearScaleOptions;
        x.title.text = time ? 'Time' : 'Event #';
        x.ticks.callback = time
          ? (value) => clock.format(Number(value))
          : function (value, index, ticks) {
              return Ticks.formatters.numeric.call(this, Number(value), index, ticks);
            };
        x.ticks.precision = 0;
        chart.update('none');
      }
    },
    destroy() {
      priceChart.destroy();
      spreadChart.destroy();
    },
  };
}
