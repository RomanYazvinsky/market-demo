# Requirements

This document splits the task into numbered requirements for the three modules (Wasm, Worker, UI) and the shared contracts between them. How they are met is described in [implementation.md](implementation.md).

## Traceability

- IDs: `W..` Wasm, `K..` worker, `U..` UI, `C..` shared contracts.
- Tests reference this document: every test name starts with the ID or IDs it proves, so `grep -rn W07 wasm src` lists the evidence for one requirement.
- Each module has a **Task** table (requirements that come from the task statement) and separate tables for requirements added while extending and improving the app; each of those says why it was added.
- Requirements without a unit test, and how they are checked:
  - W13, C06: enforced by types (`pnpm typecheck`, int32 wire format).
  - W14: `grep -rnE "Math\.random|crypto\.getRandomValues" src/app` shows only the seed in `producer.worker.ts`.
  - C07: `grep -rn "import.meta" src` shows only `environments/environment.ts` and `vite-env.d.ts`.
  - U28: `grep -rn "@apply" src` is empty.
  - U43: `ls dist/analog/public/instrument` lists 50 directories after `pnpm build`.
  - K24, U21: manual, in the running app (U21 at 1000 updates / 50 ms).
  - U45: the page reuses the shared `ProducerToggle`, whose behaviour is tested under U15.

Generator tests use fixed seeds and timing tests use Vitest fake timers, so no test waits on real time.

## 1. Wasm (Go generator, `wasm/`)


### Task

| ID | Requirement |
| --- | --- |
| W01 | Per-instrument state is retained between calls |
| W02 | A batch has exactly the requested number of updates |
| W03 | Updates per batch outside 1–1000 is rejected with a readable error |
| W04 | Instrument count outside 1–50 is rejected with a readable error |
| W05 | Instrument index is in [0, count); every instrument occurs; an instrument may repeat within a batch |
| W06 | Prices are positive (an exhausted bid never drops below 1¢) |
| W07 | Bid is below ask; spread stays within 1¢…`spreadCap(ask)` |
| W08 | Trade price is that update's bid or ask (buy at ask, sell at bid) |
| W09 | Trade quantities are positive (a budget below the price still buys 1 share) |
| W10 | Book quantities are non-negative |
| W11 | Prices evolve from previous values: a quote moves at most one level gap + spread cap + 1¢ per update, and prices do move |
| W12 | Generation is seeded: the same seed gives the same sequence (fixed-input tests) |
| W13 | Prices are integer cents |
| W14 | Randomness and price logic run in Wasm, not TypeScript |

### JS bridge and transport

| ID | Requirement | Why |
| --- | --- | --- |
| W15 | Wire layout is 7 little-endian int32 in the documented order | Int32Array transport instead of JSON; both sides must agree on field order and byte order. |
| W16 | No allocation per batch (buffers are reused) | At up to 20,000 updates/s, allocating per batch would churn the Go GC and the JS heap. |
| W17 | `globalThis.producer` exposes `init` and `nextBatch` | The worker finds the API on the global the Go program sets; this is the `wasm-api.ts` contract. |
| W18 | `init` rejects a `dst` that is not an Int32Array or is shorter than updatesPerBatch × 7 | A short or wrong buffer would make Go write past the batch. |
| W19 | A rejected `init` keeps the previous run and its buffer | A bad Apply must not leave the producer half-initialised. |
| W20 | `nextBatch` writes only inside the bound view (respects byteOffset, no overrun) | The worker may pass a subarray; writing outside it would corrupt neighbouring data. |
| W21 | Invalid argument types never crash the Go runtime; `init` takes `(config: { seed, instrumentCount, updatesPerBatch }, dst)` and names a missing or non-number field | A Go panic kills the runtime for good, so the worker could not recover without a reload. |
| W22 | `nextBatch` before any successful `init` is a no-op | Timers can fire around a failed or pending `init`. |

### Market model

