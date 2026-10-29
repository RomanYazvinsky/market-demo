import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { pageTest as test } from '../testing/producer-fixtures';
import { App } from './app';
import DashboardPage from './pages/index.page';
import SettingsPage from './pages/settings.page';

describe('App shell', () => {
  test('U22 navigation links are always present', async ({ providers }) => {
    await render(App, { providers });
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  test('U07 U44 loads the producer after render, in the browser, without starting a run', async ({ producer, providers }) => {
    await render(App, { providers });
    expect(producer.load).toHaveBeenCalledTimes(1);
    expect(producer.start).not.toHaveBeenCalled();
  });

  test('U06 navigating between pages keeps a single producer', async ({ producer, providers }) => {
    await render(App, {
      providers,
      routes: [
        { path: '', component: DashboardPage },
        { path: 'settings', component: SettingsPage },
      ],
    });
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Producer settings' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Market dashboard' })).toBeInTheDocument();
    expect(producer.load).toHaveBeenCalledTimes(1);
  });
});
