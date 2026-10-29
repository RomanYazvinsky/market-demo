# Realtime Fintech Dashboard Implementation Plan — Overview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Modules 02–04 run in parallel (superpowers:dispatching-parallel-agents, one git worktree each via superpowers:using-git-worktrees). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AnalogJS app with a live market dashboard and producer settings, fed by a Go Wasm generator running in a Web Worker.

**Architecture:** Go Wasm fills a reusable per-run `Int32Array` with market updates; the worker folds each batch into BigInt per-instrument totals and posts a metrics snapshot once per second, stamped with `runId`. A root Angular service owns the single worker, drops stale-run messages, and exposes signals to two Material pages.

**Tech Stack:** Go 1.27.1 (`GOOS=js GOARCH=wasm`), AnalogJS 2.9 / Angular 22 (zoneless, standalone, signals, signal forms, SSR prerender + hydration), Angular Material 22, SCSS, RxJS 7, Vitest 5 (jsdom) with `@analogjs/vitest-angular` + Angular Testing Library + Vitest fixtures, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-28-realtime-dashboard-design.md` (requirements: `TASK.md`)

## Execution order

```
01 contracts (sequential, on feat/realtime-dashboard)
        │
        ├── 02 wasm    (worktree, branch feat/wasm)    ─┐
        ├── 03 worker  (worktree, branch feat/worker)  ─┼─ parallel
        └── 04 ui      (worktree, branch feat/ui)      ─┘
        │
