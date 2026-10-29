# Instrument Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/instrument/:symbol` page with a Chart.js price graph and a log of the ticker's last 100 market updates.

**Architecture:** The worker keeps the last 100 events per instrument in typed-array ring buffers and adds the watched symbol's events to each snapshot. `ProducerService.watch(symbol)` selects the symbol; the page renders a chart component and an event table component from the `watched` signal.

**Tech Stack:** AnalogJS 2.9 / Angular 22, Angular Material table, Chart.js 4.6.1, Vitest 5 + Angular Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-29-instrument-page.md`

## Global Constraints

- Test names start with requirement IDs; new IDs are K25–K29 (worker) and U31–U37 (UI), added to the tables in `03-worker.md` / `04-ui.md`.
- Descriptive names only: no single letters or abbreviations for variables, parameters or loop indexes.
- Templates in `.html` files (`templateUrl`). Pages have no stylesheet and use only Tailwind; components own SCSS for themed visuals; no `@apply`.
- `EVENT_LOG_SIZE = 100`. Chart.js `4.6.1`, exact version in `package.json`.
- Chart.js is never imported statically: only through the lazily imported `chart-js.ts`, only in the browser.
- No allocation per update in the worker (W15/K23 spirit): `EventLog.add` writes into preallocated typed arrays.

## Review Focus

1. **Router reuses the page component** when going from `/instrument/AAPL` to `/instrument/MSFT`: the watch must follow the param, not only `ngOnInit`. Test `U35 follows the symbol when the route param changes` (Task 5).
2. **Apply with fewer instruments** while watching a symbol that drops out: the page shows "not in the current run", the worker sends `events: []`. Tests `K28 watched symbol outside the run has no events` (Task 2), `U35 shows a message for a symbol outside the run` (Task 5).
3. **Paused run:** opening the page must show existing events immediately. Test `K29 watch while paused posts a snapshot at once` (Task 2).
4. **High rate (1000 updates / 50 ms):** `EventLog.add` must not allocate per update and must keep only 100 per instrument. Test `K25 keeps only the last 100 events, oldest first` (Task 1) plus the review check in Task 1.
5. **Prerender/SSR:** the instrument page renders on the server without Chart.js or a worker. Test `U34 does not create a chart on the server` (Task 4); build check in Task 6.

---

### Task 1: Protocol types and `EventLog`

**Files:**
- Modify: `src/app/producer/protocol.ts`
- Create: `src/app/producer/event-log.ts`, `src/app/producer/event-log.spec.ts`

**Interfaces:**
- Produces (protocol.ts):
  ```ts
  export const EVENT_LOG_SIZE = 100;
  export interface TickerEvent {
    sequence: number; timeMs: number; priceCents: number; quantity: number;
    bidCents: number; askCents: number; bidQty: number; askQty: number;
  }
  export interface WatchedEvents { symbol: string; events: TickerEvent[] } // oldest first
  export function tradeSide(event: TickerEvent): 'buy' | 'sell' // buy when priceCents === askCents
  ToWorker  += | { type: 'watch'; symbol: string | null }
  FromWorker snapshot += watched: WatchedEvents | null
  ```
- Produces (event-log.ts): `class EventLog { constructor(instrumentCount: number, capacity = EVENT_LOG_SIZE); add(batch: Int32Array, updateCount: number, timeMs: number): void; events(instrument: number): TickerEvent[] }`. Sequence numbers start at 1 per log and count every update of every instrument.

- [ ] **Step 1: Write the failing tests** in `event-log.spec.ts`, building batches with the `FIELD` offsets:
  - `K25 keeps only the last 100 events, oldest first`: 250 updates for instrument 0 → `events(0)` has length 100, sequences 151…250.
  - `K26 events carry a run-wide sequence and the batch time`: batch of [instrument 1, instrument 0, instrument 1] at `timeMs` 5000 → `events(1).map(sequence)` = [1, 3], all `timeMs` 5000, fields copied (price, quantity, bid, ask, bidQty, askQty).
  - `K26 instruments are isolated`: `events(2)` of a 3-instrument log fed only instrument 0 is `[]`.
  - `K25 tradeSide is buy at the ask and sell at the bid`.
- [ ] **Step 2: Run** `pnpm vitest run src/app/producer/event-log.spec.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `EventLog` with one `Int32Array(instrumentCount × capacity × 6)` for the six update fields, one `Float64Array(instrumentCount × capacity × 2)` for sequence and time, and per-instrument `next`/`count` arrays. `events()` is the only place that allocates.
- [ ] **Step 4: Run** the spec. Expected: PASS. Review check: `add` has no `new`, `[]`, `{}` or `push`.
- [ ] **Step 5: Commit** `feat(worker): per-instrument event log of the last 100 updates`.

