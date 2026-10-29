# Chart windows — Design

Working document. Extends `2026-10-29-instrument-page.md`.

## Intent

The instrument page's charts show only the last 100 updates, so a busy ticker's chart covers a fraction of a second and a quiet one covers minutes. The chart should also be readable as a timeline: what the price did over the last minute or five.

## Decided by the author

- **Three windows** on the instrument page: **Live** (the last 100 updates, as today), **60 s** and **5 min**.
- **Time windows sample at 1 point per second.** A point exists only for a second in which the ticker had at least one update. With one batch every 2 s there is one point per 2 s and nothing in between. More updates in one second are clamped to one point.
- So the 60 s window shows at most 60 points and the 5 min window at most 300.
- **The event log stays** the last 100 updates, newest first, whatever the window.

## Design

- **Worker — `PriceHistory`.** Per instrument, a ring of 300 one-second slots in typed arrays: second (`floor(batchTimeMs / 1000)`), trade price, bid, ask. An update whose second equals the instrument's newest slot overwrites that slot (the point is the **last update of the second**, *builder's call*); otherwise it takes the next slot. Nothing is allocated per update, memory is bounded (instruments × 300 slots), and it is reset on Apply like `EventLog`. Kept for every instrument, so a page opened mid-run shows the last 5 minutes at once.
- **Protocol.** `WatchedEvents` gains `seconds: PricePoint[]` (`{ timeMs, priceCents, bidCents, askCents }`, oldest first, up to 300). The worker always sends the 5 min history; the UI cuts the 60 s window from it. At most 300 small objects per snapshot, once per second.
- **Window end** is the newest point's time, not the clock (*builder's call*): a paused or quiet ticker keeps its last minute on screen instead of scrolling empty.
- **Page.** A `mat-button-toggle-group` (Live / 60 s / 5 min) above the charts, default Live, held in page state (not persisted). Both charts follow the selection.
- **Charts.**
  - Live keeps x = event number.
  - Time windows use x = time in ms on a linear axis with clock labels (`HH:mm:ss`, `Intl.DateTimeFormat`), so no Chart.js date adapter is needed. The x range is the full window (end − 60 s or 5 min .. end), so gaps show as gaps in time.
  - Trade points, stepped bid/ask and the spread chart work the same way in every window.

## Non-goals

- Windows longer than 5 min, an "all" window, zoom/pan, candles or min/max per second.
- Persisting the selected window.
