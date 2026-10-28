# Realtime Fintech Dashboard — Design

Working document for planning. Not part of the final release; project docs live in `README.md` and `progress.md`.

Source of requirements: `TASK.md` (everything there is binding; this document records how we meet it).

## Intent

Interview take-home: an Angular (AnalogJS) app with a live market dashboard and a producer settings page. A Go Wasm library generates simulated market updates inside a Web Worker. The author must be able to explain and modify every part during the interview, so the design favours simple, explicit, testable pieces over clever ones.

## Goals

- All TASK.md requirements: two pages, five metrics, pause/resume, status, validated settings with Apply/reset, Wasm generator in a worker, unit tests, README, auto-deploy.
- UI stays responsive as the generation rate rises (up to 1000 updates / 50 ms = 20k updates/s).
- Every generated trade counts toward volume and VWAP, even though the UI refreshes far less often.

## Non-goals

- Realistic exchange model, order matching, persistence across reloads, e2e tests, benchmarks.

## Anti-goals

- Metrics or randomness computed in TypeScript with Wasm as a trivial wrapper.
- Retaining full event history.
- A second producer created by navigation, or old-run data leaking into a new run.

## Decided by the author

- **Wasm language:** Go, standard toolchain (Go 1.27.1, `GOOS=js GOARCH=wasm`), `wasm_exec.js` from the installed Go.
- **Transport Wasm -> worker:** `Int32Array`, not JSON.
- **Per-instrument totals live in the worker.** Angular only formats and renders.
- **Worker -> UI emit rate:** once per second by default, pre-configured constant (not in Settings form). Animation-frame rate is unreadable for a human.
- **Existing work kept:** `wasm/types.go` defines Go-side serialization to the int32 array; `progress.md` analysis is kept and extended.
- **Deploy target/base path:** decided at the deploy step.
- **Run identity:** every message carries a `runId`; UI drops messages whose `runId` is not current.
- **Single producer:** one root-provided Angular service owns the worker; Apply re-seeds Wasm and resets worker totals.
- **Big sums:** `sum(price x qty)` and volume use `BigInt` in the worker (structured clone supports BigInt, no string encoding needed).
- **UI library:** Angular Material (`mat-table`, form fields, buttons).
- **Deploy:** GitHub Pages via GitHub Actions, done as the last step.
- **Docs:** `README.md` (build/run/test, architecture overview) and `progress.md` (decisions, task checklist).

## Architecture

```
Angular (main thread)                 Web Worker                       Go Wasm
---------------------                 ----------                       -------
ProducerService (root) --apply------> ProducerWorker  --init(seed,n)--> generator state
  runId, status signal  --pause/resume  batch timer   --nextBatch(k)--> Int32Array (7 x k)
  rows signal         <--snapshot----  MetricsStore (BigInt totals)
                      <--status------  emit timer (default 1000 ms)
```

### Go Wasm (`wasm/`)

- `wasm/generator/` — pure Go package, no `syscall/js`, so `go test ./...` runs natively. Holds per-instrument state and a seeded PRNG (`math/rand/v2` with a PCG source).
  - `New(seed uint64, instrumentCount int) *Generator`
  - `NextBatch(dst []MarketUpdate)` — fills `len(dst)` updates in place. Wire layout per update, 7 int32s: `[instrumentIndex, priceCents, tradeQuantity, bidCents, askCents, bidQuantity, askQuantity]`.
  - Model: per-instrument mid price random walk from a seeded starting price; spread >= 1 cent; bid < ask; bid >= 1; trade price is the bid or the ask of that update; tradeQuantity >= 1; book quantities >= 0. Instrument for each update chosen at random (repeats allowed).
- `wasm/types.go` — author's `MarketUpdate` / `Settings` types, used only inside Go to define serialization of an update to 7 int32s (`Instrument int8` fits 50 instruments).
- `wasm/main.go` — `syscall/js` bridge only (the `goAdd` demo is removed). Exposes `init(seed, instrumentCount, updatesPerBatch)` and `nextBatch(dst Uint8Array)` on a global object. Init errors are returned to JS, not panicked.

#### Batch memory (author-approved approach)

Allocate once per run, reuse every batch: one copy per batch, zero steady-state allocations.

- Go, on `init`: allocate `[]MarketUpdate` and `[]byte` of `updatesPerBatch x 7 x 4` bytes (max 28 KB). `nextBatch` fills the updates in place, serializes them little-endian into the byte buffer, then `js.CopyBytesToJS(dst, buf)`.
- Worker, per run: one `Int32Array(updatesPerBatch x 7)`; passes a `Uint8Array` view of its buffer to `nextBatch`.
- Safe because the worker folds the batch into `MetricsStore` synchronously before the next tick, and raw batches are never posted to Angular.
- Rejected: fresh allocations per batch (GC churn), zero-copy reads of Go memory (relies on `wasm_exec.js` internals; view detaches on memory growth; saves only ~560 KB/s of copying).

So the generator API is `NextBatch(dst []MarketUpdate)` filling a caller-owned slice, rather than returning a new one.
- Seed: worker passes a fresh seed per run (e.g. from `crypto.getRandomValues`); tests pass fixed seeds.

### Worker (`src/app/producer/producer.worker.ts` + plain classes)

