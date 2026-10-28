import type { ProducerConfig, ProducerSettings } from './protocol';

/**
 * Builds the worker config from the form settings and the instrument list
 * (public/resources/sp500.json). The first `instrumentCount` tickers become the run's
 * instruments; index i in a wasm update maps to `symbols[i]`.
 */
export function toProducerConfig(settings: ProducerSettings, all: readonly string[]): ProducerConfig {
  return {
    symbols: all.slice(0, settings.instrumentCount),
    updatesPerBatch: settings.updatesPerBatch,
    batchIntervalMs: settings.batchIntervalMs,
  };
}
