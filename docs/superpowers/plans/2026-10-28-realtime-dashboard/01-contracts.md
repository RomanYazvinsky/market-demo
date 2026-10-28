# Part 01 — Shared contracts (sequential)

Read `00-overview.md` first. This part runs once, on `feat/realtime-dashboard`, before the modules fork. It fixes every boundary between wasm, worker and UI so the three modules can be built and tested without each other.

Boundaries:

```
Go wasm ──(WasmProducer + wire layout)──> worker ──(ToWorker / FromWorker)──> UI
```

## Requirements → tests

Every test name starts with the ID(s) it proves; `grep -rn "<ID>" src` lists the evidence. A requirement without a test states why. Source: **T** = TASK.md, **S** = design spec / author decision, **C** = contract in this plan.

| ID | Requirement | Src | Test |
|---|---|---|---|
| C01 | The instrument list is a JSON array of ≥ 500 unique tickers, enough for the maximum instrument count | S | `symbols.spec.ts` › `C01 is an array of enough unique tickers for the largest run` |
| C02 | Every entry is ticker-shaped (`AAPL`, `BRK.B`) | S | `C02 contains only ticker-shaped strings` |
| C03 | The list is real S&P 500 data | S | `C03 includes well-known constituents` |
| C04 | `toProducerConfig` slices the list to `instrumentCount` and carries batch size and interval unchanged | S | `C04 slices the list to instrumentCount and keeps the rest` |
| C05 | The config's `symbols` is a fresh array (safe to post to the worker) | S | `C05 returns a fresh array` |
| C06 | Shared contracts (`protocol.ts`, `wasm-api.ts`, `wasm_exec.d.ts`) compile and are the only cross-module types | C | — *Enforced by types:* `pnpm typecheck`; module ownership rules in `00-overview.md`. |
| C07 | Only `src/environments/environment.ts` reads `import.meta` | S | — *Review check:* `grep -rn "import.meta" src \| grep -v "environments/\|vite-env.d.ts"` is empty. |
| C08 | Settings defaults and limits match TASK.md §2 (5 / 100 / 500; 1–50, 1–1000, 50–2000) | T | Values are in `protocol.ts`; behaviour tested in 04 as `U23` (form limits) and `U05` (defaults). |

---

### Task 1.1: Branch and tooling

**Files:**
- Modify: `package.json`, `vite.config.ts`, `.gitignore`, `progress.md`
- Create: `scripts/build-wasm.sh`, `src/test-setup.ts`, `tsconfig.spec.json`
- Delete: `public/wasm_exec.js`

