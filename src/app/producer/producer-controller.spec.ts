import { test as base } from 'vitest';
import { ProducerController } from './producer-controller';
import type { FromWorker, ProducerConfig } from './protocol';
import { FakeWasm } from './testing/fake-wasm';
import type { WasmProducer } from './wasm-api';

// Interval 400 / refresh 1000: no batch and emit ever fire at the same fake-time instant.
const S: ProducerConfig = { symbols: ['AAPL', 'MSFT'], updatesPerBatch: 10, batchIntervalMs: 400 };

class Outbox {
  readonly messages: FromWorker[] = [];
  readonly post = (m: FromWorker) => void this.messages.push(m);
  get last() { return this.messages.at(-1); }
  get statuses() { return this.messages.flatMap((m) => (m.type === 'status' ? [m.status] : [])); }
  get snapshots() { return this.messages.flatMap((m) => (m.type === 'snapshot' ? [m] : [])); }
  get lastVolume() { return this.snapshots.at(-1)!.rows.reduce((a, r) => a + r.volume, 0n); }
}

const test = base.extend<{
  clock: typeof vi;
  wasm: FakeWasm;
  wasmSource: (wasm: FakeWasm) => Promise<WasmProducer>;
  out: Outbox;
  ctrl: ProducerController;
}>({
  clock: async ({}, use) => {
    vi.useFakeTimers();
    await use(vi);
    vi.useRealTimers();
  },
  wasm: async ({}, use) => use(new FakeWasm()),
  wasmSource: async ({}, use) => use((wasm) => Promise.resolve(wasm)),
  out: async ({}, use) => use(new Outbox()),
  ctrl: async ({ clock: _clock, wasm, wasmSource, out }, use) => {
    const ctrl = new ProducerController({ wasm: wasmSource(wasm), post: out.post, seed: () => 123, refreshMs: 1000 });
    await use(ctrl);
    ctrl.dispose();
  },
});

const apply = (ctrl: ProducerController, runId: number, config = S) => ctrl.handle({ type: 'apply', runId, config });

describe('ProducerController', () => {
  test('K12 K23 apply posts initializing then running and inits wasm with seed and settings', async ({ ctrl, wasm, out }) => {
    await apply(ctrl, 1);
    expect(out.statuses).toEqual(['initializing', 'running']);
    expect(wasm.inits).toEqual([[123, 2, 10, 70]]);
    expect(out.messages.every((m) => m.runId === 1)).toBe(true);
  });

  test('K13 generates one batch per interval and emits a snapshot every refreshMs', async ({ ctrl, clock, wasm, out }) => {
    await apply(ctrl, 1);
    clock.advanceTimersByTime(1000);
    expect(wasm.batches).toBe(2);
    expect(out.snapshots).toHaveLength(1);
    expect(out.snapshots[0].rows.map((r) => r.symbol)).toEqual(['AAPL', 'MSFT']);
    expect(out.lastVolume).toBe(20n);
  });

  test('K14 pause stops batches and posts a final snapshot', async ({ ctrl, clock, wasm, out }) => {
    await apply(ctrl, 1);
    clock.advanceTimersByTime(900);
    await ctrl.handle({ type: 'pause', runId: 1 });
    expect(out.lastVolume).toBe(20n);
    expect(out.statuses.at(-1)).toBe('paused');
    const count = out.messages.length;
    clock.advanceTimersByTime(5000);
    expect(wasm.batches).toBe(2);
    expect(out.messages).toHaveLength(count);
  });

  test('K15 resume keeps totals and does not backfill', async ({ ctrl, clock, wasm, out }) => {
    await apply(ctrl, 1);
    clock.advanceTimersByTime(900);
    await ctrl.handle({ type: 'pause', runId: 1 });
    clock.advanceTimersByTime(10_000);
    await ctrl.handle({ type: 'resume', runId: 1 });
    expect(out.statuses.at(-1)).toBe('running');
    clock.advanceTimersByTime(1000);
    expect(wasm.batches).toBe(4);
    expect(out.lastVolume).toBe(40n);
  });

  test('K16 apply resets totals and stamps the new runId', async ({ ctrl, clock, wasm, out }) => {
    await apply(ctrl, 1);
    clock.advanceTimersByTime(900);
    const mark = out.messages.length;
    await apply(ctrl, 2);
    clock.advanceTimersByTime(1000);
    expect(out.messages.slice(mark).every((m) => m.runId === 2)).toBe(true);
    expect(out.lastVolume).toBe(20n);
    expect(wasm.inits).toHaveLength(2);
  });

  test('K17 apply after pause starts running', async ({ ctrl, clock, wasm, out }) => {
    await apply(ctrl, 1);
    await ctrl.handle({ type: 'pause', runId: 1 });
    await apply(ctrl, 2);
    expect(out.last).toEqual({ type: 'status', runId: 2, status: 'running' });
    clock.advanceTimersByTime(400);
    expect(wasm.batches).toBe(1);
  });

  test('K18 reports go init error and does not generate', async ({ ctrl, clock, wasm, out }) => {
    wasm.initResult = 'updatesPerBatch must be 1-1000, got 0';
    await apply(ctrl, 1);
    expect(out.last).toEqual({ type: 'status', runId: 1, status: 'error', error: 'updatesPerBatch must be 1-1000, got 0' });
    clock.advanceTimersByTime(5000);
    expect(wasm.batches).toBe(0);
  });

  test('K19 ignores pause and resume for a stale runId', async ({ ctrl, clock, wasm, out }) => {
    await apply(ctrl, 1);
    await apply(ctrl, 2);
    await ctrl.handle({ type: 'pause', runId: 1 });
    expect(out.statuses.at(-1)).toBe('running');
    clock.advanceTimersByTime(400);
    expect(wasm.batches).toBe(1);
  });

  test('K20 dispose stops all timers', async ({ ctrl, clock, wasm, out }) => {
    await apply(ctrl, 1);
    ctrl.dispose();
    const count = out.messages.length;
    clock.advanceTimersByTime(5000);
    expect(wasm.batches).toBe(0);
    expect(out.messages).toHaveLength(count);
  });
});

describe('ProducerController (wasm load failure)', () => {
  test.scoped({ wasmSource: () => Promise.reject(new Error('Failed to load /producer.wasm: HTTP 404')) });

  test('K18 reports wasm load failure', async ({ ctrl, out }) => {
    await apply(ctrl, 1);
    expect(out.last).toEqual({ type: 'status', runId: 1, status: 'error', error: expect.stringContaining('404') });
  });
});

describe('ProducerController (slow wasm)', () => {
  let release!: () => void;
  test.scoped({ wasmSource: (wasm) => new Promise((r) => (release = () => r(wasm))) });

  test('K19 an older apply still awaiting wasm does not start after a newer one', async ({ ctrl, clock, wasm, out }) => {
    const first = apply(ctrl, 1);
    const second = apply(ctrl, 2, { ...S, symbols: ['AAPL', 'MSFT', 'NVDA'] });
    release();
    await Promise.all([first, second]);
    expect(out.messages.filter((m) => m.runId === 1)).toEqual([{ type: 'status', runId: 1, status: 'initializing' }]);
    expect(wasm.inits).toEqual([[123, 3, 10, 70]]);
    clock.advanceTimersByTime(400);
    expect(wasm.batches).toBe(1);
  });
});
