import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { test as base } from 'vitest';
import { FakeWorker } from '../../testing/producer-fixtures';
import { INSTRUMENT_SYMBOLS_LOADER, PRODUCER_WORKER_LOADER, ProducerService } from './producer.service';
import { DEFAULT_SETTINGS, emptyRow, type MetricsRow } from './protocol';
import { toProducerConfig } from './symbols';

const SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META'];
const configFor = (settings: typeof DEFAULT_SETTINGS) => toProducerConfig(settings, SYMBOLS);

const test = base.extend<{
  platform: string;
  workers: FakeWorker[];
  loader: () => Promise<Worker>;
  symbolsLoader: () => Promise<readonly string[]>;
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
  symbolsLoader: async ({}, use) => use(async () => SYMBOLS),
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

const rows = (count: number, volume = 0n): MetricsRow[] =>
  SYMBOLS.slice(0, count).map((settings) => ({ ...emptyRow(settings), volume }));

describe('ProducerService', () => {
  test('U05 starts with defaults and empty rows, not started', ({ svc }) => {
    expect(svc.status()).toBe('initializing');
    expect(svc.error()).toBeNull();
    expect(svc.started()).toBe(false);
    expect(svc.settings()).toEqual(DEFAULT_SETTINGS);
    expect(svc.rows()).toEqual([]);
  });

  test('U05 U06 U14 start loads exactly one worker and applies defaults', async ({ svc, workers }) => {
    await Promise.all([svc.start(), svc.start()]);
    await svc.start();
    expect(workers).toHaveLength(1);
    expect(workers[0].sent).toEqual([{ type: 'apply', runId: 1, config: configFor(DEFAULT_SETTINGS) }]);
    expect(svc.rows()).toEqual(rows(5));
  });
});

describe('ProducerService (server)', () => {
  test.scoped({ platform: 'server' }); // applies to this describe only
  test('U06 U22 does not load a worker on the server', async ({ svc, workers }) => {
    await svc.start();
    expect(workers).toHaveLength(0);
  });
});

describe('ProducerService (started)', () => {
  test('U08 applies status and snapshots of the current run', async ({ svc, workers }) => {
    await svc.start();
    workers[0].emit({ type: 'status', runId: 1, status: 'running' });
    workers[0].emit({ type: 'snapshot', runId: 1, rows: rows(5, 7n) });
    expect(svc.status()).toBe('running');
    expect(svc.started()).toBe(true);
    expect(svc.rows()).toEqual(rows(5, 7n));
  });

  test('U09 U14 apply resets rows immediately and increments runId', async ({ svc, workers }) => {
    await svc.start();
    workers[0].emit({ type: 'snapshot', runId: 1, rows: rows(5, 7n) });
    const next = { ...DEFAULT_SETTINGS, instrumentCount: 3 };
    svc.apply(next);
    expect(svc.rows()).toEqual(rows(3));
    expect(svc.settings()).toEqual(next);
    expect(svc.status()).toBe('initializing');
    expect(workers[0].sent.at(-1)).toEqual({ type: 'apply', runId: 2, config: configFor(next) });
  });

  test('U10 apply before the worker is ready sends only the latest settings once ready', async ({ svc, workers }) => {
    const starting = svc.start();
    const next = { ...DEFAULT_SETTINGS, updatesPerBatch: 7 };
    svc.apply(next);
    await starting;
    expect(workers[0].sent).toEqual([{ type: 'apply', runId: 2, config: configFor(next) }]);
  });

  test('U10 drops messages from older runs', async ({ svc, workers }) => {
    await svc.start();
    svc.apply(DEFAULT_SETTINGS);
    svc.apply(DEFAULT_SETTINGS);
    workers[0].emit({ type: 'snapshot', runId: 2, rows: rows(5, 9n) });
    workers[0].emit({ type: 'status', runId: 1, status: 'error', error: 'old' });
    expect(svc.rows()).toEqual(rows(5));
    expect(svc.status()).toBe('initializing');
    expect(svc.error()).toBeNull();
  });

  test('U11 pause and resume carry the current runId', async ({ svc, workers }) => {
    await svc.start();
    svc.apply(DEFAULT_SETTINGS);
    svc.pause();
    svc.resume();
    expect(workers[0].sent.slice(-2)).toEqual([{ type: 'pause', runId: 2 }, { type: 'resume', runId: 2 }]);
  });

  test('U12 surfaces worker status errors', async ({ svc, workers }) => {
    await svc.start();
    workers[0].emit({ type: 'status', runId: 1, status: 'error', error: 'Failed to load /producer.wasm: HTTP 404' });
    expect(svc.status()).toBe('error');
    expect(svc.error()).toContain('404');
  });

  test('U12 surfaces worker crashes', async ({ svc, workers }) => {
    await svc.start();
    workers[0].crash('boom');
    expect(svc.status()).toBe('error');
    expect(svc.error()).toBe('boom');
  });

  test('U13 terminates the worker when the app is destroyed', async ({ svc, workers }) => {
    await svc.start();
    TestBed.resetTestingModule();
    expect(workers[0].terminated).toBe(true);
  });
});

describe('ProducerService (symbol list failure)', () => {
  // A function value would be run as a fixture factory, so the loader is provided via `use`.
  test.scoped({ symbolsLoader: async ({}, use) => use(() => Promise.reject(new Error('HTTP 404'))) });
  test('U12 reports a missing instrument list and sends nothing', async ({ svc, workers }) => {
    await svc.start();
    expect(svc.status()).toBe('error');
    expect(svc.error()).toBe('Failed to load instrument list: HTTP 404');
    expect(workers.flatMap((worker) => worker.sent)).toEqual([]);
  });
});

describe('ProducerService (loader failure)', () => {
  test.scoped({ loader: async ({}, use) => use(() => Promise.reject(new Error('chunk 404'))) });
  test('U12 reports a loader failure as an error status', async ({ svc }) => {
    await svc.start();
    expect(svc.status()).toBe('error');
    expect(svc.error()).toBe('Failed to start producer: chunk 404');
  });
});

describe('ProducerService (recovery after a failed start)', () => {
  // The symbol list fails once (e.g. a transient network error), then loads.
  test.scoped({
    symbolsLoader: async ({}, use) => {
      let calls = 0;
      await use(() => (calls++ === 0 ? Promise.reject(new Error('HTTP 503')) : Promise.resolve(SYMBOLS)));
    },
  });
  test('U12 apply after a failed start retries the start and applies the new settings', async ({ svc, workers }) => {
    await svc.start();
    expect(svc.status()).toBe('error');
    const next = { ...DEFAULT_SETTINGS, instrumentCount: 3 };
    svc.apply(next);
    await svc.start(); // the retry started by apply()
    const live = workers.at(-1)!;
    expect(live.sent).toEqual([{ type: 'apply', runId: 2, config: configFor(next) }]);
    expect(svc.rows()).toEqual(rows(3));
    expect(svc.status()).toBe('initializing');
    expect(svc.error()).toBeNull();
    workers.slice(0, -1).forEach((worker) => expect(worker.terminated).toBe(true));
  });
});

describe('ProducerService (recovery after a worker crash)', () => {
  test('U12 apply after a worker crash replaces the dead worker', async ({ svc, workers }) => {
    await svc.start();
    workers[0].crash('boom');
    expect(svc.status()).toBe('error');
    svc.apply(DEFAULT_SETTINGS);
    await svc.start();
    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].sent).toEqual([{ type: 'apply', runId: 2, config: configFor(DEFAULT_SETTINGS) }]);
    workers[1].emit({ type: 'status', runId: 2, status: 'running' });
    expect(svc.status()).toBe('running');
    expect(svc.error()).toBeNull();
  });
});