| ID | Requirement | Why |
| --- | --- | --- |
| W23 | A taker fills `min(budget/price, shares at the level)`; the level loses exactly the filled shares | A trade cannot take more shares than rest at the best price; keeps book quantities non-negative (W10). |
| W24 | A level moves away only after it was exhausted (ask up only if askQty hit 0, bid down only if bidQty hit 0) | Prices move because liquidity is used up, not by a random walk. |
| W25 | Model numbers come from `ModelConfig`; invalid configs are rejected | All tunables in one place, so the model can be tuned (on the instrument page) without hunting constants. |
| W26 | A maker joining the best price adds `budget/price` shares to it | Makers refill liquidity, so not every taker empties the level. |
| W27 | With `SweepChancePct` a taker's budget is the level's value plus a normal order, so it empties the level (the rest is cancelled); this is what moves prices | Replaced a maker "improve by 1¢" step that created thin levels and moved quotes on 42% of updates. Sweeps make the rate of price moves a single setting (10%). |
| W28 | After a level moves away, the spread stays wide for N updates of that instrument (N uniform in 1–20); then the side opposite the last move gets a new level that returns the spread to its value before the first move. Moves during the wait keep that spread; the cap still applies | With sweeps alone the spread stayed at the cap. The other side following brings it back to a realistic width (median ~9 bps). |

## 2. Worker (`src/app/producer/`)


### Task

