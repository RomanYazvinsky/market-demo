import { test as base } from 'vitest';
import { ProducerController } from './producer-controller';
import type { FromWorker, ProducerConfig } from './protocol';
import { FakeWasm } from './testing/fake-wasm';
import type { WasmProducer } from './wasm-api';

// Interval 400 / refresh 1000: no batch and emit ever fire at the same fake-time instant.
const CONFIG: ProducerConfig = { symbols: ['AAPL', 'MSFT'], updatesPerBatch: 10, batchIntervalMs: 400 };

class Outbox {
  readonly messages: FromWorker[] = [];
  readonly post = (message: FromWorker) => void this.messages.push(message);
  get last() { return this.messages.at(-1); }
  get statuses() { return this.messages.flatMap((message) => (message.type === 'status' ? [message.status] : [])); }
  get snapshots() { return this.messages.flatMap((message) => (message.type === 'snapshot' ? [message] : [])); }
  get lastVolume() { return this.snapshots.at(-1)!.rows.reduce((total, row) => total + row.volume, 0n); }
}

const test = base.extend<{
  clock: typeof vi;
  wasm: FakeWasm;
  wasmSource: (wasm: FakeWasm) => Promise<WasmProducer>;
  out: Outbox;
  controller: ProducerController;
}>({
  clock: async ({}, use) => {
    vi.useFakeTimers();
    await use(vi);
    vi.useRealTimers();
  },
  wasm: async ({}, use) => use(new FakeWasm()),
  wasmSource: async ({}, use) => use((wasm) => Promise.resolve(wasm)),
  out: async ({}, use) => use(new Outbox()),
  controller: async ({ clock: _clock, wasm, wasmSource, out }, use) => {
    const controller = new ProducerController({ wasm: wasmSource(wasm), post: out.post, seed: () => 123, refreshMs: 1000 });
    await use(controller);
    controller.dispose();
  },
});

const apply = (controller: ProducerController, runId: number, config = CONFIG) => controller.handle({ type: 'apply', runId, config });

