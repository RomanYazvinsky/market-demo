import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { test as base } from 'vitest';
import { FakeWorker } from '../../testing/producer-fixtures';
import { INSTRUMENT_SYMBOLS_LOADER, PRODUCER_WORKER_LOADER, ProducerService, type Instrument } from './producer.service';
import { DEFAULT_SETTINGS, emptyRow, type MetricsRow, type TickerEvent } from './protocol';
import { toProducerConfig } from './symbols';

const SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META'];
const INSTRUMENTS = SYMBOLS.map((symbol) => ({ symbol, name: `${symbol} Inc.` }));
const configFor = (settings: typeof DEFAULT_SETTINGS) => toProducerConfig(settings, SYMBOLS);

const test = base.extend<{
  platform: string;
  workers: FakeWorker[];
  loader: () => Promise<Worker>;
  symbolsLoader: () => Promise<readonly Instrument[]>;
  svc: ProducerService;
}>({
  platform: 'browser',
  workers: async ({}, use) => use([]),
  loader: async ({ workers }, use) =>
    use(async () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    }),
  symbolsLoader: async ({}, use) => use(async () => INSTRUMENTS),
  svc: async ({ platform, loader, symbolsLoader }, use) => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: platform },
        { provide: PRODUCER_WORKER_LOADER, useValue: loader },
        { provide: INSTRUMENT_SYMBOLS_LOADER, useValue: symbolsLoader },
      ],
    });
    await use(TestBed.inject(ProducerService));
  },
});

const EVENT: TickerEvent = { sequence: 1, timeMs: 0, priceCents: 10200, quantity: 30, bidCents: 10196, askCents: 10200, bidQty: 600, askQty: 400 };

const loadAndStart = async (svc: ProducerService) => {
  await svc.load();
  svc.start();
};

const rows = (count: number, volume = 0n): MetricsRow[] =>
  SYMBOLS.slice(0, count).map((settings) => ({ ...emptyRow(settings), volume }));

describe('ProducerService', () => {
  test('U01 starts with defaults and empty rows, not started', ({ svc }) => {
    expect(svc.status()).toBe('initializing');
    expect(svc.error()).toBeNull();
    expect(svc.ready()).toBe(false);
    expect(svc.settings()).toEqual(DEFAULT_SETTINGS);
    expect(svc.rows()).toEqual([]);
  });

  test('U01 U02 U33 load loads exactly one worker and starts no run', async ({ svc, workers }) => {
    await Promise.all([svc.load(), svc.load()]);
    await svc.load();
    expect(workers).toHaveLength(1);
    expect(workers[0].sent).toEqual([]);
    expect(svc.status()).toBe('idle');
    expect(svc.ready()).toBe(true);
    expect(svc.rows()).toEqual(rows(5));
  });

  test('U09 U33 start runs the current settings', async ({ svc, workers }) => {
    await svc.load();
    svc.start();
    expect(workers[0].sent).toEqual([{ type: 'apply', runId: 1, config: configFor(DEFAULT_SETTINGS) }]);
    expect(svc.status()).toBe('initializing');
  });

  test('U33 Apply before Start starts the run with the new settings', async ({ svc, workers }) => {
    await svc.load();
    const next = { ...DEFAULT_SETTINGS, instrumentCount: 3 };
    svc.apply(next);
    expect(workers[0].sent).toEqual([{ type: 'apply', runId: 1, config: configFor(next) }]);
  });
});

describe('ProducerService (names)', () => {
  test('U32 exposes the instrument names once the list is loaded', async ({ svc }) => {
    expect(svc.names().size).toBe(0);
    await loadAndStart(svc);
    expect(svc.names().get('MSFT')).toBe('MSFT Inc.');
    expect(svc.names().size).toBe(SYMBOLS.length);
  });
});

describe('ProducerService (server)', () => {
  test.scoped({ platform: 'server' }); // applies to this describe only
  test('U02 U27 does not load a worker on the server', async ({ svc, workers }) => {
    await svc.load();
    expect(workers).toHaveLength(0);
  });
});