- Logic lives in plain TS classes (`MetricsStore`, `ProducerController`) so it is unit-testable without a real Worker; the worker file is a thin message adapter.
- Loads `wasm_exec.js` and the `.wasm` binary; reports `initializing` -> `running`, or `error` with a readable message.
- Batch loop: chained `setTimeout` at `batchIntervalMs` (no overlapping batches). Each batch goes straight into `MetricsStore`; the array is discarded.
- `MetricsStore` per instrument: `lastPriceCents`, latest `bid/ask/bidQty/askQty`, `volume: bigint`, `notional: bigint` (sum price x qty).
- Emit loop: every `uiRefreshMs`, post a snapshot. Also post one snapshot immediately on pause so the UI shows every trade generated before pausing.
- Pause stops both timers; resume restarts them without backfilling.
- Apply: stop timers, set new `runId`, re-init Wasm with a new seed and settings, reset store, start.

### Protocol

UI -> worker:
- `{ type: 'apply', runId, settings }`
- `{ type: 'pause', runId }`, `{ type: 'resume', runId }`

Worker -> UI:
- `{ type: 'status', runId, status: 'initializing' | 'running' | 'paused' | 'error', error? }`
- `{ type: 'snapshot', runId, rows: Row[] }`, where `Row = { symbol, lastPriceCents | null, spreadCents | null, volume: bigint, vwapCents: number | null, imbalance: number | null }`.

Snapshot rows already contain computed metrics; denominators of zero produce `null`. Metric functions are pure and shared-tested.

### Angular (`src/app/`)

- `ProducerService` (providedIn root): creates the worker once at app start in the browser (guarded for prerender), sends `apply` with defaults, exposes `rows`, `status`, `settings` signals, increments `runId` on Apply and resets `rows` immediately, drops stale messages, terminates the worker on app destroy.
- Dashboard page: `mat-table` with symbol, last price, spread, volume, VWAP, imbalance; Pause/Resume button; status indicator with error text. Prices as currency (USD), imbalance signed with 2 decimals, `null` shown as an unavailable placeholder, volume starts at 0.
- Settings page: reactive form, integers only, ranges from TASK.md plus the refresh interval. Editing does nothing until Apply; Apply starts a new run (also from paused).

### Settings

| Setting | Default | Range |
|---|---:|---:|
| Instrument count | 5 | 1-50 |
| Updates per batch | 100 | 1-1000 |
| Batch interval (ms) | 500 | 50-2000 |

UI refresh interval is not a user setting: a build-time constant (default 1000 ms) in app config, tuned before release.

## Testing

- Go: `go test ./wasm/...` with fixed seeds — batch sizes, value invariants over many batches, prices evolve from previous values, state retained between calls, instrument indices in range.
- Vitest: metric math (worked example from TASK.md, zero denominators, instrument isolation), settings validation, `ProducerController` reset on Apply, pause/resume (fake timers), stale `runId` rejection in `ProducerService`.

## Build

- `pnpm build:wasm` runs the Go build into `public/` and copies `wasm_exec.js`; `pnpm build` runs it first. CI installs Go.

## Left to the builder

- Instrument symbol generation for up to 50 instruments.
- Starting price range and random-walk step size.
- Exact Material theme and layout; routing between pages (`/` redirect to dashboard, nav links).
- Vite base path for GitHub Pages.

## Revisions (2026-10-28, author review of the plan)

These override anything above that conflicts:

- **SSR prerender + hydration** (`ssr: true, static: true`, routes `/` and `/settings`). Static content is always rendered. Producer-driven UI (table, Pause/Resume, status) shows a skeleton until the producer starts in the browser.
- **Worker start:** async `ProducerService.start()` is called from `App` in `afterNextRender`, not from an app initializer. It dynamically imports the worker via Vite `?worker`, so bootstrap is never blocked. The dashboard lives at `/`, so there is no redirect.
- **RxJS wrapper** `rxWorker()` around the Worker on the main thread.
- **Signal forms** (`@angular/forms/signals`) instead of reactive forms.
- **Angular pipes** (`currency`, `number`) plus our own `cents` and `bigint` pipes and a `formatBigInt` util.
- **SCSS** for global and component styles, with the Material theme in `styles.scss`. Tailwind is likely to be removed (open question).
- **Tests:** Angular Testing Library plus Vitest fixtures (`test.extend`).
- **Instruments are S&P 500 tickers** from `public/resources/sp500.json`, which the UI fetches at runtime. The UI slices the list to `instrumentCount` and sends it to the worker as `ProducerConfig.symbols` in every `apply`, including the first one.
- **No raw `import.meta`.** `src/environments/environment.ts` is the single reader (base URL, wasm URL, `uiRefreshMs`).
- **Wasm contract uses Int32Array only:** `init(seed, instrumentCount, updatesPerBatch, dst: Int32Array)` binds the run's buffer, and `nextBatch()` has no arguments. The Uint8Array byte view that `js.CopyBytesToJS` requires is created inside Go, once per init. It is documented in `wasm-api.ts`, in `main.go` and in the README. The worker checks endianness at load time.
- **Tailwind is kept** for layout utilities in its own `tailwind.css`. SCSS handles theme and component styles.
- **Order-driven market model** replaces the random walk. Each instrument keeps a one-level book (best bid and ask, with their quantities). Each update works as follows:
  1. The instrument is picked uniformly at random, so gaps and repeats are allowed by design.
  2. An exhausted level is replaced one gap further out, and the spread is clamped.
  3. A maker adds dollar-budget liquidity, either joining the best level or improving it by 1¢.
  4. A taker spends a dollar budget at the best ask or bid. It fills `min(budget/price, level shares)`, and that is the trade.

  Every number lives in Go's `ModelConfig` / `DefaultModelConfig()`. The author chose a Go-side config only, not exposed to JS. See `02-wasm.md`.
