import { render, screen } from '@testing-library/angular';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { pageTest as test } from '../../testing/producer-fixtures';
import { DEFAULT_SETTINGS } from '../producer/protocol';
import SettingsPage from './settings.page';

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const retype = async (label: string, value: string) => {
  await userEvent.clear(field(label));
  if (value) await userEvent.type(field(label), value);
};
const applyButton = () => screen.getByRole('button', { name: 'Apply' });

describe('SettingsPage', () => {
  test('U05 shows current settings', async ({ providers }) => {
    await render(SettingsPage, { providers });
    expect(field('Instrument count')).toHaveValue(5);
    expect(field('Updates per batch')).toHaveValue(100);
    expect(field('Batch interval (ms)')).toHaveValue(500);
  });

  test('U25 editing does not affect the producer', async ({ producer, providers }) => {
    await render(SettingsPage, { providers });
    await retype('Instrument count', '10');
    expect(producer.apply).not.toHaveBeenCalled();
  });

  test('U25 Apply sends the edited settings once', async ({ producer, providers }) => {
    await render(SettingsPage, { providers });
    await retype('Instrument count', '10');
    await userEvent.click(applyButton());
    expect(producer.apply).toHaveBeenCalledTimes(1);
    expect(producer.apply).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, instrumentCount: 10 });
  });

  test.for([['Batch interval (ms)', '10'], ['Batch interval (ms)', '1.5'], ['Updates per batch', '']])(
    'U26 apply disabled while invalid: %s = "%s"',
    async ([label, value], { producer, providers }) => {
      await render(SettingsPage, { providers });
      await retype(label, value);
      expect(applyButton()).toBeDisabled();
      // Material gives disabled buttons pointer-events: none, which userEvent refuses to click through.
      await userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never }).click(applyButton());
      expect(producer.apply).not.toHaveBeenCalled();
    },
  );

  test('U42 Apply shows a confirmation that disappears after 3 seconds', async ({ providers }) => {
    vi.useFakeTimers();
    try {
      const { fixture } = await render(SettingsPage, { providers });
      expect(screen.queryByText('Settings applied')).not.toBeInTheDocument();
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(applyButton());
      expect(screen.getByRole('status')).toHaveTextContent('Settings applied');
      await vi.advanceTimersByTimeAsync(2_999);
      fixture.detectChanges();
      expect(screen.getByText('Settings applied')).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(1);
      fixture.detectChanges();
      expect(screen.queryByText('Settings applied')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  test('U24 shows a readable error after the field is touched', async ({ providers }) => {
    await render(SettingsPage, { providers });
    await retype('Instrument count', '51');
    await userEvent.tab();
    expect(await screen.findByText(/1.?50/)).toBeInTheDocument();
  });
});