describe('ProducerController', () => {
  test('K12 K23 apply posts initializing then running and inits wasm with seed and settings', async ({ controller, wasm, out }) => {
    await apply(controller, 1);
    expect(out.statuses).toEqual(['initializing', 'running']);
    expect(wasm.inits).toEqual([[123, 2, 10, 70]]);
    expect(out.messages.every((message) => message.runId === 1)).toBe(true);
  });

  test('K13 generates one batch per interval and emits a snapshot every refreshMs', async ({ controller, clock, wasm, out }) => {
    await apply(controller, 1);
    clock.advanceTimersByTime(1000);
    expect(wasm.batches).toBe(2);
    expect(out.snapshots).toHaveLength(1);
    expect(out.snapshots[0].rows.map((row) => row.symbol)).toEqual(['AAPL', 'MSFT']);
    expect(out.lastVolume).toBe(20n);
  });

  test('K14 pause stops batches and posts a final snapshot', async ({ controller, clock, wasm, out }) => {
    await apply(controller, 1);
    clock.advanceTimersByTime(900);
    await controller.handle({ type: 'pause', runId: 1 });
    expect(out.lastVolume).toBe(20n);
    expect(out.statuses.at(-1)).toBe('paused');
    const count = out.messages.length;
    clock.advanceTimersByTime(5000);
    expect(wasm.batches).toBe(2);
    expect(out.messages).toHaveLength(count);
  });

  test('K15 resume keeps totals and does not backfill', async ({ controller, clock, wasm, out }) => {
    await apply(controller, 1);
    clock.advanceTimersByTime(900);
    await controller.handle({ type: 'pause', runId: 1 });
    clock.advanceTimersByTime(10_000);
    await controller.handle({ type: 'resume', runId: 1 });
    expect(out.statuses.at(-1)).toBe('running');
    clock.advanceTimersByTime(1000);
    expect(wasm.batches).toBe(4);
    expect(out.lastVolume).toBe(40n);
  });

  test('K16 apply resets totals and stamps the new runId', async ({ controller, clock, wasm, out }) => {
    await apply(controller, 1);
    clock.advanceTimersByTime(900);
    const mark = out.messages.length;
    await apply(controller, 2);
    clock.advanceTimersByTime(1000);
    expect(out.messages.slice(mark).every((message) => message.runId === 2)).toBe(true);
    expect(out.lastVolume).toBe(20n);
    expect(wasm.inits).toHaveLength(2);
  });

  test('K17 apply after pause starts running', async ({ controller, clock, wasm, out }) => {
    await apply(controller, 1);
    await controller.handle({ type: 'pause', runId: 1 });
    await apply(controller, 2);
    expect(out.last).toEqual({ type: 'status', runId: 2, status: 'running' });
    clock.advanceTimersByTime(400);
    expect(wasm.batches).toBe(1);
  });

  test('K18 reports go init error and does not generate', async ({ controller, clock, wasm, out }) => {
    wasm.initResult = 'updatesPerBatch must be 1-1000, got 0';
    await apply(controller, 1);
    expect(out.last).toEqual({ type: 'status', runId: 1, status: 'error', error: 'updatesPerBatch must be 1-1000, got 0' });
    clock.advanceTimersByTime(5000);
    expect(wasm.batches).toBe(0);
  });

  test('K18 an exception from wasm init becomes an error status', async ({ controller, clock, wasm, out }) => {
    vi.spyOn(wasm, 'init').mockImplementation(() => {
      throw new Error('Go program has already exited');
    });
    await expect(apply(controller, 1)).resolves.toBeUndefined();
    expect(out.last).toEqual({ type: 'status', runId: 1, status: 'error', error: 'Go program has already exited' });
    clock.advanceTimersByTime(5000);
    expect(wasm.batches).toBe(0);
  });

  test('K19 ignores pause and resume for a stale runId', async ({ controller, clock, wasm, out }) => {
    await apply(controller, 1);
    await apply(controller, 2);
    await controller.handle({ type: 'pause', runId: 1 });
    expect(out.statuses.at(-1)).toBe('running');
    clock.advanceTimersByTime(400);
    expect(wasm.batches).toBe(1);
  });

  test('K28 snapshots carry no events while nothing is watched', async ({ controller, clock, out }) => {
    await apply(controller, 1);
    clock.advanceTimersByTime(1000);
    expect(out.snapshots[0].watched).toBeNull();
  });

  test('K28 snapshots carry the watched symbol\'s events', async ({ controller, clock, out }) => {
    await controller.handle({ type: 'watch', symbol: 'MSFT' });
    await apply(controller, 1);
    const startMs = Date.now();
    clock.advanceTimersByTime(1000);
    const watched = out.snapshots.at(-1)!.watched!;
    expect(watched.symbol).toBe('MSFT');
    // FakeWasm alternates instruments, so MSFT (index 1) gets every second update of the run.
    expect(watched.events.map((event) => event.sequence)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(watched.events.map((event) => event.timeMs - startMs)).toEqual([...Array(5).fill(400), ...Array(5).fill(800)]);
  });

  test('K25 K28 the watched log holds at most 100 events', async ({ controller, clock, out }) => {
    await controller.handle({ type: 'watch', symbol: 'AAPL' });
    await apply(controller, 1);
    clock.advanceTimersByTime(20_000); // 50 batches × 5 AAPL updates
    expect(out.snapshots.at(-1)!.watched!.events).toHaveLength(100);
  });

  test('K28 watched symbol outside the run has no events', async ({ controller, clock, out }) => {
    await controller.handle({ type: 'watch', symbol: 'TSLA' });
    await apply(controller, 1);
    clock.advanceTimersByTime(1000);
    expect(out.snapshots.at(-1)!.watched).toEqual({ symbol: 'TSLA', events: [], seconds: [] });
  });

  test('K29 watch while paused posts a snapshot at once', async ({ controller, clock, out }) => {
    await apply(controller, 1);
    clock.advanceTimersByTime(900);
    await controller.handle({ type: 'pause', runId: 1 });
    await controller.handle({ type: 'watch', symbol: 'AAPL' });
    expect(out.last).toMatchObject({ type: 'snapshot', runId: 1, watched: { symbol: 'AAPL' } });
    expect(out.snapshots.at(-1)!.watched!.events).toHaveLength(10);
  });

  test('K29 watch while running posts a snapshot at once; null stops the events', async ({ controller, out }) => {
    await apply(controller, 1);
    await controller.handle({ type: 'watch', symbol: 'AAPL' });
    expect(out.last).toMatchObject({ type: 'snapshot', watched: { symbol: 'AAPL', events: [] } });
    await controller.handle({ type: 'watch', symbol: null });
    expect(out.last).toMatchObject({ type: 'snapshot', watched: null });
  });

  test('K29 watch before any apply posts nothing', async ({ controller, out }) => {
    await controller.handle({ type: 'watch', symbol: 'AAPL' });
    expect(out.messages).toEqual([]);
  });

  test('K27 apply clears the event log; watching survives apply', async ({ controller, clock, out }) => {
    await controller.handle({ type: 'watch', symbol: 'AAPL' });
    await apply(controller, 1);
    clock.advanceTimersByTime(1000);
    await apply(controller, 2);
    clock.advanceTimersByTime(1000);
    const watched = out.snapshots.at(-1)!.watched!;
    expect(out.snapshots.at(-1)!.runId).toBe(2);
    expect(watched.symbol).toBe('AAPL');
    expect(watched.events.map((event) => event.sequence)).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19]);
  });

  test('K31 snapshots carry one point per second of the watched symbol', async ({ controller, clock, out }) => {
    clock.setSystemTime(10_000);
    await controller.handle({ type: 'watch', symbol: 'AAPL' });
    await apply(controller, 1);
    clock.advanceTimersByTime(1900); // batches at 10.4, 10.8, 11.2 and 11.6 s
    await controller.handle({ type: 'pause', runId: 1 });
    expect(out.snapshots.at(-1)!.watched!.seconds.map((point) => point.timeMs)).toEqual([10_800, 11_600]);
  });

  test('K31 apply clears the per-second points', async ({ controller, clock, out }) => {
    await controller.handle({ type: 'watch', symbol: 'AAPL' });
    await apply(controller, 1);
    clock.advanceTimersByTime(1000);
    await apply(controller, 2);
    await controller.handle({ type: 'watch', symbol: 'AAPL' });
    expect(out.snapshots.at(-1)!.watched!.seconds).toEqual([]);
  });

  test('K20 dispose stops all timers', async ({ controller, clock, wasm, out }) => {
    await apply(controller, 1);
    controller.dispose();
    const count = out.messages.length;
    clock.advanceTimersByTime(5000);
    expect(wasm.batches).toBe(0);
    expect(out.messages).toHaveLength(count);
  });
});