### Task 2: Controller watches a symbol

**Files:**
- Modify: `src/app/producer/producer-controller.ts`, `producer-controller.spec.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `handle({ type: 'watch', symbol })`; every snapshot has `watched`.

- [ ] **Step 1: Write the failing tests:**
  - `K28 snapshots carry no events while nothing is watched`: after apply + 1000 ms, `snapshots[0].watched` is `null`.
  - `K28 snapshots carry the watched symbol's events`: watch `'MSFT'`, apply, advance 1000 ms → `watched.symbol` `'MSFT'`, every event belongs to instrument 1 of the FakeWasm stream, `events.length ≤ 100`, sequences increasing.
  - `K28 watched symbol outside the run has no events`: watch `'TSLA'` → `watched` `{ symbol: 'TSLA', events: [] }`.
  - `K29 watch while paused posts a snapshot at once` and `K29 watch while idle posts nothing`.
  - `K27 apply clears the event log; watching survives apply`: watch, apply 1, run, apply 2 → first snapshot of run 2 has only events with run 2 sequences (starting at 1).
- [ ] **Step 2: Run** `pnpm vitest run src/app/producer/producer-controller.spec.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement:** a `watchedSymbol: string | null` field; `log = new EventLog(...)` created in `apply` next to the store; `scheduleBatch` calls `log.add(ints, updatesPerBatch, Date.now())`; `emit` adds `watched` (index via `config.symbols.indexOf`); `watch` sets the field and emits if the state is `running` or `paused`.
- [ ] **Step 4: Run** all specs (`pnpm vitest run`). Expected: PASS.
- [ ] **Step 5: Commit** `feat(worker): snapshots carry the watched symbol's events`.

### Task 3: `ProducerService.watch`

**Files:**
- Modify: `src/app/producer/producer.service.ts`, `producer.service.spec.ts`, `src/testing/producer-fixtures.ts` (stub gets `watched` signal and `watch` spy)

**Interfaces:**
- Produces: `watch(symbol: string | null): void`; `readonly watched: Signal<WatchedEvents | null>`.

- [ ] **Step 1: Write the failing tests:**
  - `U31 watch sends the symbol to the worker`; `U31 a watch before the worker is up is sent before the first apply` (`workers[0].sent[0]` is the watch).
  - `U31 watch sets an empty log for the new symbol at once` (`watched()` → `{ symbol, events: [] }`; `watch(null)` → `null`).
  - `U32 ignores events of a symbol that is no longer watched`; `U32 apply clears the events and keeps the symbol`.