- [ ] **Step 1:** `git checkout -b feat/realtime-dashboard`
- [ ] **Step 2:** Dependencies (done here so no module edits `package.json`):
  - `pnpm add @angular/material@^22 @angular/cdk@^22` (`@angular/animations@^22` only if Material's peer deps require it)
  - `pnpm add -D sass @testing-library/angular @testing-library/dom @testing-library/user-event @testing-library/jest-dom`
  - Tailwind stays (layout utilities only). Keep `tailwindcss` + `@tailwindcss/vite`.
- [ ] **Step 2b: SCSS + Tailwind side by side.** Tailwind 4 cannot be processed through Sass, so it gets its own plain CSS entry:
  - `src/tailwind.css`: `@import 'tailwindcss';` (only this line; utilities for layout — flex/grid/gap/spacing/responsive).
  - `git mv src/styles.css src/styles.scss`; drop its `@import 'tailwindcss'`; keep base `:root` styles (module 04 adds the Material theme).
  - `index.html`: link `/src/tailwind.css` first, then `/src/styles.scss` (theme and component styles win over preflight).
  - Rule: Tailwind classes in templates for layout; SCSS for theming and component look. No `@apply` in component SCSS. Set `analog({ vite: { inlineStylesExtension: 'scss' } })` so inline component styles are SCSS too; component files use `styleUrl: './x.scss'`.
- [ ] **Step 2c: SSR + prerender (SSG for static hosting).** In `vite.config.ts`: `analog({ ssr: true, static: true, prerender: { routes: async () => ['/', '/settings'] }, … })`. Keep `src/main.server.ts` and `app.config.server.ts`. Add `worker: { format: 'es' }` (module worker with ES imports, loaded via `?worker`). Ensure `src/vite-env.d.ts` has `/// <reference types="vite/client" />` (types for `?worker` and `import.meta.env`).
- [ ] **Step 3:** `scripts/build-wasm.sh`:
  ```sh
  #!/bin/sh
  set -e
  cd "$(dirname "$0")/../wasm"
  GOOS=js GOARCH=wasm go build -o ../public/producer.wasm .
  cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" ../src/app/producer/wasm_exec.js
  ```
- [ ] **Step 4:** `package.json` scripts (keep existing):
  ```json
  "build:wasm": "sh scripts/build-wasm.sh",
  "prebuild": "pnpm build:wasm",
  "pretest": "pnpm build:wasm",
  "test:go": "cd wasm && go test ./...",
  "typecheck": "tsc -p tsconfig.spec.json --noEmit"
  ```
- [ ] **Step 5:** `.gitignore`: add `/public/producer.wasm`, `/src/app/producer/wasm_exec.js`. `git rm public/wasm_exec.js`.
- [ ] **Step 6:** `vite.config.ts` — add to the returned config:
  ```ts
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
  },
  ```
- [ ] **Step 7:** `src/test-setup.ts` (zoneless, per `@analogjs/vitest-angular` README; side-effect imports first):
  ```ts
  import '@angular/compiler';
  import '@analogjs/vitest-angular/setup-snapshots';
  import '@analogjs/vitest-angular/setup-serializers';
  import '@testing-library/jest-dom/vitest';

  import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';

  setupTestBed();
  ```
- [ ] **Step 7b: Environment module** — the only file that reads `import.meta`:
  ```ts
  // src/environments/environment.ts
  /// <reference types="vite/client" />
  // Vite replaces import.meta.env.* with literals at build time (like Angular's fileReplacements,
  // but per build mode), so this works in the SPA, the prerender and the worker bundle alike.
  export const environment = {
    production: import.meta.env.PROD,
    /** App base path ('/' locally, '/<repo>/' on GitHub Pages). */
    baseUrl: import.meta.env.BASE_URL,
    /** Worker -> UI snapshot rate. Pre-configured, not a user setting. */
    uiRefreshMs: 1000,
    /** Served from public/ as-is, so it needs the base path. */
    wasmUrl: `${import.meta.env.BASE_URL}producer.wasm`,
    /** Instrument list, a static resource in public/resources/. */
    symbolsUrl: `${import.meta.env.BASE_URL}resources/sp500.json`,
  } as const;
  ```
  Everything else imports `environment`; `import.meta` anywhere else is a review failure (`grep -rn "import.meta" src | grep -v environments/` must be empty, except `import.meta.env` typings in `vite-env.d.ts`).
- [ ] **Step 8:** `tsconfig.spec.json`: extends `./tsconfig.json`; `compilerOptions.types: ["vitest/globals", "node"]`; `include: ["src/**/*.ts"]`. Add `@types/node` dev dependency if missing.
- [ ] **Step 9:** Append to `progress.md`:
  ```md
  # Implementation checklist
  Plan: docs/superpowers/plans/2026-10-28-realtime-dashboard/
  - [x] 01 Contracts: tooling
  - [ ] 01 Contracts: boundary types
  - [ ] 02 Wasm
  - [ ] 03 Worker
  - [ ] 04 UI
  - [ ] 05 Integration
  - [ ] 05 Docs
  - [ ] 05 Deploy
  ```
- [ ] **Step 10: Verify** `pnpm build:wasm` exits 0 (current `main.go` with `goAdd` still compiles) and produces `public/producer.wasm` + `src/app/producer/wasm_exec.js`. `pnpm build` exits 0 and writes prerendered `dist/analog/public/index.html` (still the Analog welcome page — 04 replaces it).
- [ ] **Step 11: Commit** — `git add -A && git commit -m "chore: tooling for wasm build, vitest and material"`

---

### Task 1.2: Wasm ↔ worker contract

**Files:**
- Create: `src/app/producer/wasm-api.ts`, `src/app/producer/wasm_exec.d.ts`

**`wasm-api.ts`** (write as-is):

```ts
/**
 * JS surface registered by wasm/main.go on `globalThis.producer`.
 *
 * ## Data layout
 * One update is 7 int32 values (FIELDS_PER_UPDATE; offsets in `F`):
 *   [instrumentIndex, priceCents, tradeQuantity, bidCents, askCents, bidQuantity, askQuantity]
 * A batch of k updates occupies the first k * 7 elements of the run's Int32Array.
 *
 * ## Memory model — how a batch gets from Go into the worker
 * 1. The worker allocates ONE Int32Array per run (length updatesPerBatch * 7) and hands it to `init`.
 * 2. Go keeps a reference to it for the whole run. Go's own memory and JS memory are separate,
 *    so Go cannot write into the Int32Array directly; the only bulk copy primitive syscall/js
 *    offers is `js.CopyBytesToJS(dst, src []byte)`, which accepts only a Uint8Array destination.
 *    Therefore, inside `init`, Go creates `new Uint8Array(dst.buffer, dst.byteOffset, dst.byteLength)`:
 *    a second *view* over the same ArrayBuffer (no new memory, no copy). This is a Go-side
 *    implementation detail; JS only ever sees the Int32Array.
 * 3. `nextBatch()` generates the updates, encodes them into a reused Go []byte as
 *    little-endian int32, and performs exactly one CopyBytesToJS into that byte view.
 *    After it returns, the worker reads the values through its Int32Array.
 *    Per batch: one bulk copy (max 28 KB), zero allocations on either side.
 * 4. Byte order: Wasm memory is little-endian by spec; JS typed arrays use the platform's
 *    byte order. All supported browser platforms are little-endian; the worker verifies this
 *    at load time (`loadWasmProducer` rejects on a big-endian platform) instead of assuming it.
 *
 * Rejected alternatives: writing element by element via `dst.SetIndex` (7,000 JS calls per
 * batch); reading Go's linear memory from JS by pointer (depends on wasm_exec.js internals,
 * the view detaches whenever Go's memory grows).
 */
export interface WasmProducer {
  /**
   * Starts a new run: seeds the PRNG, creates per-instrument state and binds `dst` as the
   * output buffer for every following `nextBatch()`.
   * Returns null on success, otherwise a readable error:
   *  - instrumentCount outside 1–50, updatesPerBatch outside 1–1000,
   *  - `dst` not an Int32Array, or shorter than updatesPerBatch * 7.
   * On error the previous run (state and bound buffer) is left untouched.
   */
  init(seed: number, instrumentCount: number, updatesPerBatch: number, dst: Int32Array): string | null;

  /**
   * Overwrites the first updatesPerBatch * 7 elements of the bound Int32Array with a new batch.
   * Generator state (prices, book) carries over between calls. No-op before a successful init.
   */
  nextBatch(): void;
}
```

**`wasm_exec.d.ts`** (write as-is; types the gitignored `wasm_exec.js` copy):

```ts
import type { WasmProducer } from './wasm-api';

declare global {
  class Go {
    importObject: WebAssembly.Imports;
    run(instance: WebAssembly.Instance): Promise<void>;
  }
  // eslint-disable-next-line no-var
  var producer: WasmProducer | undefined;
}
```

- [ ] **Step 1:** Write both files.
- [ ] **Step 2: Verify** `pnpm typecheck` — exit 0.

---

### Task 1.3: Worker ↔ UI contract and shared helpers

**Files:**
- Create: `src/app/producer/protocol.ts`, `src/app/producer/symbols.ts`, `src/app/producer/symbols.spec.ts`
- Create (stub, owned by 03 afterwards): `src/app/producer/producer.worker.ts`

**`protocol.ts`** (write as-is):

```ts
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
export const F = {
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
```

Protocol semantics both sides rely on (tested in 03 and 04):
- After `apply`, the worker posts `status initializing`, then `status running` or `status error` (with `error`).
- Every run, including the first one on start, begins with `apply` carrying the full `ProducerConfig`.
- While running, the worker posts a `snapshot` every `environment.uiRefreshMs`; rows are in `config.symbols` order with exactly those symbols.
- `pause` → one `snapshot` (so every generated trade is visible), then `status paused`. `resume` → `status running`.
- The UI resets its rows to `emptyRow`s itself on apply; the worker does not send an empty snapshot.

**Instrument list.** It is a static resource that the UI fetches at runtime and passes to the worker inside the config:

- `public/resources/sp500.json`: a JSON array of current S&P 500 ticker symbols (≈503 strings), in the order of Wikipedia's "List of S&P 500 companies" constituents table, fetched when this task runs. Record the source and date in the commit message. Class-share tickers keep their dot (`BRK.B`, `BF.B`).
  - It is served as-is from `public/`, so it isn't in the JS bundle and can be updated without a rebuild of the code.
  - Its URL is `environment.symbolsUrl` (add `symbolsUrl: \`${import.meta.env.BASE_URL}resources/sp500.json\`` to the environment module).
  - Module 04 loads it.
- `src/app/producer/symbols.ts` (pure, no I/O):
  ```ts
  /** symbols = all.slice(0, settings.instrumentCount); returns a fresh array (safe to post). */
  export function toProducerConfig(settings: ProducerSettings, all: readonly string[]): ProducerConfig;
  ```

- [ ] **Step 1: Write failing test** `symbols.spec.ts`. It validates the shipped resource from disk and pins `toProducerConfig`:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_SETTINGS, SETTINGS_LIMITS } from './protocol';
import { toProducerConfig } from './symbols';