| ID | Requirement |
| --- | --- |
| K01 | Last traded price = price of the instrument's latest trade |
| K02 | Spread = ask − bid of the latest quote |
| K03 | Volume = sum of trade quantities since run start, each trade once; book quantities never count |
| K04 | VWAP = Σ(price × qty) / Σ qty, cumulative (not rolling) |
| K05 | Imbalance = (bidQty − askQty) / (bidQty + askQty) from the latest quote, within −1…+1 |
| K06 | A zero denominator gives an unavailable value (`null`) |
| K07 | Before any data: unavailable values and zero volume |
| K08 | Instruments are isolated from each other |
| K09 | Totals stay exact on long runs (BigInt, beyond 2^53) |
| K10 | Prices stay in cents; VWAP keeps two fractional cent digits, rounding happens only for display |
| K11 | No event history is retained; snapshots are independent copies |
| K12 | Apply initialises Wasm with a fresh seed and the config, reporting initializing → running |
| K13 | One batch per interval; a snapshot every `refreshMs`; every generated trade counts |
| K14 | Pause stops generation and flushes one final snapshot |
| K15 | Resume keeps values and totals and does not generate for the paused interval |
| K16 | Apply clears the previous run's totals; every later message carries the new runId |
| K17 | Apply also starts generation when the previous run was paused |
| K18 | Initialisation errors are reported with readable text, and no generation starts |
| K19 | Results of a previous run never leak into a new run (stale pause/resume ignored; an older apply can't start after a newer one) |
| K20 | Producer resources are cleaned up when replaced or disposed |
| K21 | The loader reports every load failure readably: HTTP error, invalid binary, module that never registers the API |

### Loading and transport

| ID | Requirement | Why |
| --- | --- | --- |
| K22 | The loader refuses big-endian platforms (memory model in `wasm-api.ts`) | The wire format is little-endian; on a big-endian platform the Int32Array would read garbage, so it fails loudly instead. |
| K23 | One Int32Array of `updatesPerBatch × 7` per run is bound in `init` and reused for every batch | The JS side of "no allocation per batch" (W16). |
| K24 | The worker entry wires controller, loader and environment | Thin glue between the Worker global and the controller, so all logic stays unit-testable. |

### Instrument page data

| ID | Requirement | Why |
| --- | --- | --- |
| K25 | The event log keeps the last 100 updates per instrument, oldest first, in fixed-size buffers | The instrument page needs per-update history; bounded because the complete event history must not be kept. |
| K26 | Events carry a run-wide sequence number and their batch time; instruments are isolated | The event table and the Live chart need an order and an x axis across batches. |
| K27 | Apply clears the event log; the watched symbol survives Apply | Like the totals (K16), old-run events must not show in a new run. |
| K28 | Snapshots carry the watched symbol's events (`null` when nothing is watched, `[]` when the symbol is not in the run) | Only the opened symbol is sent, so snapshots do not grow with the number of instruments. |
| K29 | A watch while running or paused posts a snapshot at once; before any run it posts nothing | The page fills immediately, also while paused, instead of waiting for the next snapshot. |
| K30 | Price history keeps one point per second per instrument (the last update of the second) for the last 300 seconds, in fixed-size buffers | On a busy ticker 100 events cover a fraction of a second; time windows need bounded per-second sampling. |
| K31 | Snapshots carry the watched symbol's per-second points; Apply clears them | Same as K27/K28 for the per-second points. |

### Performance hardening

| ID | Requirement | Why |
| --- | --- | --- |
| K32 | A long run at the largest settings keeps memory flat: JS heap growth < 2 MB and no Wasm memory growth over 5 million updates | Wasm memory grew to ~26 MB on long runs (see implementation.md, Go GC issue); this guards the fix. |
| K33 | The loader also loads a module served without the `application/wasm` MIME type | Some hosts serve `.wasm` as `application/octet-stream`, which `instantiateStreaming` rejects; found in review. |

## 3. UI (`src/app/`)

### Task

| ID | Requirement |
| --- | --- |
| U01 | The app starts with the default settings (5 / 100 / 500) |
| U02 | Exactly one producer: load is idempotent, navigation never creates another, none on the server |
| U03 | Status and snapshots of the current run update the UI state |
| U04 | Apply starts a new run and clears values and totals immediately |
| U05 | Results of a previous run never overwrite the new run's state |
| U06 | Pause/Resume act on the current run |
| U07 | Initialisation and runtime errors are shown with readable text (worker status, crash, missing list, chunk load) |
| U08 | The worker is terminated when the app is destroyed |
| U09 | Instruments are sliced to `instrumentCount` and sent as `ProducerConfig` on every apply |
| U10 | Prices are formatted as USD currency, rounded only for display |
| U11 | Imbalance is shown between −1 and +1 with two decimals |
| U12 | Volume is shown with grouped digits, including bigint values |
| U13 | Unavailable values are shown as `—`, and volume as 0, before data |
| U14 | The dashboard has one row per instrument with the five metrics |
| U15 | A Start / Pause / Resume control (Retry after an error, see U49), disabled while initializing |
| U16 | A basic producer status is shown |
| U17 | Settings must be integers within their ranges |
| U18 | Validation errors are readable |
| U19 | Editing the form does not affect the producer; Apply applies the edited settings once |
| U20 | Apply is disabled while the form is invalid |
| U21 | The UI stays usable as the generation rate rises |

### Infrastructure

| ID | Requirement | Why |
| --- | --- | --- |
| U22 | `rxWorker` delivers every worker message to every subscriber | The main thread talks to the worker only through the RxJS wrapper `rxWorker()`; several subscribers read one stream. |
| U23 | `send` posts to the worker; it does nothing after terminate | A Pause clicked after teardown must be harmless. |
| U24 | Worker `error`/`messageerror` become a stream error | A worker crash must reach the service as an error so it can be shown (U07). |
| U25 | `terminate` removes listeners, terminates the worker and completes the stream, once | Clean teardown on replace and destroy (U08), without leaking listeners. |
| U26 | Loading the producer never blocks bootstrap: it loads after the first render, in the browser | Loading Wasm and the worker chunk is slow; the first paint must not wait for it. |
| U27 | Prerendered pages always show static content (links, headings); producer-driven parts show a skeleton until started | Pages are prerendered for static hosting; the server has no worker, so producer-driven parts show a skeleton. |
| U28 | Layout uses Tailwind utilities; theme and component styles use SCSS (no `@apply`) | One place per concern: Tailwind for layout, SCSS for theme and components. |

### Dashboard and settings improvements

| ID | Requirement | Why |
| --- | --- | --- |
| U29 | Clicking a column header sorts ascending, then descending, then back to list order; rows without a value stay last; new snapshots are re-sorted | Find the biggest movers or the highest volume among up to 50 rows. |
| U30 | A search field filters rows by symbol (case-insensitive substring) and says when nothing matches | Find one instrument among up to 50 rows. |
| U31 | Apply on the settings page shows a green "Settings applied" status that disappears after 3 seconds | Apply otherwise gives no visible feedback on the settings page. |
| U32 | Instruments are shown as "full name (ticker)" (e.g. "Nvidia (NVDA)", just the ticker until names load); search and the Symbol sort use that label | Tickers alone are hard to read. |
| U33 | No run starts until Start is pressed: after loading the status is Idle with empty rows; Start runs the current settings, and Apply before Start also starts a run | The user decides when generation starts (easier to demo, no CPU use on load). Start uses the defaults, and Apply still starts a run as task §2 requires. |
| U34 | A status bar at the right of the toolbar: status, run time, Start/Pause/Resume and a settings icon link; the app name links to the dashboard | Status and run control visible on every page, not only on the dashboard. |
| U35 | The run time counts generating time from the worker's status messages (paused intervals excluded, reset on Apply), shown as m:ss / h:mm:ss | Shows how long the current run has generated and makes a pause visible. |
| U36 | The settings form is centered with a Back button: the previous page, or the dashboard when opened directly | With the nav tabs gone, the settings page needs a way back. |

### Instrument (chart) page

| ID | Requirement | Why |
| --- | --- | --- |
| U37 | `ProducerService.watch` sends the symbol to the worker (also before the first apply and to a replacement worker) and exposes its events | The page tells the worker which symbol to send (K28). |
| U38 | Events of a symbol that is no longer watched are ignored; Apply clears the events | A snapshot posted before the worker saw a new watch belongs to the previous symbol. |
| U39 | The event table lists events newest first: #, time, side (buy at ask), price, qty, bid × qty, ask × qty | Shows single updates (side, price, book) to check the generator. |
| U40 | The price chart shows trade, bid and ask per event; it is created in the browser only, updated with new events and destroyed with the component | Shows bid/ask bounce and quote moves. Browser only, because Chart.js needs a canvas. |
| U41 | `/instrument/:symbol` watches its symbol while open (following param changes), shows skeleton / not-in-run message / chart and log | One linkable page per ticker. |
| U42 | The dashboard symbol links to its instrument page | The way to open a ticker from the dashboard. |
| U43 | The instrument pages of the first 50 symbols are prerendered | Static hosting has no server routing; without prerendered pages a deep link returns 404. |
| U44 | The page shows the current spread (`—` before data) and a spread chart under the price chart, on the same range | The spread (stuck at the cap) was the tuning target for W28. |
| U45 | The page has the same Pause/Resume control as the dashboard (shared `ProducerToggle`) | Pause to inspect a moment without leaving the page. |
| U46 | The charts have a Live window (the last 100 events, x = event #) and 60 s / 5 min windows of one point per second (x = clock time), ending at the newest point | The Live window covers only a fraction of a second on a busy ticker; time windows show the trend. |
| U47 | A Live / 60 s / 5 min toggle (default Live) switches both charts | Switch between event detail and the trend. |
| U48 | "Show charts" (settings toggle) is off by default and applies at once; a route guard sends the instrument page to the dashboard while it is off, and table symbols are plain text | The page is a debugging tool, not part of the task, so the default UI stays within the task. |
| U49 | After an error the run control offers Retry: it reloads when no run was started yet, otherwise it restarts the run with the current settings | A failed load or run otherwise left only a disabled button, and the retry was reachable only through Apply on the settings page; found in review. |

## 4. Shared contracts

| ID | Requirement | Why |
| --- | --- | --- |
| C01 | The instrument list is a JSON array of ≥ 500 entries `{ symbol, name }` with unique tickers | Real S&P 500 tickers instead of made-up symbols; the list must cover the largest run (50) without duplicate rows. |
| C02 | Every entry has a ticker-shaped symbol (`AAPL`, `BRK.B`) and a company name | The UI labels rows from it, so malformed entries would break the table. |
| C03 | The list is real S&P 500 data (names from Wikipedia's "Security" column) | Guards against a placeholder list. |
| C04 | `toProducerConfig` slices the list to `instrumentCount` and carries batch size and interval unchanged | The UI picks the instruments, the worker never does: one source of truth. |
| C05 | The config's `symbols` is a fresh array (safe to post to the worker) | The cached list must not be changed by whoever receives the config. |
| C06 | Shared contracts (`protocol.ts`, `wasm-api.ts`, `wasm_exec.d.ts`) compile and are the only cross-module types | The modules were built in parallel against frozen contracts. |
| C07 | Only `src/environments/environment.ts` reads `import.meta` | One place for build-time config (base URL for GitHub Pages, Wasm URL, refresh rate). |
| C08 | Settings defaults and limits match task §2 (5 / 100 / 500; 1–50, 1–1000, 50–2000) | The form and the Go validation use the same limits as task §2. |
