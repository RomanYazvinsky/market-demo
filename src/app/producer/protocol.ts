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

/** How many of an instrument's latest updates the worker keeps for the instrument page. */
export const EVENT_LOG_SIZE = 100;

/** One market update of an instrument, numbered across the run and stamped with its batch time. */
export interface TickerEvent {
  sequence: number;
  timeMs: number;
  priceCents: number;
  quantity: number;
  bidCents: number;
  askCents: number;
  bidQty: number;
  askQty: number;
}

/** The watched symbol's latest events, oldest first. */
export interface WatchedEvents {
  symbol: string;
  events: TickerEvent[];
}

/** A trade at the ask is a buy, at the bid a sell. */
export function tradeSide(event: TickerEvent): 'buy' | 'sell' {
  return event.priceCents === event.askCents ? 'buy' : 'sell';
}

/** UI -> worker. `runId` increases with every apply; pause/resume carry the current one. */
export type ToWorker =
  | { type: 'apply'; runId: number; config: ProducerConfig }
  | { type: 'pause'; runId: number }
  | { type: 'resume'; runId: number }
  /** The symbol an instrument page shows, or null. UI state, so it has no runId and survives apply. */
  | { type: 'watch'; symbol: string | null };

/** Worker -> UI. Every message carries the runId it belongs to; the UI drops other runs. */
export type FromWorker =
  | { type: 'status'; runId: number; status: ProducerStatus; error?: string }
  | { type: 'snapshot'; runId: number; rows: MetricsRow[]; watched: WatchedEvents | null };
