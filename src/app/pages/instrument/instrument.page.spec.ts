import type { EnvironmentProviders, Provider } from '@angular/core';
import { ActivatedRoute, convertToParamMap, type ParamMap } from '@angular/router';
import { render, screen } from '@testing-library/angular';
import { BehaviorSubject } from 'rxjs';
import { pageTest as test } from '../../../testing/producer-fixtures';
import { PRICE_CHART_FACTORY } from '../../instrument/price-chart';
import { emptyRow, type TickerEvent } from '../../producer/protocol';
import InstrumentPage from './[symbol].page';

const EVENT: TickerEvent = { sequence: 7, timeMs: 0, priceCents: 10200, quantity: 30, bidCents: 10196, askCents: 10200, bidQty: 600, askQty: 400 };

const renderPage = async (providers: Array<Provider | EnvironmentProviders>, symbol = 'AAPL') => {
  const params = new BehaviorSubject<ParamMap>(convertToParamMap({ symbol }));
  const view = await render(InstrumentPage, {
    providers: [
      ...providers,
      { provide: ActivatedRoute, useValue: { paramMap: params } },
      { provide: PRICE_CHART_FACTORY, useValue: async () => ({ update() {}, destroy() {} }) },
    ],
  });
  return { ...view, params };
};

describe('InstrumentPage', () => {
  test('U35 watches the symbol while open and stops on leave', async ({ producer, providers }) => {
    const { fixture } = await renderPage(providers);
    expect(producer.watch).toHaveBeenLastCalledWith('AAPL');
    fixture.destroy();
    expect(producer.watch).toHaveBeenLastCalledWith(null);
  });

  test('U35 follows the symbol when the route param changes', async ({ producer, providers }) => {
    producer.rows.set([emptyRow('AAPL'), emptyRow('MSFT')]);
    const { fixture, params } = await renderPage(providers);
    params.next(convertToParamMap({ symbol: 'MSFT' }));
    await fixture.whenStable();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('MSFT');
    expect(producer.watch).toHaveBeenLastCalledWith('MSFT');
  });

  test('U35 shows chart and events of the watched symbol', async ({ producer, providers }) => {
    producer.rows.set([emptyRow('AAPL')]);
    producer.watched.set({ symbol: 'AAPL', events: [EVENT] });
    await renderPage(providers);
    expect(screen.getByLabelText('Price chart')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Events' })).toHaveTextContent('$102.00');
  });

  test('U35 shows no events of another symbol', async ({ producer, providers }) => {
    producer.rows.set([emptyRow('AAPL')]);
    producer.watched.set({ symbol: 'MSFT', events: [EVENT] });
    await renderPage(providers);
    expect(screen.getByRole('table', { name: 'Events' })).toHaveTextContent('No events yet');
  });

  test('U35 shows a message for a symbol outside the run', async ({ producer, providers }) => {
    producer.rows.set([emptyRow('MSFT')]);
    await renderPage(providers);
    expect(screen.getByText(/not in the current run/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute('href', '/settings');
    expect(screen.queryByLabelText('Price chart')).not.toBeInTheDocument();
  });

  test('U35 shows a skeleton until the producer has started, heading always', async ({ producer, providers }) => {
    producer.started.set(false);
    await renderPage(providers);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('AAPL');
    expect(screen.getByLabelText('Loading instrument data')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
