// @vitest-environment node
// K32: a long run at the largest settings keeps worker and Wasm memory flat.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import './wasm_exec.js';
import { ProducerController } from './producer-controller';
import { SETTINGS_LIMITS, type FromWorker, type ProducerConfig } from './protocol';
import type { WasmProducer } from './wasm-api';

setFlagsFromString('--expose-gc');
const collectGarbage = runInNewContext('gc') as () => void;

const MB = 1024 * 1024;
const BATCH_INTERVAL_MS = SETTINGS_LIMITS.batchIntervalMs.min;
const CONFIG: ProducerConfig = {
  symbols: Array.from({ length: SETTINGS_LIMITS.instrumentCount.max }, (_, index) => `S${index}`),
  updatesPerBatch: SETTINGS_LIMITS.updatesPerBatch.max,
  batchIntervalMs: BATCH_INTERVAL_MS,
};

let wasmMemory: WebAssembly.Memory;
let producer: WasmProducer;

beforeAll(async () => {
  const go = new Go();
  const bytes = await readFile(resolve(process.cwd(), 'public/producer.wasm'));
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  void go.run(instance);
  wasmMemory = instance.exports['mem'] as WebAssembly.Memory;
  producer = globalThis.producer!;
});

afterEach(() => vi.useRealTimers());

function heapUsed(): number {
  collectGarbage();
  collectGarbage();
  return process.memoryUsage().heapUsed;
}

describe('long run memory', () => {
  it('K32 5 million updates at the largest settings do not grow the heap or the Wasm memory', { timeout: 60_000 }, async () => {
    vi.useFakeTimers();
    let lastSnapshot: Extract<FromWorker, { type: 'snapshot' }> | undefined;
    const controller = new ProducerController({
      wasm: Promise.resolve(producer),
      post: (message) => void (message.type === 'snapshot' && (lastSnapshot = message)),
      seed: () => 1,
      refreshMs: 1000,
    });
    await controller.handle({ type: 'watch', symbol: 'S0' });
    await controller.handle({ type: 'apply', runId: 1, config: CONFIG });

    vi.advanceTimersByTime(2_000 * BATCH_INTERVAL_MS); // warm-up: JIT, full ring buffers, past the first forced Go GCs (every 1000 batches)
    const heapBefore = heapUsed();
    const wasmBefore = wasmMemory.buffer.byteLength;

    vi.advanceTimersByTime(5_000 * BATCH_INTERVAL_MS); // 5,000 batches × 1,000 updates
    const heapGrowth = heapUsed() - heapBefore;
    controller.dispose();

    expect(heapGrowth).toBeLessThan(2 * MB);
    expect(wasmMemory.buffer.byteLength).toBe(wasmBefore);
    expect(lastSnapshot!.rows).toHaveLength(CONFIG.symbols.length);
    expect(lastSnapshot!.watched!.events).toHaveLength(100);
    expect(lastSnapshot!.watched!.seconds.length).toBeLessThanOrEqual(300);
  });
});
