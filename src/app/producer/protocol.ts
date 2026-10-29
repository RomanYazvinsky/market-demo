export interface ProducerSettings {
  instrumentCount: number;
  updatesPerBatch: number;
  batchIntervalMs: number;
}

export const DEFAULT_SETTINGS: ProducerSettings = {
  instrumentCount: 5,
  updatesPerBatch: 100,
  batchIntervalMs: 500,
};

export const SETTINGS_LIMITS = {
  instrumentCount: { min: 1, max: 50 },
  updatesPerBatch: { min: 1, max: 1000 },
  batchIntervalMs: { min: 50, max: 2000 },
} as const satisfies Record<keyof ProducerSettings, { min: number; max: number }>;

export const FIELDS_PER_UPDATE = 7;

/** Field offsets inside one 7-int update. */
export const FIELD = {
  instrument: 0, price: 1, tradeQty: 2, bid: 3, ask: 4, bidQty: 5, askQty: 6,
} as const;

/**
 * What the worker runs with. Built on the UI side from ProducerSettings:
 * `symbols` is the S&P 500 list sliced to instrumentCount, so `symbols.length`
 * is the instrument count and index i in a wasm update maps to `symbols[i]`.
 */
export interface ProducerConfig {
  symbols: string[];
  updatesPerBatch: number;
  batchIntervalMs: number;
}

export type ProducerStatus = 'initializing' | 'running' | 'paused' | 'error';

export interface MetricsRow {
  symbol: string;
  lastPriceCents: number | null;
  spreadCents: number | null;
  volume: bigint;
  vwapCents: number | null;
  imbalance: number | null;
}

export function emptyRow(symbol: string): MetricsRow {
  return { symbol, lastPriceCents: null, spreadCents: null, volume: 0n, vwapCents: null, imbalance: null };
}

/** UI -> worker. `runId` increases with every apply; pause/resume carry the current one. */
export type ToWorker =
  | { type: 'apply'; runId: number; config: ProducerConfig }
  | { type: 'pause'; runId: number }
  | { type: 'resume'; runId: number };

/** Worker -> UI. Every message carries the runId it belongs to; the UI drops other runs. */
export type FromWorker =
  | { type: 'status'; runId: number; status: ProducerStatus; error?: string }
  | { type: 'snapshot'; runId: number; rows: MetricsRow[] };
