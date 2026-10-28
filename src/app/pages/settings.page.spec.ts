import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
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
      await userEvent.click(applyButton());
      expect(producer.apply).not.toHaveBeenCalled();
    },
  );

  test('U24 shows a readable error after the field is touched', async ({ providers }) => {
    await render(SettingsPage, { providers });
    await retype('Instrument count', '51');
    await userEvent.tab();
    expect(await screen.findByText(/1.?50/)).toBeInTheDocument();
  });
});