describe('ProducerService (started)', () => {
  test('U03 applies status and snapshots of the current run', async ({ svc, workers }) => {
    await loadAndStart(svc);
    workers[0].emit({ type: 'status', runId: 1, status: 'running' });
    workers[0].emit({ type: 'snapshot', runId: 1, rows: rows(5, 7n) });
    expect(svc.status()).toBe('running');
    expect(svc.ready()).toBe(true);
    expect(svc.rows()).toEqual(rows(5, 7n));
  });

  test('U04 U09 apply resets rows immediately and increments runId', async ({ svc, workers }) => {
    await loadAndStart(svc);
    workers[0].emit({ type: 'snapshot', runId: 1, rows: rows(5, 7n) });
    const next = { ...DEFAULT_SETTINGS, instrumentCount: 3 };
    svc.apply(next);
    expect(svc.rows()).toEqual(rows(3));
    expect(svc.settings()).toEqual(next);
    expect(svc.status()).toBe('initializing');
    expect(workers[0].sent.at(-1)).toEqual({ type: 'apply', runId: 2, config: configFor(next) });
  });

  test('U05 apply before the worker is ready sends only the latest settings once ready', async ({ svc, workers }) => {
    const loading = svc.load();
    svc.start();
    const next = { ...DEFAULT_SETTINGS, updatesPerBatch: 7 };
    svc.apply(next);
    await loading;
    expect(workers[0].sent).toEqual([{ type: 'apply', runId: 2, config: configFor(next) }]);
  });

  test('U05 drops messages from older runs', async ({ svc, workers }) => {
    await loadAndStart(svc);
    svc.apply(DEFAULT_SETTINGS);
    svc.apply(DEFAULT_SETTINGS);
    workers[0].emit({ type: 'snapshot', runId: 2, rows: rows(5, 9n) });
    workers[0].emit({ type: 'status', runId: 1, status: 'error', error: 'old' });
    expect(svc.rows()).toEqual(rows(5));
    expect(svc.status()).toBe('initializing');
    expect(svc.error()).toBeNull();
  });

  test('U06 pause and resume carry the current runId', async ({ svc, workers }) => {
    await loadAndStart(svc);
    svc.apply(DEFAULT_SETTINGS);
    svc.pause();
    svc.resume();
    expect(workers[0].sent.slice(-2)).toEqual([{ type: 'pause', runId: 2 }, { type: 'resume', runId: 2 }]);
  });

  test('U07 surfaces worker status errors', async ({ svc, workers }) => {
    await loadAndStart(svc);
    workers[0].emit({ type: 'status', runId: 1, status: 'error', error: 'Failed to load /producer.wasm: HTTP 404' });
    expect(svc.status()).toBe('error');
    expect(svc.error()).toContain('404');
  });

  test('U07 surfaces worker crashes', async ({ svc, workers }) => {
    await loadAndStart(svc);
    workers[0].crash('boom');
    expect(svc.status()).toBe('error');
    expect(svc.error()).toBe('boom');
  });

  test('U08 terminates the worker when the app is destroyed', async ({ svc, workers }) => {
    await loadAndStart(svc);
    TestBed.resetTestingModule();
    expect(workers[0].terminated).toBe(true);
  });
});

describe('ProducerService (run time)', () => {
  afterEach(() => vi.useRealTimers());

  test('U35 counts the run time from status messages, without paused intervals', async ({ svc, workers }) => {
    vi.useFakeTimers();
    await loadAndStart(svc);
    expect(svc.elapsedMs()).toBe(0);
    workers[0].emit({ type: 'status', runId: 1, status: 'running' });
    vi.advanceTimersByTime(2_000);
    expect(svc.elapsedMs()).toBe(2_000);
    vi.advanceTimersByTime(500);
    workers[0].emit({ type: 'status', runId: 1, status: 'paused' });
    vi.advanceTimersByTime(5_000);
    expect(svc.elapsedMs()).toBe(2_500);
    workers[0].emit({ type: 'status', runId: 1, status: 'running' });
    vi.advanceTimersByTime(1_000);
    expect(svc.elapsedMs()).toBe(3_500);
  });

  test('U35 apply resets the run time; an error stops it', async ({ svc, workers }) => {
    vi.useFakeTimers();
    await loadAndStart(svc);
    workers[0].emit({ type: 'status', runId: 1, status: 'running' });
    vi.advanceTimersByTime(3_000);
    svc.apply(DEFAULT_SETTINGS);
    expect(svc.elapsedMs()).toBe(0);
    workers[0].emit({ type: 'status', runId: 2, status: 'running' });
    vi.advanceTimersByTime(1_000);
    workers[0].emit({ type: 'status', runId: 2, status: 'error', error: 'boom' });
    vi.advanceTimersByTime(5_000);
    expect(svc.elapsedMs()).toBe(1_000);
  });
});

