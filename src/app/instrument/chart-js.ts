import { Chart, Legend, LineController, LineElement, LinearScale, PointElement, Tooltip, type ChartDataset } from 'chart.js';
import type { PriceChartHandle, PriceSeries } from './price-chart';

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend);

type Point = { x: number; y: number };

/** Resolves a Material color token (which may be a light-dark() value) to a color the canvas understands. */
function themeColor(canvas: HTMLCanvasElement, token: string): string {
  canvas.style.color = `var(${token})`;
  const color = getComputedStyle(canvas).color;
  canvas.style.color = '';
  return color;
}

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function createPriceChart(canvas: HTMLCanvasElement): PriceChartHandle {
  const line = (label: string, token: string, extra: Partial<ChartDataset<'line', Point[]>>): ChartDataset<'line', Point[]> => ({
    label,
    data: [],
    borderColor: themeColor(canvas, token),
    backgroundColor: themeColor(canvas, token),
    borderWidth: 1,
    pointRadius: 0,
    ...extra,
  });
  const chart = new Chart<'line', Point[]>(canvas, {
    type: 'line',
    data: {
      datasets: [
        line('Trade', '--mat-sys-on-surface', { showLine: false, pointRadius: 2 }),
        line('Bid', '--mat-sys-primary', { stepped: 'after' }),
        line('Ask', '--mat-sys-error', { stepped: 'after' }),
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      parsing: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      color: themeColor(canvas, '--mat-sys-on-surface'),
      scales: {
        x: { type: 'linear', ticks: { precision: 0 }, title: { display: true, text: 'Event #' } },
        y: { type: 'linear', ticks: { callback: (value) => dollars.format(Number(value)) } },
      },
      plugins: {
        tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${dollars.format(item.parsed.y ?? 0)}` } },
      },
    },
  });
  return {
    update(series: PriceSeries) {
      const points = (values: number[]) => values.map((value, index) => ({ x: series.sequences[index], y: value }));
      chart.data.datasets[0].data = points(series.prices);
      chart.data.datasets[1].data = points(series.bids);
      chart.data.datasets[2].data = points(series.asks);
      chart.options.scales!['x']!.min = series.sequences.at(0);
      chart.options.scales!['x']!.max = series.sequences.at(-1);
      chart.update('none');
    },
    destroy: () => chart.destroy(),
  };
}
