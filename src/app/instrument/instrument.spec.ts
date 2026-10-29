import { DATE_PIPE_DEFAULT_OPTIONS } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { render, screen, within } from '@testing-library/angular';
import type { TickerEvent } from '../producer/protocol';
import { EventTable } from './event-table';
import { PRICE_CHART_FACTORY, PriceChart, toPriceSeries, type ChartCanvases, type PriceChartHandle, type PriceSeries } from './price-chart';

const BUY: TickerEvent = {
  sequence: 2, timeMs: Date.UTC(2026, 9, 29, 12, 0, 5), priceCents: 10200, quantity: 30,
  bidCents: 10196, askCents: 10200, bidQty: 600, askQty: 400,
};
const SELL: TickerEvent = { ...BUY, sequence: 5, timeMs: BUY.timeMs + 250, priceCents: 10196, quantity: 7, bidQty: 593 };

class FakeChart implements PriceChartHandle {
  readonly updates: PriceSeries[] = [];
  destroyed = false;
  update(series: PriceSeries) { this.updates.push(series); }
  destroy() { this.destroyed = true; }
}

describe('toPriceSeries', () => {
  it('U34 U38 maps events to price, bid, ask and spread series in dollars', () => {
    expect(toPriceSeries([BUY, SELL])).toEqual({
      sequences: [2, 5], prices: [102, 101.96], bids: [101.96, 101.96], asks: [102, 102], spreads: [0.04, 0.04],
    });
  });
});

describe('PriceChart', () => {
  const setup = async (platform = 'browser') => {
    const charts: FakeChart[] = [];
    const canvases: ChartCanvases[] = [];
    const factory = async (chartCanvases: ChartCanvases) => {
      canvases.push(chartCanvases);
      const chart = new FakeChart();
      charts.push(chart);
      return chart;
    };
    const view = await render(PriceChart, {
      inputs: { events: [BUY] },
      providers: [{ provide: PRICE_CHART_FACTORY, useValue: factory }, { provide: PLATFORM_ID, useValue: platform }],
    });
    await view.fixture.whenStable();
    return { ...view, charts, canvases };
  };

  it('U34 U38 creates the price and spread charts after render and updates them with new events', async () => {
    const { charts, canvases, fixture } = await setup();
    expect(canvases).toEqual([{ price: screen.getByLabelText('Price chart'), spread: screen.getByLabelText('Spread chart') }]);
    expect(charts[0].updates.at(-1)!.sequences).toEqual([2]);
    fixture.componentRef.setInput('events', [BUY, SELL]);
    await fixture.whenStable();
    expect(charts[0].updates.at(-1)!.sequences).toEqual([2, 5]);
  });

  it('U34 destroys the chart with the component', async () => {
    const { charts, fixture } = await setup();
    fixture.destroy();
    expect(charts[0].destroyed).toBe(true);
  });

  it('U34 does not create a chart on the server', async () => {
    const { charts } = await setup('server');
    expect(charts).toEqual([]);
  });
});

describe('EventTable', () => {
  it('U33 lists events newest first with formatted columns', async () => {
    await render(EventTable, {
      inputs: { events: [BUY, SELL] },
      providers: [{ provide: DATE_PIPE_DEFAULT_OPTIONS, useValue: { timezone: 'UTC' } }],
    });
    const table = screen.getByRole('table', { name: 'Events' });
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent!.trim()))
      .toEqual(['#', 'Time', 'Side', 'Price', 'Qty', 'Bid', 'Ask']);
    const cells = within(table).getAllByRole('row').slice(1)
      .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent!.trim()));
    expect(cells).toEqual([
      ['5', '12:00:05.250', 'Sell', '$101.96', '7', '$101.96 × 593', '$102.00 × 400'],
      ['2', '12:00:05.000', 'Buy', '$102.00', '30', '$101.96 × 600', '$102.00 × 400'],
    ]);
  });

  it('U33 says when there are no events yet', async () => {
    await render(EventTable, { inputs: { events: [] } });
    expect(screen.getByRole('table', { name: 'Events' })).toHaveTextContent('No events yet');
  });
});