describe('ProducerService (watch)', () => {
  test('U37 watch sends the symbol to the worker', async ({ svc, workers }) => {
    await loadAndStart(svc);
    svc.watch('MSFT');
    svc.watch(null);
    expect(workers[0].sent.slice(-2)).toEqual([{ type: 'watch', symbol: 'MSFT' }, { type: 'watch', symbol: null }]);
  });

  test('U37 a watch before the worker is up is sent before the first apply', async ({ svc, workers }) => {
    svc.watch('MSFT');
    await loadAndStart(svc);
    expect(workers[0].sent).toEqual([{ type: 'watch', symbol: 'MSFT' }, { type: 'apply', runId: 1, config: configFor(DEFAULT_SETTINGS) }]);
  });

  test('U37 a replacement worker gets the watch before its apply', async ({ svc, workers }) => {
    await loadAndStart(svc);
    svc.watch('MSFT');
    workers[0].crash('boom');
    svc.apply(DEFAULT_SETTINGS);
    await svc.load();
    expect(workers[1].sent.map((message) => (message as { type: string }).type)).toEqual(['watch', 'apply']);
  });

  test('U37 watch sets an empty log for the new symbol at once', ({ svc }) => {
    expect(svc.watched()).toBeNull();
    svc.watch('MSFT');
    expect(svc.watched()).toEqual({ symbol: 'MSFT', events: [], seconds: [] });
    svc.watch(null);
    expect(svc.watched()).toBeNull();
  });

  test('U37 applies the watched events of snapshots', async ({ svc, workers }) => {
    await loadAndStart(svc);
    svc.watch('MSFT');
    workers[0].emit({ type: 'snapshot', runId: 1, rows: rows(5), watched: { symbol: 'MSFT', events: [EVENT], seconds: [] } });
    expect(svc.watched()).toEqual({ symbol: 'MSFT', events: [EVENT], seconds: [] });
  });

  test('U38 ignores events of a symbol that is no longer watched', async ({ svc, workers }) => {
    await loadAndStart(svc);
    svc.watch('AAPL');
    workers[0].emit({ type: 'snapshot', runId: 1, rows: rows(5), watched: { symbol: 'MSFT', events: [EVENT], seconds: [] } });
    workers[0].emit({ type: 'snapshot', runId: 1, rows: rows(5), watched: null });
    expect(svc.watched()).toEqual({ symbol: 'AAPL', events: [], seconds: [] });
  });

  test('U38 K31 apply clears the events and seconds and keeps the symbol', async ({ svc, workers }) => {
    await loadAndStart(svc);
    svc.watch('MSFT');
    workers[0].emit({ type: 'snapshot', runId: 1, rows: rows(5), watched: { symbol: 'MSFT', events: [EVENT], seconds: [] } });
    svc.apply(DEFAULT_SETTINGS);
    expect(svc.watched()).toEqual({ symbol: 'MSFT', events: [], seconds: [] });
  });
});

describe('ProducerService (symbol list failure)', () => {
  // A function value would be run as a fixture factory, so the loader is provided via `use`.
  test.scoped({ symbolsLoader: async ({}, use) => use(() => Promise.reject(new Error('HTTP 404'))) });
  test('U07 reports a missing instrument list and sends nothing', async ({ svc, workers }) => {
    await svc.load();
    expect(svc.status()).toBe('error');
    expect(svc.error()).toBe('Failed to load instrument list: HTTP 404');
    expect(workers.flatMap((worker) => worker.sent)).toEqual([]);
  });
});

describe('ProducerService (loader failure)', () => {
  test.scoped({ loader: async ({}, use) => use(() => Promise.reject(new Error('chunk 404'))) });
  test('U07 reports a loader failure as an error status', async ({ svc }) => {
    await svc.load();
    expect(svc.status()).toBe('error');
    expect(svc.error()).toBe('Failed to start producer: chunk 404');
  });
});

describe('ProducerService (recovery after a failed start)', () => {
  // The symbol list fails once (e.g. a transient network error), then loads.
  test.scoped({
    symbolsLoader: async ({}, use) => {
      let calls = 0;
      await use(() => (calls++ === 0 ? Promise.reject(new Error('HTTP 503')) : Promise.resolve(INSTRUMENTS)));
    },
  });
  test('U07 apply after a failed load retries the load and applies the new settings', async ({ svc, workers }) => {
    await svc.load();
    expect(svc.status()).toBe('error');
    const next = { ...DEFAULT_SETTINGS, instrumentCount: 3 };
    svc.apply(next);
    await svc.load(); // the retry started by apply()
    const live = workers.at(-1)!;
    expect(live.sent).toEqual([{ type: 'apply', runId: 1, config: configFor(next) }]);
    expect(svc.rows()).toEqual(rows(3));
    expect(svc.status()).toBe('initializing');
    expect(svc.error()).toBeNull();
    workers.slice(0, -1).forEach((worker) => expect(worker.terminated).toBe(true));
  });
  test('U49 retry after a failed load loads again without starting a run', async ({ svc, workers }) => {
    await svc.load();
    expect(svc.status()).toBe('error');
    svc.retry();
    expect(svc.status()).toBe('initializing');
    expect(svc.error()).toBeNull();
    await svc.load();
    expect(svc.status()).toBe('idle');
    expect(workers.at(-1)!.sent).toEqual([]);
  });
});

describe('ProducerService (recovery after a worker crash)', () => {
  test('U49 retry after a failed run restarts it with the current settings', async ({ svc, workers }) => {
    await loadAndStart(svc);
    workers[0].emit({ type: 'status', runId: 1, status: 'error', error: 'boom' });
    svc.retry();
    expect(workers[0].sent.at(-1)).toEqual({ type: 'apply', runId: 2, config: configFor(DEFAULT_SETTINGS) });
    expect(svc.status()).toBe('initializing');
  });

  test('U07 apply after a worker crash replaces the dead worker', async ({ svc, workers }) => {
    await loadAndStart(svc);
    workers[0].crash('boom');
    expect(svc.status()).toBe('error');
    svc.apply(DEFAULT_SETTINGS);
    await svc.load();
    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].sent).toEqual([{ type: 'apply', runId: 2, config: configFor(DEFAULT_SETTINGS) }]);
    workers[1].emit({ type: 'status', runId: 2, status: 'running' });
    expect(svc.status()).toBe('running');
    expect(svc.error()).toBeNull();
  });
});
