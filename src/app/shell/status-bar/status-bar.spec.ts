import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { pageTest as test } from '../../../testing/producer-fixtures';
import { StatusBar } from './status-bar';

describe('StatusBar', () => {
  test('U34 shows the status, the run time, the run control and a settings link', async ({ providers }) => {
    await render(StatusBar, { providers });
    expect(screen.getByRole('status')).toHaveTextContent(/running/i);
    expect(screen.getByLabelText('Run time')).toHaveTextContent('0:00');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  test.for([[65_000, '1:05'], [3_725_000, '1:02:05']] as const)('U35 shows %i ms of run time as %s', async ([elapsedMs, text], { producer, providers }) => {
    producer.elapsedMs.set(elapsedMs);
    await render(StatusBar, { providers });
    expect(screen.getByLabelText('Run time')).toHaveTextContent(text);
  });

  test('U15 pauses when running', async ({ producer, providers }) => {
    await render(StatusBar, { providers });
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(producer.pause).toHaveBeenCalledTimes(1);
  });

  test('U15 resumes when paused', async ({ producer, providers }) => {
    producer.status.set('paused');
    await render(StatusBar, { providers });
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(producer.resume).toHaveBeenCalledTimes(1);
  });

  test.for(['initializing', 'error'] as const)('U15 disables the toggle while %s', async (status, { producer, providers }) => {
    producer.status.set(status);
    await render(StatusBar, { providers });
    expect(screen.getByRole('button', { name: /pause|resume/i })).toBeDisabled();
  });

  test('U33 before the first run shows Idle and a Start button', async ({ producer, providers }) => {
    producer.status.set('idle');
    await render(StatusBar, { providers });
    expect(screen.getByRole('status')).toHaveTextContent(/idle/i);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(producer.start).toHaveBeenCalledTimes(1);
    expect(producer.pause).not.toHaveBeenCalled();
  });

  test('U07 U16 shows status and error text', async ({ producer, providers }) => {
    producer.status.set('error');
    producer.error.set('Failed to load /producer.wasm: HTTP 404');
    await render(StatusBar, { providers });
    expect(screen.getByRole('status')).toHaveTextContent(/error/i);
    expect(screen.getByRole('status')).toHaveTextContent('HTTP 404');
  });
});