- [ ] **Step 2: Run** the spec. Expected: FAIL.
- [ ] **Step 3: Implement** as in the spec; snapshot handling sets `watched` only when `message.watched?.symbol === this.watchedSymbol`.
- [ ] **Step 4: Run** all specs. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): ProducerService watches one symbol`.

### Task 4: Chart and event table components

**Files:**
- Create: `src/app/instrument/price-chart.{ts,html,scss}`, `src/app/instrument/chart-js.ts`, `src/app/instrument/event-table.{ts,html,scss}`, `src/app/instrument/instrument.spec.ts`
- Modify: `package.json` (`chart.js` `4.6.1`), `vite.config.ts` (`optimizeDeps.include` `chart.js`)

**Interfaces:**
- Produces:
  ```ts
  export interface PriceSeries { sequences: number[]; prices: number[]; bids: number[]; asks: number[] } // dollars
  export function toPriceSeries(events: TickerEvent[]): PriceSeries
  export interface PriceChartHandle { update(series: PriceSeries): void; destroy(): void }
  export const PRICE_CHART_FACTORY: InjectionToken<(canvas: HTMLCanvasElement) => Promise<PriceChartHandle>>
  // default: () => import('./chart-js').then((module) => module.createPriceChart(canvas))
  <app-price-chart [events]="…" />      // canvas, aria-label "Price chart"
  <app-event-table [events]="…" />      // mat-table aria-label "Events", newest first
  ```

- [ ] **Step 1: Write the failing tests:**
  - `U34 maps events to price, bid and ask series in dollars` (`toPriceSeries`).
  - `U34 creates the chart after render and updates it with new events` (fake factory records `update` calls).
  - `U34 destroys the chart with the component`; `U34 does not create a chart on the server` (`PLATFORM_ID` `'server'`).
  - `U33 lists events newest first with formatted columns`: headers `['#', 'Time', 'Side', 'Price', 'Qty', 'Bid', 'Ask']`, a buy row `['2', '12:00:05.000', 'Buy', '$102.00', '30', '$101.96 × 600', '$102.00 × 400']` (time zone fixed to UTC in the test via the `DatePipe` timezone input or `DATE_PIPE_DEFAULT_OPTIONS`).
- [ ] **Step 2: Run** `pnpm vitest run src/app/instrument`. Expected: FAIL.
- [ ] **Step 3: Implement.** `chart-js.ts` registers only `LineController, LineElement, PointElement, LinearScale, Tooltip, Legend`; datasets Trade (points), Bid and Ask (`stepped: true`, thin); `animation: false`; colors from `getComputedStyle(canvas)` Material tokens (`--mat-sys-primary`, `--mat-sys-tertiary`, `--mat-sys-error`). The component creates the chart in `afterNextRender`, pushes `toPriceSeries(events())` in an `effect`, destroys in `DestroyRef.onDestroy`.
- [ ] **Step 4: Run** all specs. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): price chart (Chart.js) and event table components`.

### Task 5: Instrument page, table link, prerender

**Files:**
- Create: `src/app/pages/instrument/[symbol].page.{ts,html}`, `src/app/pages/instrument/instrument.page.spec.ts`
- Modify: `src/app/dashboard/market-table.{ts,html,scss}`, `src/app/pages/index.page.spec.ts`, `vite.config.ts` (prerender routes)

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces: route `/instrument/:symbol`; `routeMeta` title `Instrument`.

- [ ] **Step 1: Write the failing tests:**
  - `U35 watches the symbol while open and stops on leave` (`watch` called with `'AAPL'`, then `null` on destroy).
  - `U35 follows the symbol when the route param changes` (param `AAPL` → `MSFT`: heading and `watch('MSFT')`).
  - `U35 shows a message for a symbol outside the run` (rows without the symbol: text `not in the current run`, link to `/settings`).
  - `U35 shows a skeleton until the producer has started, heading always`.
  - `U35 shows chart and events of the watched symbol`.
  - `U36 the symbol cell links to its instrument page` (dashboard spec: link `ALFA` has `href` `/instrument/ALFA`).
- [ ] **Step 2: Run** the specs. Expected: FAIL.
- [ ] **Step 3: Implement.** Symbol from `ActivatedRoute.paramMap` via `toSignal`; an `effect` calls `producer.watch(symbol())`; `DestroyRef.onDestroy` calls `watch(null)`. Prerender routes: `'/', '/settings'` plus `/instrument/<symbol>` for the first `SETTINGS_LIMITS.instrumentCount.max` entries of `public/resources/sp500.json` (read with `fs` in `vite.config.ts`).
- [ ] **Step 4: Run** all specs and both typechecks. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): instrument page with price chart and event log`.

### Task 6: Verify and document

- [ ] **Step 1:** `pnpm build`. Expected: success; `dist/analog/public/instrument/AAPL/index.html` exists; Chart.js is in its own chunk (not in the main entry).
- [ ] **Step 2:** Browser, dev and production preview: open a ticker from the table, watch the chart and log move, pause (data stays), switch ticker, Apply with 1 instrument while on another ticker. No console errors. Stop servers and blank the page afterwards.
- [ ] **Step 3:** Requirement rows K25–K29 in `03-worker.md`, U31–U37 in `04-ui.md` (U37: prerendered instrument pages, *build check*); README (routes, architecture), `progress.md`, `00-overview.md` (row 08).
- [ ] **Step 4: Commit** `docs: instrument page`.
