import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { pageTest as test } from '../../testing/producer-fixtures';
import { emptyRow } from '../producer/protocol';
import DashboardPage from './index.page';

const ALFA = { symbol: 'ALFA', lastPriceCents: 10200, spreadCents: 4, volume: 40n, vwapCents: 10150, imbalance: 0.2 };
const GAMA = { symbol: 'GAMA', lastPriceCents: 9900, spreadCents: 2, volume: 500n, vwapCents: 9950, imbalance: -0.5 };

const bodyRows = () => within(screen.getByRole('table', { name: 'Instruments' })).getAllByRole('row').slice(1);
const symbols = () => bodyRows().map((row) => cellsOf(row)[0]);
const header = (name: string) => screen.getByRole('columnheader', { name: new RegExp(name) });
const cellsOf = (row: HTMLElement) => within(row).getAllByRole('cell').map((cell) => cell.textContent!.trim());

describe('DashboardPage', () => {
  test('U18 U19 renders one formatted row per instrument', async ({ producer, providers }) => {
    producer.rows.set([ALFA, emptyRow('BETA')]);
    await render(DashboardPage, { providers });
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent!.trim()))
      .toEqual(['Symbol', 'Last price', 'Spread', 'Volume', 'VWAP', 'Imbalance']);
    expect(bodyRows().map(cellsOf)).toEqual([
      ['ALFA', '$102.00', '$0.04', '40', '$101.50', '0.20'],
      ['BETA', '—', '—', '0', '—', '—'],
    ]);
  });

  test('U20 pauses when running', async ({ producer, providers }) => {
    await render(DashboardPage, { providers });
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(producer.pause).toHaveBeenCalledTimes(1);
  });

  test('U20 resumes when paused', async ({ producer, providers }) => {
    producer.status.set('paused');
    await render(DashboardPage, { providers });
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(producer.resume).toHaveBeenCalledTimes(1);
  });

  test.for(['initializing', 'error'] as const)('U20 disables the toggle while %s', async (status, { producer, providers }) => {
    producer.status.set(status);
    await render(DashboardPage, { providers });
    expect(screen.getByRole('button', { name: /pause|resume/i })).toBeDisabled();
  });

  test('U12 U21 shows status and error text', async ({ producer, providers }) => {
    producer.status.set('error');
    producer.error.set('Failed to load /producer.wasm: HTTP 404');
    await render(DashboardPage, { providers });
    expect(screen.getByRole('status')).toHaveTextContent(/error/i);
    expect(screen.getByRole('status')).toHaveTextContent('HTTP 404');
  });

  test('U22 shows a skeleton until the producer has started, heading always', async ({ producer, providers }) => {
    producer.started.set(false);
    await render(DashboardPage, { providers });
    expect(screen.getByRole('heading', { name: 'Market dashboard' })).toBeInTheDocument();
    expect(screen.getByLabelText('Loading market data')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pause|resume/i })).not.toBeInTheDocument();
  });

  test('U29 sorts by a column ascending, then descending, then back to list order', async ({ producer, providers }) => {
    producer.rows.set([ALFA, emptyRow('BETA'), GAMA]);
    await render(DashboardPage, { providers });
    await userEvent.click(header('Volume'));
    expect(symbols()).toEqual(['BETA', 'ALFA', 'GAMA']);
    expect(header('Volume')).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(header('Volume'));
    expect(symbols()).toEqual(['GAMA', 'ALFA', 'BETA']);
    await userEvent.click(header('Volume'));
    expect(symbols()).toEqual(['ALFA', 'BETA', 'GAMA']);
  });

  test.for(['ascending', 'descending'])('U29 rows without a value stay last when %s', async (direction, { producer, providers }) => {
    producer.rows.set([emptyRow('BETA'), ALFA, GAMA]);
    await render(DashboardPage, { providers });
    await userEvent.click(header('Imbalance'));
    if (direction === 'descending') await userEvent.click(header('Imbalance'));
    expect(symbols()).toEqual(direction === 'ascending' ? ['GAMA', 'ALFA', 'BETA'] : ['ALFA', 'GAMA', 'BETA']);
  });

  test('U29 new snapshots are re-sorted', async ({ producer, providers }) => {
    producer.rows.set([ALFA, GAMA]);
    const { fixture } = await render(DashboardPage, { providers });
    await userEvent.click(header('Spread'));
    producer.rows.set([{ ...ALFA, spreadCents: 1 }, GAMA]);
    await fixture.whenStable();
    expect(symbols()).toEqual(['ALFA', 'GAMA']);
  });

  test('U30 search filters by symbol, case-insensitive', async ({ producer, providers }) => {
    producer.rows.set([ALFA, emptyRow('BETA'), GAMA]);
    await render(DashboardPage, { providers });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search symbol' }), 'a');
    expect(symbols()).toEqual(['ALFA', 'BETA', 'GAMA']);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search symbol' }), 'm');
    expect(symbols()).toEqual(['GAMA']);
  });

  test('U30 shows a message when nothing matches', async ({ producer, providers }) => {
    producer.rows.set([ALFA]);
    await render(DashboardPage, { providers });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search symbol' }), 'zz');
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent('No instruments match "zz"');
  });
});