const sp500: string[] = JSON.parse(readFileSync(resolve(process.cwd(), 'public/resources/sp500.json'), 'utf8'));

describe('public/resources/sp500.json', () => {
  it('C01 is an array of enough unique tickers for the largest run', () => {
    expect(Array.isArray(sp500)).toBe(true);
    expect(sp500.length).toBeGreaterThanOrEqual(500);
    expect(new Set(sp500).size).toBe(sp500.length);
    expect(sp500.length).toBeGreaterThanOrEqual(SETTINGS_LIMITS.instrumentCount.max);
  });

  it('C02 contains only ticker-shaped strings', () => {
    sp500.forEach((s) => expect(s).toMatch(/^[A-Z]{1,5}(\.[A-Z])?$/));
  });

  it('C03 includes well-known constituents', () => {
    expect(sp500).toEqual(expect.arrayContaining(['AAPL', 'MSFT', 'BRK.B']));
  });
});

describe('toProducerConfig', () => {
  const all = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META'];

  it('C04 slices the list to instrumentCount and keeps the rest', () => {
    expect(toProducerConfig(DEFAULT_SETTINGS, all)).toEqual({
      symbols: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL'],
      updatesPerBatch: 100,
      batchIntervalMs: 500,
    });
  });

  it('C05 returns a fresh array', () => {
    expect(toProducerConfig(DEFAULT_SETTINGS, all).symbols).not.toBe(toProducerConfig(DEFAULT_SETTINGS, all).symbols);
  });
});
```

- [ ] **Step 2: Run** `pnpm test -- --run src/app/producer/symbols.spec.ts`. Expected: FAIL (the resource and module are missing).
- [ ] **Step 3: Implement.** Fetch the list, write `public/resources/sp500.json`, and add `toProducerConfig` as specified.
- [ ] **Step 4: Run.** Expected: PASS. Test names match C01–C05 in the table.
- [ ] **Step 5:** `producer.worker.ts` stub: `export {};` (lets module 04 build `import('./producer.worker?worker')` before 03 lands). Vite's `?worker` import bundles the worker as its own chunk and derives its URL from `base`, so no URL is needed for the worker itself; only `public/producer.wasm` needs the base path (`environment.wasmUrl`).
- [ ] **Step 6: Verify** `pnpm typecheck` and `pnpm test -- --run` — exit 0.
- [ ] **Step 7:** Tick "01 Contracts: boundary types". **Commit** — `git add -A && git commit -m "feat: shared producer contracts"`.

---

### Task 1.4: Fork module worktrees

- [ ] **Step 1:** From `feat/realtime-dashboard` create three worktrees (superpowers:using-git-worktrees), e.g. `../findev-wasm` on `feat/wasm`, `../findev-worker` on `feat/worker`, `../findev-ui` on `feat/ui`. Branches are local only (no remote), so no upstream fix-up is needed.
- [ ] **Step 2:** In each worktree: `pnpm install`.
- [ ] **Step 3:** Dispatch 02, 03, 04 in parallel, each with `00-overview.md`, `01-contracts.md` and its own module file. Each agent reports: tests added, final `pnpm test -- --run` / `pnpm test:go` output, any contract change it needed (should be none).
