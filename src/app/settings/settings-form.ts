import { WritableSignal, signal } from '@angular/core';
import { type FieldTree, type Schema, form, max, min, required, schema, validate } from '@angular/forms/signals';
import { SETTINGS_LIMITS, type ProducerSettings } from '../producer/protocol';

export type SettingsModel = Record<keyof ProducerSettings, number | null>;

const FIELDS = Object.keys(SETTINGS_LIMITS) as (keyof ProducerSettings)[];

/** Per field: required, integer, min and max from SETTINGS_LIMITS. */
export const settingsSchema: Schema<SettingsModel> = schema<SettingsModel>((p) => {
  for (const field of FIELDS) {
    const { min: lo, max: hi } = SETTINGS_LIMITS[field];
    const range = `Must be ${lo}–${hi}`;
    required(p[field], { message: 'Required' });
    validate(p[field], ({ value }) =>
      value() === null || Number.isInteger(value()) ? undefined : { kind: 'integer', message: 'Must be a whole number' },
    );
    min(p[field], lo, { message: range });
    max(p[field], hi, { message: range });
  }
});

/** Must run in an injection context (signal forms need an injector). */
export function createSettingsForm(initial: ProducerSettings): {
  model: WritableSignal<SettingsModel>;
  form: FieldTree<SettingsModel>;
} {
  const model = signal<SettingsModel>({ ...initial });
  return { model, form: form(model, settingsSchema) };
}

/** Call only when the form is valid. */
export function toSettings(model: SettingsModel): ProducerSettings {
  return {
    instrumentCount: Number(model.instrumentCount),
    updatesPerBatch: Number(model.updatesPerBatch),
    batchIntervalMs: Number(model.batchIntervalMs),
  };
}
