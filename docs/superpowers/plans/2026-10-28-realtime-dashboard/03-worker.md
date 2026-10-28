# Module 03 — Web Worker (metrics, run lifecycle, wasm loading)

Read `00-overview.md` and `01-contracts.md` (Tasks 1.2 and 1.3 are this module's contracts on both sides). Branch `feat/worker`. Owns `src/app/producer/{metrics,producer-controller,wasm-loader,producer.worker}.ts`, their specs, and `src/app/producer/testing/**` only.

Developed against a fake `WasmProducer`; never imports Go output except in the browser entry.

## Requirements → tests

Every test name starts with the ID(s) it proves; `grep -rn "<ID>" src` lists the evidence. A requirement without a test states why. Source: **T** = TASK.md, **S** = design spec / author decision, **C** = contract in this plan.

| ID | Requirement | Src | Test |
|---|---|---|---|
| K01 | Last traded price = price of the instrument's latest trade | T §1 | `metrics.spec.ts` › `K01 K02 K03 K04 K05 computes the worked example` |
| K02 | Spread = ask − bid of the latest quote | T §1 | `K02 spread is ask minus bid`, `K01…K05 computes the worked example` |
| K03 | Volume = sum of trade quantities since run start, each trade once; book quantities never count | T §1 | `K01…K05 computes the worked example` (40, not 1,000), `K03 K04 accumulates across batches`, `K03 reads only updateCount updates from a reused buffer` |
| K04 | VWAP = Σ(price × qty) / Σ qty, cumulative (not rolling) | T §1 | `K04 vwap of the worked example`, `K01…K05 computes the worked example`, `K03 K04 accumulates across batches` |
| K05 | Imbalance = (bidQty − askQty) / (bidQty + askQty) from the latest quote, within −1…+1 | T §1 | `K05 imbalance of the worked example`, `K05 imbalance bounds` |
| K06 | A zero denominator gives an unavailable value (`null`) | T §1 | `K06 vwap is null with zero volume`, `K06 imbalance is null with empty book`, `K06 imbalance is null when both book quantities are zero` |
| K07 | Before any data: unavailable values and zero volume | T §1 | `K07 starts with unavailable values and zero volume` |
| K08 | Instruments are isolated from each other | T §4 | `K08 isolates instruments` |
| K09 | Totals stay exact on long runs (BigInt, beyond 2^53) | S | `K09 vwap exact beyond Number.MAX_SAFE_INTEGER`, `K09 stays exact over a long run` |
| K10 | Prices stay in cents; VWAP keeps two fractional cent digits, rounding happens only for display | T §3 | `K10 vwap keeps two fractional cent digits` |
| K11 | No event history is retained; snapshots are independent copies | T §3 | `K11 snapshot returns copies`. *Review check:* `MetricsStore` holds fixed-size per-instrument fields only (no arrays growing per update). |
| K12 | Apply initialises wasm with a fresh seed and the config, reporting initializing → running | T §2, C | `K12 K23 apply posts initializing then running and inits wasm with seed and settings` |
| K13 | One batch per interval; a snapshot every `refreshMs` with the config's symbols; every generated trade counts | T §3 | `K13 generates one batch per interval and emits a snapshot every refreshMs` |
| K14 | Pause stops generation and flushes one final snapshot | T §1 | `K14 pause stops batches and posts a final snapshot` |
| K15 | Resume keeps values and totals and does not generate for the paused interval | T §1 | `K15 resume keeps totals and does not backfill` |
| K16 | Apply clears the previous run's totals; every later message carries the new runId | T §2 | `K16 apply resets totals and stamps the new runId` |
| K17 | Apply also starts generation when the previous run was paused | T §2 | `K17 apply after pause starts running` |
| K18 | Initialisation errors are reported with readable text, and no generation starts | T §3 | `K18 reports wasm load failure`, `K18 reports go init error and does not generate` |
| K19 | Results of a previous run never leak into a new run (stale pause/resume ignored; an older apply can't start after a newer one) | T §2 | `K19 ignores pause and resume for a stale runId`, `K19 an older apply still awaiting wasm does not start after a newer one` |
| K20 | Producer resources are cleaned up when replaced or disposed | T §3 | `K20 dispose stops all timers` |
| K21 | The loader reports every load failure readably: HTTP error (`Failed to load <url>: HTTP <status>`), invalid binary (`Failed to start <url>: …`), module that never registers the API | T §3 | `wasm-loader.spec.ts` › `K21 reports the HTTP status of a failed fetch`, `K21 reports a binary that is not valid wasm as a start failure`, `K21 reports a module that never registers the producer API` |
| K22 | The loader refuses big-endian platforms (memory model in `wasm-api.ts`) | C | `K22 rejects a big-endian platform before fetching` |
| K23 | One Int32Array of `updatesPerBatch × 7` per run is bound in `init` and reused for every batch | C | `K12 K23 apply posts…` (asserts the bound length 70). Reuse is enforced by the contract: `nextBatch()` takes no buffer. |
| K24 | The worker entry wires controller, loader and environment | S | — *Manual:* covered end to end in 05 Task 5.2 (browser-only glue). |


**Interfaces produced:**

`metrics.ts`:
- `spreadCents(bidCents: number, askCents: number): number`
- `vwapCents(notionalCents: bigint, volume: bigint): number | null` — `null` when `volume === 0n`; cents with 2 fractional digits, truncated.
- `imbalance(bidQty: number, askQty: number): number | null` — `null` when `bidQty + askQty === 0`.
- `class MetricsStore { constructor(symbols: string[]); add(batch: Int32Array, updateCount: number): void; snapshot(): MetricsRow[] }` — `add` reads the first `updateCount` updates; `snapshot` returns fresh objects.

`producer-controller.ts`:

```ts
export interface ProducerControllerDeps {
  wasm: Promise<WasmProducer>;
  post: (message: FromWorker) => void;
  seed: () => number;
  refreshMs: number; // environment.uiRefreshMs in the worker entry
}

export class ProducerController {
  constructor(deps: ProducerControllerDeps);
  handle(message: ToWorker): Promise<void>;
  dispose(): void;
}
```

`wasm-loader.ts`:
- `loadWasmProducer(wasmUrl: string, deps: LoaderDeps = defaultLoaderDeps): Promise<WasmProducer>`, where `interface LoaderDeps { fetch: typeof fetch; littleEndian: boolean }` and the defaults are `globalThis.fetch` and `isLittleEndian()`. The deps exist so K21/K22 are testable without a browser. It rejects with `Failed to load <url>: HTTP <status>` / `Failed to start <url>: <cause>` / `producer.wasm did not register the producer API` / `Big-endian platforms are not supported` (checked first: `new Uint8Array(new Uint32Array([1]).buffer)[0] === 1`; see the memory model in `wasm-api.ts`).

**Controller behaviour:**
- Constructor attaches a rejection handler to `deps.wasm` immediately (no unhandled rejection).
- `apply`: stop timers; current run := `runId` (synchronously, before any await); post `status initializing`; await wasm — on failure post `status error` with the message and stop; if a newer apply arrived meanwhile, return silently; allocate `ints = new Int32Array(config.updatesPerBatch * FIELDS_PER_UPDATE)`; `init(seed(), config.symbols.length, config.updatesPerBatch, ints)` — non-null → post `status error` with that text and stop; else keep `ints` for the run, new `MetricsStore(config.symbols)`, start timers, post `status running`.
- Batch timer: chained `setTimeout(batchIntervalMs)`; first batch one interval after start/resume; each tick `nextBatch()` then `store.add(ints, updatesPerBatch)` (wasm has just overwritten `ints`).
- Emit timer: `setInterval(refreshMs)` posting `snapshot`.
- `pause` (current run, running): stop timers, post `snapshot`, post `status paused`. `resume` (current run, paused): restart both timers, post `status running`. Other `runId`s ignored.
- `dispose`: stop timers.

---

### Task 3.1: Skeleton

**Files:** Create `metrics.ts`, `producer-controller.ts`, `wasm-loader.ts` with the signatures above; every body `throw new Error('not implemented')` (controller constructor stores deps only). Leave `producer.worker.ts` as the 01 stub for now.

- [ ] **Step 1:** Write the files.
- [ ] **Step 2: Verify** `pnpm typecheck` — exit 0.
- [ ] **Step 3: Commit** — `git commit -m "feat(worker): module skeleton"` (add new files).

---

### Task 3.2: Metrics tests (red)

**Files:** Create `src/app/producer/metrics.spec.ts`

- [ ] **Step 1:**

```ts
import { test as base } from 'vitest';
import { MetricsStore, imbalance, spreadCents, vwapCents } from './metrics';
import { emptyRow } from './protocol';

/** `store`: a fresh single-instrument store per test. */
const test = base.extend<{ store: MetricsStore }>({
  store: async ({}, use) => use(new MetricsStore(['ALFA'])),
});

type U = [instrument: number, price: number, qty: number, bid: number, ask: number, bidQty: number, askQty: number];
const pack = (...ups: U[]) => Int32Array.from(ups.flat());

describe('metric functions', () => {
  it('K02 spread is ask minus bid', () => expect(spreadCents(10196, 10200)).toBe(4));
  it('K04 vwap of the worked example', () => expect(vwapCents(10000n * 10n + 10200n * 30n, 40n)).toBe(10150));
  it('K10 vwap keeps two fractional cent digits', () => expect(vwapCents(1n, 3n)).toBe(0.33));
  it('K06 vwap is null with zero volume', () => expect(vwapCents(0n, 0n)).toBeNull());
  it('K09 vwap exact beyond Number.MAX_SAFE_INTEGER', () => {
    const volume = 2n ** 60n;
    expect(vwapCents(volume * 10150n + 1n, volume)).toBe(10150);
  });
  it('K05 imbalance of the worked example', () => expect(imbalance(600, 400)).toBeCloseTo(0.2, 10));
  it('K05 imbalance bounds', () => {
    expect(imbalance(5, 0)).toBe(1);
    expect(imbalance(0, 5)).toBe(-1);
  });
  it('K06 imbalance is null with empty book', () => expect(imbalance(0, 0)).toBeNull());
});

describe('MetricsStore', () => {
  const example = pack([0, 10000, 10, 9996, 10000, 500, 500], [0, 10200, 30, 10196, 10200, 600, 400]);
  const exampleRow = {
    symbol: 'ALFA', lastPriceCents: 10200, spreadCents: 4, volume: 40n, vwapCents: 10150, imbalance: 0.2,
  };

  test('K07 starts with unavailable values and zero volume', () => {
    expect(new MetricsStore(['ALFA', 'BETA']).snapshot()).toEqual([emptyRow('ALFA'), emptyRow('BETA')]);
  });

  test('K01 K02 K03 K04 K05 computes the worked example', ({ store }) => {
    store.add(example, 2);
    expect(store.snapshot()).toEqual([exampleRow]);
  });

  test('K03 K04 accumulates across batches', ({ store }) => {
    store.add(example.subarray(0, 7), 1);
    store.add(example.subarray(7), 1);
    expect(store.snapshot()).toEqual([exampleRow]);
  });

  test('K08 isolates instruments', () => {
    const store = new MetricsStore(['ALFA', 'BETA']);
    store.add(pack([1, 10200, 30, 10196, 10200, 600, 400]), 1);
    const [alfa, beta] = store.snapshot();
    expect(alfa).toEqual(emptyRow('ALFA'));
    expect(beta).toEqual({ ...exampleRow, symbol: 'BETA', volume: 30n, vwapCents: 10200 });
  });

  test('K03 reads only updateCount updates from a reused buffer', ({ store }) => {
    store.add(example, 1);
    expect(store.snapshot()[0].volume).toBe(10n);
  });

  test('K06 imbalance is null when both book quantities are zero', ({ store }) => {
    store.add(pack([0, 100, 1, 99, 100, 0, 0]), 1);
    expect(store.snapshot()[0].imbalance).toBeNull();
  });

  test('K09 stays exact over a long run', ({ store }) => {
    const big = pack([0, 2_000_000_000, 1000, 1_999_999_999, 2_000_000_000, 1, 1]);
    for (let i = 0; i < 10_000; i++) store.add(big, 1);
    const [row] = store.snapshot();
    expect(row.volume).toBe(10_000_000n);
    expect(row.vwapCents).toBe(2_000_000_000);
  });

  test('K11 snapshot returns copies', ({ store }) => {
    const before = store.snapshot();
    store.add(example, 2);
    expect(before[0]).toEqual(emptyRow('ALFA'));
  });
});
```

- [ ] **Step 2: Run** `pnpm test -- --run src/app/producer/metrics.spec.ts` — expected FAIL: `not implemented`.
- [ ] **Step 3: Commit** — `git commit -m "test(worker): metrics specs (red)"`.

---

### Task 3.3: Implement metrics (green)

- [ ] **Step 1:** `vwapCents`: `volume === 0n ? null : Number((notional * 100n) / volume) / 100`. `imbalance`: `total === 0 ? null : (bid - ask) / total`. `spreadCents`: `ask - bid`.
- [ ] **Step 2:** `MetricsStore`: per-instrument state in parallel arrays — `last`, `bid`, `ask`, `bidQty`, `askQty` as numbers with a `hasData` flag; `volume`, `notional` as `bigint[]`. `add` loops `updateCount` updates at stride `FIELDS_PER_UPDATE` with `F` offsets: `volume += BigInt(qty)`, `notional += BigInt(price) * BigInt(qty)`, latest price/book overwrite. `snapshot` maps to new `MetricsRow`s; no data → `emptyRow(symbol)`.
- [ ] **Step 3: Run** the spec — expected PASS.
- [ ] **Step 4: Commit** — `git commit -am "feat(worker): metrics store"`.

---

### Task 3.4: Controller tests (red)

**Files:** Create `src/app/producer/testing/fake-wasm.ts`, `src/app/producer/producer-controller.spec.ts`

- [ ] **Step 1:** `testing/fake-wasm.ts` (shared test double, owned by this module):

```ts
import type { WasmProducer } from '../wasm-api';

/** Writes `updatesPerBatch` updates of qty 1, round-robin over instruments. */
export class FakeWasm implements WasmProducer {
  inits: Array<[seed: number, instruments: number, updates: number, dstLength: number]> = [];
  batches = 0;
  initResult: string | null = null;
  private n = 0;
  private k = 0;
  private dst = new Int32Array(0);

  init(seed: number, n: number, k: number, dst: Int32Array) {
    this.inits.push([seed, n, k, dst.length]);
    if (this.initResult === null) {
      this.n = n;
      this.k = k;
      this.dst = dst;
    }
    return this.initResult;
  }

  nextBatch() {
    for (let i = 0; i < this.k; i++) this.dst.set([i % this.n, 10000, 1, 9999, 10000, 10, 10], i * 7);
    this.batches++;
  }
}
```

- [ ] **Step 2:** `producer-controller.spec.ts` — Vitest fixtures own setup/teardown (fake timers, controller lifecycle); `wasmSource` is overridable per describe via `test.scoped`:

```ts
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
```

If `test.scoped` is missing in the installed Vitest, create a second `test.extend` overriding `wasmSource`.

- [ ] **Step 3: Run** `pnpm test -- --run src/app/producer/producer-controller.spec.ts` — expected FAIL: `not implemented`.
- [ ] **Step 4: Commit** — `git add src/app/producer && git commit -m "test(worker): producer controller specs (red)"`.

---

### Task 3.5: Implement controller (green)

- [ ] **Step 1:** Private state: `runId = 0`, `state: 'idle' | 'running' | 'paused' | 'error'`, `settings`, `ints`, `view`, `store`, `batchTimer`, `emitTimer`. Constructor: `deps.wasm.catch(() => {})`.
- [ ] **Step 2:** `handle` dispatches on `type` per the behaviour section. After `await deps.wasm`: `if (message.runId !== this.runId) return;`.
- [ ] **Step 3:** `scheduleBatch()` = `setTimeout(() => { tick(); scheduleBatch(); }, batchIntervalMs)`; `emitTimer = setInterval(emit, refreshMs)`; `stopTimers()` clears both; `emit()` posts `{ type: 'snapshot', runId, rows: store.snapshot() }`.
- [ ] **Step 4: Run** the spec — expected PASS (11 tests).
- [ ] **Step 5: Commit** — `git commit -am "feat(worker): producer controller"`.

---

### Task 3.6: Wasm loader and worker entry

The loader's error paths are unit-tested (K21, K22). The successful path and the worker entry are browser-only glue, checked end to end in 05 (K24).

- [ ] **Step 0: Write failing test** `src/app/producer/wasm-loader.spec.ts`:

```ts
import { test as base } from 'vitest';
import { loadWasmProducer, type LoaderDeps } from './wasm-loader';

const test = base.extend<{ deps: LoaderDeps }>({
  deps: async ({}, use) =>
    use({ fetch: vi.fn(async () => new Response(null, { status: 404 })), littleEndian: true }),
});

describe('loadWasmProducer', () => {
  test('K21 reports the HTTP status of a failed fetch', async ({ deps }) => {
    await expect(loadWasmProducer('/producer.wasm', deps)).rejects.toThrow('Failed to load /producer.wasm: HTTP 404');
  });

  test('K22 rejects a big-endian platform before fetching', async ({ deps }) => {
    await expect(loadWasmProducer('/producer.wasm', { ...deps, littleEndian: false })).rejects.toThrow(
      'Big-endian platforms are not supported',
    );
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});
```

Run it and confirm it FAILS (stub throws `not implemented`). Commit: `git commit -m "test(worker): wasm loader specs K21 K22 (red)"`.

- [ ] **Step 1:** `wasm-loader.ts`: endianness check first (exported as `isLittleEndian()` with a one-line comment pointing to the memory model); side-effect `import './wasm_exec.js'`; `const response = await fetch(url)`; non-OK → `Failed to load ${url}: HTTP ${response.status}`; `const go = new Go()`; `WebAssembly.instantiateStreaming(Promise.resolve(response), go.importObject)` — failure → `Failed to start ${url}: ${cause.message}`; `void go.run(instance)`; `await Promise.resolve()`; return `globalThis.producer` or reject `producer.wasm did not register the producer API`.
- [ ] **Step 2:** Replace the `producer.worker.ts` stub (no `/// <reference lib="webworker" />` — it clashes with the `dom` lib in the shared tsconfig):

```ts
import { ProducerController } from './producer-controller';
import type { FromWorker, ToWorker } from './protocol';
import { loadWasmProducer } from './wasm-loader';
import { environment } from '../../environments/environment';

const scope = self as unknown as {
  postMessage(message: FromWorker): void;
  addEventListener(type: 'message', listener: (e: MessageEvent<ToWorker>) => void): void;
};

const controller = new ProducerController({
  wasm: loadWasmProducer(environment.wasmUrl),
  refreshMs: environment.uiRefreshMs,
  post: (m) => scope.postMessage(m),
  seed: () => crypto.getRandomValues(new Uint32Array(1))[0],
});

scope.addEventListener('message', (e) => void controller.handle(e.data));
```

- [ ] **Step 3: Verify** `pnpm typecheck` and `pnpm test -- --run` — exit 0.
- [ ] **Step 4: Commit** — `git commit -am "feat(worker): wasm loader and worker entry"`. Report to the orchestrator: test output.
