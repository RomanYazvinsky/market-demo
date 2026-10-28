import { WritableSignal } from '@angular/core';
import { type FieldTree, type Schema, schema } from '@angular/forms/signals';
import type { ProducerSettings } from '../producer/protocol';

export type SettingsModel = Record<keyof ProducerSettings, number | null>;

export const settingsSchema: Schema<SettingsModel> = schema<SettingsModel>(() => {});

export function createSettingsForm(initial: ProducerSettings): {
  model: WritableSignal<SettingsModel>;
  form: FieldTree<SettingsModel>;
} {
  void initial;
  throw new Error('not implemented');
}

/** Call only when the form is valid. */
export function toSettings(model: SettingsModel): ProducerSettings {
  void model;
  throw new Error('not implemented');
}
