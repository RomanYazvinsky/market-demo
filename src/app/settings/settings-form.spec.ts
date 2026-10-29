import { TestBed } from '@angular/core/testing';
import { test as base } from 'vitest';
import { DEFAULT_SETTINGS } from '../producer/protocol';
import { createSettingsForm, toSettings, type SettingsModel } from './settings-form';

type Field = keyof SettingsModel;

// Signal forms' form() needs an injector, as it would have inside a component.
const test = base.extend<{ settings: ReturnType<typeof createSettingsForm> }>({
  settings: async ({}, use) => use(TestBed.runInInjectionContext(() => createSettingsForm(DEFAULT_SETTINGS))),
});

const set = ({ model }: ReturnType<typeof createSettingsForm>, field: Field, value: unknown) =>
  model.update((current) => ({ ...current, [field]: value as number }));

describe('settings form', () => {
  test('U01 U17 defaults are valid and round-trip', ({ settings }) => {
    expect(settings.form().valid()).toBe(true);
    expect(toSettings(settings.model())).toEqual(DEFAULT_SETTINGS);
  });

  test.for<[Field, number]>([
    ['instrumentCount', 1], ['instrumentCount', 50],
    ['updatesPerBatch', 1], ['updatesPerBatch', 1000],
    ['batchIntervalMs', 50], ['batchIntervalMs', 2000],
  ])('U17 %s = %s is valid', ([field, value], { settings }) => {
    set(settings, field, value);
    expect(settings.form[field]().valid()).toBe(true);
  });

  test.for<[Field, number]>([
    ['instrumentCount', 0], ['instrumentCount', 51],
    ['updatesPerBatch', 0], ['updatesPerBatch', 1001],
    ['batchIntervalMs', 49], ['batchIntervalMs', 2001],
  ])('U17 %s = %s is out of range', ([field, value], { settings }) => {
    set(settings, field, value);
    expect(settings.form[field]().invalid()).toBe(true);
  });

  test.for([1.5, null, Number.NaN])('U17 rejects non-integers and empty: %s', (value, { settings }) => {
    set(settings, 'updatesPerBatch', value);
    expect(settings.form.updatesPerBatch().invalid()).toBe(true);
    expect(settings.form().valid()).toBe(false);
  });

  test('U18 the integer error has a readable message', ({ settings }) => {
    set(settings, 'instrumentCount', 2.5);
    expect(settings.form.instrumentCount().errors()).toContainEqual(
      expect.objectContaining({ kind: 'integer', message: 'Must be a whole number' }),
    );
  });
});
