# findev-test — Realtime Fintech Dashboard

An [AnalogJS](https://analogjs.org) (Angular 22) app with a live market dashboard and producer settings. A Go WebAssembly library generates simulated market updates inside a Web Worker. The task statement is in [TASK.md](TASK.md), and progress and decisions are in [progress.md](progress.md).

## Prerequisites

- Node ≥ 22.22.3 and pnpm
- Go 1.27.1 (builds the Wasm producer)

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install dependencies (see *Blocked dependency builds* below) |
| `pnpm dev` | Dev server at http://localhost:5173 |
| `pnpm build` | Builds `public/producer.wasm`, then the app; prerendered static output in `dist/analog/public` |
| `pnpm test -- --run` | Builds the Wasm, then runs all Vitest specs once (`pnpm test` watches) |
| `pnpm test:go` | Go unit tests of the market model (`wasm/generator`) |
| `pnpm typecheck` | TypeScript check of app and specs |
| `pnpm build:wasm` | Only rebuild `public/producer.wasm` and copy Go's `wasm_exec.js` |

`public/producer.wasm` and `src/app/producer/wasm_exec.js` are build outputs. They are gitignored and recreated by `build`/`test`.

## Architecture

```
Angular (main thread)                    Web Worker                         Go Wasm
---------------------                    ----------                         -------
ProducerService (root, one per app)      ProducerController                 generator + one-level order books
  rxWorker()  ── apply/pause/resume ──>    run lifecycle, timers   ── init(seed, n, k, Int32Array) ──>
  signals: status, rows, settings          MetricsStore (BigInt)   ── nextBatch() ──> fills Int32Array
  drops messages of older runIds <── snapshot every 1 s ──
Pages: / dashboard, /settings (prerendered; skeleton until the producer runs)
```

The module boundaries are typed contracts:
- **Wasm ↔ worker:** `WasmProducer` in `src/app/producer/wasm-api.ts`.
- **Worker ↔ UI:** `ToWorker` / `FromWorker` / `ProducerConfig` in `src/app/producer/protocol.ts`.

### Where things happen

- **Market model (Go, `wasm/generator`).** Each instrument has a one-level order book (best bid/ask and their shares). Per update:
  1. Pick an instrument uniformly at random. Gaps and repeats within a batch are allowed.
  2. Replace an exhausted level one gap further out and clamp the spread.
  3. A maker adds a dollar budget of shares, either joining the best price or improving it by 1¢.
  4. A taker spends a dollar budget at the best ask (buy) or bid (sell), filling `min(budget/price, shares at the level)`. That fill is the trade.

  Every number is in `ModelConfig` / `DefaultModelConfig()` (`wasm/generator/config.go`). Randomness is a seeded PCG, so the same seed gives the same stream.
- **Metrics (worker, `metrics.ts`).** These are cumulative since the run started, not rolling windows:
  - last price;
  - spread = ask − bid;
  - volume = Σ trade qty;
  - VWAP = Σ(price × qty) / Σ qty;
  - imbalance = (bidQty − askQty) / (bidQty + askQty).

  Volume and Σ(price × qty) are `bigint`, so totals stay exact on long runs. A zero denominator gives `null`, which is shown as `—`. No event history is kept.
- **UI (`ProducerService`).** It's a root service, so navigation never creates a second producer.
  - The producer is started after the first render (`afterNextRender`). The worker chunk is loaded with a dynamic `import('./producer.worker?worker')`, so bootstrap never waits for it.
  - Instruments are the S&P 500 tickers in `public/resources/sp500.json` (from Wikipedia, 2026-10-28), sliced to *Instrument count* and sent to the worker in every `apply`.
  - Each run has a `runId`. The UI resets its rows immediately on Apply and ignores late messages from older runs.
- **Refresh rate.** The worker posts one snapshot per `environment.uiRefreshMs` (1000 ms) whatever the generation rate. Every generated trade is still counted.

### Wasm → worker memory model

1. The worker allocates **one `Int32Array` per run** (`updatesPerBatch × 7` elements) and passes it to `init`.
2. Go keeps it for the run. `syscall/js` only copies in bulk into a `Uint8Array` (`js.CopyBytesToJS`), so in `init` Go creates a `Uint8Array` **view** over the same memory: `dst.buffer` from `dst.byteOffset`, `updatesPerBatch × 28` bytes. It's a view, not a copy.
3. `nextBatch()` fills a reused Go slice, encodes it as little-endian int32 into a reused `[]byte` and does **one** `CopyBytesToJS`. That's at most 28 KB per batch with zero allocations. The worker then reads the values through its `Int32Array`.
4. Wasm is little-endian and typed arrays use the platform's byte order. The worker checks for little-endian at load time instead of assuming it.

The full explanation is in the doc comments of `src/app/producer/wasm-api.ts` and `wasm/main.go`.

### Layout

```
wasm/main.go                    JS bridge (syscall/js), memory model docs
wasm/generator/                 market model: config.go, book.go, generator.go, encode.go (+ tests)
public/resources/sp500.json     instrument list (fetched at runtime)
src/environments/environment.ts the only reader of import.meta (base URL, wasm URL, refresh rate)
src/app/producer/               protocol, wasm contract, worker (controller, metrics, loader), service, rxWorker
src/app/shared/                 cents and bigint pipes, formatBigInt
src/app/settings/               signal-forms settings schema
src/app/pages/                  index.page.ts (dashboard), settings.page.ts (Tailwind only, no SCSS)
src/app/dashboard/              market-table, status-badge components (own SCSS)
src/testing/                    test fixtures (producer stub, fake worker)
```

### Testing

Every requirement has an ID, and every test name starts with the ID or IDs it proves:
- `W..`: Wasm
- `K..`: worker
- `U..`: UI
- `C..`: shared contracts

The tables are in `docs/superpowers/plans/2026-10-28-realtime-dashboard/0*.md`. `grep -rn W07 wasm src` lists the evidence for one requirement. Generator tests use fixed seeds, and timing tests use Vitest fake timers, so nothing waits on real time.

Stack: Angular Material for the table, buttons and form fields; SCSS for the theme and component styles; Tailwind 4 (`src/tailwind.css`) for layout (flex, gap, padding, sizes). Pages have no stylesheet: they use only Tailwind classes and compose components (`src/app/dashboard/`) that own their SCSS.

## Blocked dependency builds

The following dependencies have their install/postinstall scripts explicitly disabled with `allowBuilds: false` in `pnpm-workspace.yaml`:

- `@parcel/watcher`
- `esbuild`
- `lmdb`
- `msgpackr-extract`

These scripts build or configure platform-specific components. The packages are still installed, but pnpm does not run their build scripts. Use pnpm for installation so this policy is applied.

If a dependency requires its build script, review the script, set that package's `allowBuilds` entry to `true`, and run `pnpm rebuild <package>`. For example, after allowing `esbuild`, run `pnpm rebuild esbuild`.