describe('ProducerController (wasm load failure)', () => {
  test.scoped({
    wasmSource: async ({}, use) => use(() => Promise.reject(new Error('Failed to load /producer.wasm: HTTP 404'))),
  });

  test('K18 reports wasm load failure', async ({ controller, out }) => {
    await apply(controller, 1);
    expect(out.last).toEqual({ type: 'status', runId: 1, status: 'error', error: expect.stringContaining('404') });
  });
});

describe('ProducerController (slow wasm)', () => {
  let release!: () => void;
  test.scoped({ wasmSource: async ({}, use) => use((wasm) => new Promise((row) => (release = () => row(wasm)))) });

  test('K19 an older apply still awaiting wasm does not start after a newer one', async ({ controller, clock, wasm, out }) => {
    const first = apply(controller, 1);
    const second = apply(controller, 2, { ...CONFIG, symbols: ['AAPL', 'MSFT', 'NVDA'] });
    release();
    await Promise.all([first, second]);
    expect(out.messages.filter((message) => message.runId === 1)).toEqual([{ type: 'status', runId: 1, status: 'initializing' }]);
    expect(wasm.inits).toEqual([[123, 3, 10, 70]]);
    clock.advanceTimersByTime(400);
    expect(wasm.batches).toBe(1);
  });
});
