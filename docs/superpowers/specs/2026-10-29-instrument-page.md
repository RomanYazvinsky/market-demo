# Instrument page — Design

Working document. Plan: `plans/2026-10-28-realtime-dashboard/08-instrument-page.md`.

## Intent

A page per ticker with a price graph and a log of that ticker's latest market updates, so the generator's behaviour (sweeps, quote moves, bid/ask bounce) can be seen event by event.

## Decided by the author

- **Route:** `/instrument/:symbol` (Analog `pages/instrument/[symbol].page.ts`). The symbol cell of the dashboard table links to it. The pages of the first 50 S&P symbols (the largest possible run) are prerendered, so deep links work on static hosting.
- **History:** the last **100 events** per instrument, kept in the worker in fixed-size ring buffers. TASK.md §3 forbids retaining the complete event history; 100 per instrument is bounded.
- **Graph:** the same 100 events: trade price per event, with bid and ask as stepped lines. x is the event's run-wide sequence number.
- **Chart library:** Chart.js 4, tree-shaken (line chart only) and loaded lazily, in the browser only.
- **Process:** this spec, then plan 08, then TDD.

## Design

- **An event** is one `MarketUpdate` plus a run-wide sequence number and the time of its batch (`Date.now()` when the batch was generated). Side is derived: a trade at the ask is a buy, at the bid a sell.
- **Worker:** `EventLog` stores, per instrument, the last 100 events in typed arrays (no allocation per update, so the 20k updates/s ceiling still holds). It is reset on Apply, like the totals.
- **Watching:** the UI tells the worker which symbol a page shows (`{ type: 'watch', symbol }`, `null` when the page closes). Each snapshot then carries that symbol's events (`watched`), so only one ticker's log crosses the worker boundary per second. Watching is UI state, not run state: it has no `runId` and survives Apply. A watch while running or paused posts a snapshot at once, so the page fills immediately, also when paused.
- **UI:** `ProducerService.watch(symbol)` and a `watched` signal. Snapshots whose `watched.symbol` is not the current one are ignored (a snapshot posted before the worker saw the new watch). Apply clears the events.
- **Page:** heading with the symbol, back link to the dashboard, skeleton until the producer has started, a "not in the current run" message (with a link to Settings) when the symbol is outside the run's instruments, otherwise the chart and the log (newest first).

## Non-goals

- Longer history than 100 events, time-based sampling, zoom/pan, candles.
- Watching several tickers at once.