05 integration (merge, end-to-end check, docs, deploy)
```

| Part | File | Owns (only these paths may change) | Ends with |
|---|---|---|---|
| 01 Contracts | `01-contracts.md` | tooling files, `src/app/producer/{protocol,symbols,wasm-api}.ts`, `wasm_exec.d.ts`, stub `producer.worker.ts` | Shared boundary types complete; all three modules can compile and test in isolation. |
| 02 Wasm | `02-wasm.md` | `wasm/**`, `src/app/producer/wasm.integration.spec.ts` | Go generator + JS bridge green; compiled module passes the JS-side contract test. |
| 03 Worker | `03-worker.md` | `src/app/producer/{metrics,producer-controller,wasm-loader,producer.worker}.ts` + specs, `src/app/producer/testing/**` | Worker logic green against a fake `WasmProducer`. |
| 04 UI | `04-ui.md` | `src/app/producer/{worker-channel,producer.service}.ts` + specs, `src/app/{app.ts,app.config.ts,app.scss}`, `src/app/shared/**`, `src/app/settings/**`, `src/app/pages/**`, `src/styles.scss`, `src/testing/**` | Service, form, pages green against a fake `Worker` / stub service. |
| 05 Integration | `05-integration.md` | anything; `README.md`, `progress.md`, `.github/**` | Merged, works in browser, documented, auto-deployed. |
| 06 Simplified model (rejected) | `06-simplified-model.md` | — | Never-empty model; rejected in favour of 07, not implemented. |
| 07 Multi-level fills (chosen, not started) | `07-multi-level-fills.md` | `wasm/generator/**`, docs | Budget continuations across levels and batches (lazy), post-fill snapshots; retains maker/taker. |
| 08 Instrument page (done) | `08-instrument-page.md` | `src/app/producer/{protocol,event-log,producer-controller,producer.service}.ts`, `src/app/instrument/**`, `src/app/pages/instrument/**`, `src/app/dashboard/market-table.*`, `vite.config.ts`, `package.json`, docs | `/instrument/:symbol` with a Chart.js price graph and the last 100 events. |

### Rules

- **TDD inside each module:** write the module's tests first and commit them red (`test(<module>): … (red)`), then implement until green (`feat(<module>): …`). Never change an assertion to make it pass; a wrong test gets its own `test: fix …` commit with a reason.
- **Contracts are frozen** during 02–04. A module that needs a contract change stops, reports it, and the change is made on `feat/realtime-dashboard` in `01` files, then merged into every module branch.
- **Ownership:** a module touches only its paths above, so merges are conflict-free. `package.json`, `vite.config.ts` and `progress.md` belong to 01 / 05 only.
- Each module worktree runs `pnpm install` once (pnpm store makes it fast).
- Commit at every step marked **Commit**.
- **Traceability:** each module file opens with a *Requirements → tests* table. Every requirement has an ID (`W..` wasm, `K..` worker, `U..` UI, `C..` shared contracts) and a source (TASK.md section, spec decision or contract). Every test name starts with the ID(s) it proves. A requirement without a test states why (enforced by types, or a named review check). Reviewers reject a module whose table and test names disagree.

## Global Constraints

- Settings, all integers: instrument count default 5, range 1–50; updates per batch default 100, range 1–1000; batch interval default 500 ms, range 50–2000.
- UI refresh interval is `environment.uiRefreshMs = 1000`, pre-configured, not a setting.
- Instruments are real S&P 500 tickers from the static resource `public/resources/sp500.json`. The UI fetches it (`environment.symbolsUrl`), slices the list to `instrumentCount` and sends it to the worker as `ProducerConfig.symbols` on every apply, including the first one. The worker never chooses symbols.
- Only `src/environments/environment.ts` reads `import.meta`. Everything else imports `environment`.
- Tailwind 4 is kept for layout utilities in templates, in its own `src/tailwind.css`. SCSS handles theming and component styles. No `@apply`.
- Prices are integer cents end to end; round only for display. Currency USD, `en-US`.
- Volume and `sum(price × qty)` are `bigint` in the worker. No event history retained.
- Generated invariants: price > 0, bid ≥ 1, bid < ask, trade price ∈ {bid, ask}, tradeQuantity ≥ 1, bid/ask quantities ≥ 0.
- Market model: order-driven, one-level book per instrument; every tunable number in Go `ModelConfig` (`DefaultModelConfig()`), nothing hard-coded elsewhere.
- Wire layout per update, 7 little-endian int32 (28 bytes): `[instrumentIndex, priceCents, tradeQuantity, bidCents, askCents, bidQuantity, askQuantity]`.
- Batch buffers are allocated once per run and reused (Go `[]MarketUpdate` + `[]byte`, JS `Int32Array`).
- Randomness and price logic run in Go only. `syscall/js` only in `wasm/main.go`.
- Zero denominators → `null` → rendered as `—`. Before data: price/spread/VWAP/imbalance `—`, volume `0`.
- Modern Angular: standalone, `inject()`, signals, signal forms (`@angular/forms/signals`), `@if`/`@for`. Pages default-export. Specs colocated as `*.spec.ts`.
- Pages are prerendered (`/`, `/settings`) and hydrated. Static content (toolbar, links, headings, labels) is always in the HTML; producer-driven parts render a skeleton until the producer has started in the browser.
- The worker never blocks bootstrap: `App` calls async `ProducerService.start()` in `afterNextRender`; the worker chunk is loaded by dynamic `import('./producer.worker?worker')`.
- Main thread talks to the worker only through the RxJS wrapper `rxWorker()`.
- Display formatting via Angular pipes (`currency`, `number`) plus own `cents` and `bigint` pipes (`DecimalPipe` has no bigint support).
- Styles are SCSS (global `styles.scss` with Material theme, component `.scss`).
- Tests: Angular Testing Library queries by role/label, setup through Vitest fixtures (`test.extend`), no ad-hoc render helpers or `data-testid` in app templates.
- Tests never wait on real time: Vitest fake timers, fixed Go seeds.
- Project docs: `README.md`, `progress.md`. `docs/superpowers/` is a working folder, not release docs.
- Integration branch `feat/realtime-dashboard` (no remote yet).

## Review Focus

Spec-implied failure modes most likely to bite a user, each pinned by a test:

1. **Apply while paused** starts a new running run with cleared totals — 03 `producer-controller.spec.ts` › `apply after pause starts running`.
2. **Two Applies in quick succession** — only the latest `runId` changes UI state — 04 `producer.service.spec.ts` › `drops messages from older runs`; 03 › `an older apply still awaiting wasm does not start after a newer one`.
3. **Wasm fails to load** (404, bad binary, Go init error) — status `error` with readable text — 03 › `reports wasm load failure`, `reports go init error`; 02 integration › `rejects out-of-range settings with a message`.
4. **Long runs past 2^53 notional** — VWAP stays exact — 03 `metrics.spec.ts` › `vwap exact beyond Number.MAX_SAFE_INTEGER`, `stays exact over a long run`.
5. **Non-integer or empty form input** — form invalid, Apply disabled — 04 `settings-form.spec.ts` › `rejects non-integers and empty`; `settings.page.spec.ts` › `apply disabled while invalid`.

(Also pinned: worker chunk fails to load → error status, 04 › `reports a loader failure as an error status`; Apply clicked before the worker is ready → only latest settings sent, 04 › `apply before the worker is ready…`.)

## Open questions

None at the moment.

## File map

```
wasm/                                  [02]
  main.go                              JS bridge: global `producer` {init, nextBatch}
  generator/types.go                   author's types, moved from wasm/types.go
  generator/generator.go, encode.go (+ _test.go)
scripts/build-wasm.sh                  [01]
public/resources/sp500.json            [01] S&P 500 tickers, fetched at runtime
src/test-setup.ts, tsconfig.spec.json  [01]
src/environments/environment.ts       [01] only reader of import.meta
src/tailwind.css                       [01] Tailwind entry (layout)
src/styles.scss                        [01 rename → 04 theme]
src/testing/producer-fixtures.ts       [04] ProducerService stub, FakeWorker, pageTest fixtures
src/app/producer/
  protocol.ts                          [01] settings, limits, messages, MetricsRow, emptyRow
  symbols.ts (+spec)                   [01] toProducerConfig (spec also validates the resource)
  wasm-api.ts                          [01] WasmProducer interface
  wasm_exec.d.ts                       [01] typings for copied wasm_exec.js
  wasm.integration.spec.ts             [02] runs compiled producer.wasm in node
  metrics.ts (+spec)                   [03] metric functions, MetricsStore
  producer-controller.ts (+spec)       [03] worker-side run lifecycle
  testing/fake-wasm.ts                 [03] WasmProducer test double
  wasm-loader.ts                       [03] loadWasmProducer
  producer.worker.ts                   [01 stub → 03]
  worker-channel.ts (+spec)            [04] rxWorker: Worker → Observable
  producer.service.ts (+spec)          [04] Angular owner of the worker
src/app/shared/format.ts, cents.pipe.ts, bigint.pipe.ts (+specs) [04]
src/app/settings/settings-form.ts (+spec)      [04] signal form schema
src/app/pages/index.page.ts (+spec, .scss)     [04] dashboard at /
src/app/pages/settings.page.ts (+spec, .scss)  [04]
src/app/app.ts (+spec), app.scss, app.config.ts [04]
.github/workflows/deploy.yml           [05]
```
