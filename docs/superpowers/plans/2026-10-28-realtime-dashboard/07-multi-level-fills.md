# Multi-level Taker Fills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This document is a plan, not authorization to implement it.

**Status:** Chosen direction; implementation not started. `06-simplified-model.md` is rejected (its compromises: levels never refill, the order remainder is forced through). Start from the current maker/taker generator. Imbalance ±1 is accepted by design: TASK.md allows book quantities of 0.

**Goal:** Continue a budget-based taker order across exhausted price levels, emitting one post-fill `MarketUpdate` per execution and preserving overflow across batch boundaries.

**Architecture:** Keep the one-level book, maker orders, seeded randomness and existing refresh/spread-cap rules. An exhausted level is published with quantity 0, then replaced with synthetic liquidity when the same taker can afford another execution. The generator owns only the active order (instrument, side, remaining budget; a zero budget means no order). The next execution of a sweep is computed lazily, when the next output slot needs it. Neither the bridge nor the worker changes.

**Tech Stack:** Go 1.27.1 (`math/rand/v2` PCG), Go tests, existing pnpm/Vitest contract checks.

**Spec:** `TASK.md` §§1, 3–4; `docs/superpowers/specs/2026-10-28-realtime-dashboard-design.md`; the agreed behavior and explicit implementation choices in **Model and decisions** below. Background: `docs/superpowers/specs/2026-10-28-exhausted-level.md`. This plan supersedes the never-empty model in `06`, which was rejected and never implemented.

## Clarified quote behavior after a sweep

No previous-event history or previous-level depth slots are required. When a buyer exhausts ask and continues at the next ask, the bid stays at its existing price/quantity unless the existing spread-cap safeguard applies. On a later **new incoming order**, a maker may improve bid and replace its quantity with the new maker's shares. If that improved bid is later exhausted, generate replacement depth; restoring the displaced bid's original quantity is not required. The sell-side case is symmetric.

User's illustrative sequence: bid 102.00 × 500, ask 102.20 is exhausted; the next ask is higher while bid remains 102.00 × 500, widening the spread. Later a new bid at 102.10 × 300 replaces the old best bid. If those 300 shares are sold, the model need not restore the historical 500 shares at 102.00. These prices illustrate the behavior, not a requested change to the existing maker improvement of 1 cent or configured `LevelGapBps`.

Maker improvements remain separate from the fills of one taker sweep: no maker runs between its consecutive executions, even when they cross batch boundaries. “Later generation” here means the start of a new incoming order. Retain the existing probabilistic maker-side/improvement selection; do not force bid replenishment after every buy or ask replenishment after every sell. This avoids introducing extra policy not specified by the user.

## Global Constraints

- Every update represents exactly one positive-quantity execution and the book **after that execution**. Do not emit quote-only or pre-trade updates.
- Trade price equals that update's bid or ask; prices positive, bid < ask, quantities nonnegative. Zero remaining depth and imbalance ±1 are valid.
- Keep maker/taker behavior, `ModelConfig` fields/defaults and the one-level-per-side representation. Generate the next level on demand; do not build a multi-level book or remember replaced levels.
- Preserve exact requested batch length, including batch size 1. Updates per batch count executions, not incoming orders.
- No dropped or duplicate executions. No extra array slots, variable-length batches, event-history storage or per-batch allocations.
- `wasm/main.go`, `wasm/generator/types.go`, `encode.go` and all `src/` files stay unchanged. Wire format remains 7 int32 per update; the public generator API stays unchanged.
- Same seed/config gives the same stream. Splitting that stream into different batch sizes must not change its emitted contents.
- Pause preserves generator state; a new successful init creates a new generator with no active order. No pause-time flush or special bridge lifecycle code.
- Only generator Go files/tests and project docs change. Leave unrelated work, including the existing untracked `report.md`, untouched.
- Requirement IDs W27/W28 in unimplemented `06` are not adopted. Use W29–W33 for this extension.

## Review Focus

1. **Insufficient remainder:** never apply `sharesFor`'s one-share minimum to continuation money. No over-budget execution or zero-quantity update. Task 1: `TestW29_RemainderMustAffordNextPrice`.
2. **Last batch slot and batch size 1:** return the zero-depth execution and keep the order; the next call executes the continuation exactly once before any new order. Task 2: `TestW30_ContinuesAcrossBatchBoundary`.
3. **An order crosses more than two levels:** keep remaining money and side across calls, and resume without creating another maker order. Task 2: `TestW31_SweepAcrossSeveralBatches`.
4. **Both sides, low prices and exhausted opposite side:** retain current refresh/clamp rules and avoid zero-volume loops or crossed quotes. Tasks 1–2: `TestW29_SellRemainder`, `TestW31_BidFloorAndEmptyOppositeSide`.
5. **Reinitialization with an active order:** a fresh generator must produce the same stream as another fresh generator with its seed, without inheriting the previous generator's active order. Task 2: `TestW33_NewGeneratorHasNoActiveOrder`.

## Model and decisions

### What changes and what stays

Today `takerTrade` fills one level and cancels the remainder. Instead, a single incoming order may produce several consecutive executions at different prices. All executions of that order stay consecutive, even across batch boundaries. Do not choose another instrument/side/budget, run another maker, or replenish an unexhausted hit level between them.

Before a **new incoming order**, retain today's sequence: choose instrument, refresh an empty level and clamp if needed, run one maker action, choose taker side and budget. Maker improvement still replaces the previous best; this change does not fix that simplification or guarantee a stable spread/price distribution.

After each fill, copy the complete post-fill snapshot by value before refreshing anything. If the hit level is exhausted and the remainder can afford the next level, generate/refresh that level, apply the existing spread cap and execute the next fill. The previously copied update must keep its old quote and zero quantity.

If an order ends without exhausting its level, end it; any unaffordable fractional-share remainder is cancelled. If it ends on an exhausted level without enough money for the next level, also end it, leaving the emitted zero visible until later activity. Do not fabricate a second trade merely to hide ±1.

### Money policy — explicit compatibility choice

Existing `sharesFor` returns at least 1, even when the incoming budget cannot afford one share. Preserve that behavior **only at the start of a new order**: define `effectiveBudget = max(drawnBudget, firstExecutionPrice)` once, after the maker action. This is a documented one-share minimum, not strict adherence to a sub-share drawn budget. Keep `TestW09_SmallBudgetTradesOneShare`.

For each execution subtract exactly `filled * price` from this effective budget. Every continuation uses integer division `remainingBudget / nextPrice` without a minimum of 1. No additional budget floor, fresh draw, or rounding up during continuation. A sell order uses the same monetary-target semantics as today's bid-side taker; it is not a share-count order.

Preview the next hit price before replacing its empty level: Ask `ask + gap(ask)`; Bid `max(1, bid - gap(bid))`. If the remainder cannot afford one share there, stop without refreshing or drawing new depth. Otherwise use the existing `refresh` and `clampSpread`; the clamp does not change the refreshed hit price. At the 1¢ bid floor the replacement may have the same price; it is still a new liquidity level.

### Example: one buyer, two executions

Initial book: bid 9999 × 600, ask 10000 × 9; budget 200000 cents. Use `LevelGapBps = 5`, fresh next ask depth 100 shares, and `MaxSpreadBps = 200` so no clamp affects this example.

| Execution | Price cents | Filled shares | Bid cents | Bid qty | Ask cents | Ask qty after fill | Money left |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 10000 | 9 | 9999 | 600 | 10000 | 0 | 110000 |
| 2 | 10005 | 10 | 9999 | 600 | 10005 | 90 | 9950 |

The second execution cannot spend the last 9950 cents at 10005, so the order ends. A batch of length 1 returns execution 1 and keeps the order. Its next call executes and returns execution 2 before starting new orders. A larger order may exhaust execution 2's level as well; retain the remaining budget for later levels.

### Lazy continuation

Add one value field to `Generator` (no queue, no flag):

```go
type takerOrder struct {
    instrument     int
    side           Side
    remainingCents int64 // 0 = no active order
}
// Generator addition:
// order takerOrder   // zero value = no order, so New needs no setup
```

`order` describes the unexecuted remainder only. Nothing is executed ahead of output: the book always matches the last emitted update.

`NextBatch` fills each slot as follows:
1. If `order.remainingCents > 0`, try to continue it: execute at the hit level or, if that level is empty, preview the next price and refresh/execute when affordable.
2. If there was no active order or it could not continue (set `remainingCents = 0`), start a new order and execute its first fill.
3. After the fill, clear the order (`remainingCents = 0`) unless the hit level is exhausted and money remains.

A slot does at most one failed continuation plus one new order, so there is no unbounded loop. Random draws happen in the same order for any batch partition, because a continuation's depth draw is always the next draw after the previous fill. Resetting a run (new generator) discards the order.

### Expected effect and limits

Zero-depth updates still exist, and ±1 can appear in the UI, especially at a boundary or when an order has no affordable remainder. Consecutive fills can shorten that interval; they do not mathematically reduce the count of exhausted-level updates. A following level can also be fully consumed.

The worker already consumes every execution for volume/VWAP and retains the latest quote per instrument. It needs no special zero filter or aggregation change. This plan makes no promise to eliminate visible ±1, stop price drift, or make all volume changes explainable from consecutive emitted quantities: maker activity and spread clamps remain part of the model.

## Requirements → tests (extension of 02-wasm)

| ID | Requirement | Tests |
|---|---|---|
| W23 | A single execution consumes at most the level; emitted quantities are post-fill | Existing W23 tests; `TestW29_PostFillSnapshotSurvivesRefresh` |
| W24 | An exhausted hit level can be refreshed for the same order, not only a new order | Keep existing refresh and `TestW24_QuotesMoveAwayOnlyAfterExhaustion` tests |
| W29 | Continuations preserve instrument/side, spend remaining money at the next price and never force an unaffordable share | `TestW29_BuyRemainder`, `TestW29_SellRemainder`, `TestW29_RemainderMustAffordNextPrice`, `TestW29_InitialBudgetFloorAppliedOnce`, `TestW29_PostFillSnapshotSurvivesRefresh` |
| W30 | Exactly N outputs per call; a sweep continues across calls without loss/duplication | `TestW30_ContinuesAcrossBatchBoundary`, `TestW30_LastSlotKeepsOrder`, `TestW30_SnapshotStoredByValue` |
| W31 | Sweeps may span many levels/calls; maker and new-order draws occur once per incoming order | `TestW31_SweepAcrossSeveralBatches`, `TestW31_ContinuationDoesNotAddMaker`, `TestW31_BidFloorAndEmptyOppositeSide` |
| W32 | Seeded stream independent of batch partition; accounting invariant across batch boundaries | `TestW32_StreamIndependentOfBatchSize`, `TestW32_DeliveredAccounting` |
| W33 | Order state belongs to one generator/run | `TestW33_NewGeneratorHasNoActiveOrder` |

W01–W22 and W25–W26 remain applicable. W09's initial one-share minimum remains, with the money policy above. Do not reuse the never-empty requirement from `06`.

---

### Task 1: Budget-aware continuation primitives

**Files:**
- Modify: `wasm/generator/book.go` — affordable execution and next-price preview.
- Create: `wasm/generator/order.go` — active-order value type and execution helpers.
- Test: `wasm/generator/book_test.go`, `wasm/generator/order_test.go`.

**Interfaces:**
- Keep `sharesFor`, `takerTrade`, `refresh`, `clampSpread`, `makerAdd` callable so current tests/generator remain green during this task.
- Add `func (b *book) nextLevelPrice(c ModelConfig, s Side) int64` — preview the replacement hit price without mutation or randomness.
- Add `func (b *book) fillAffordable(s Side, budgetCents int64) (priceCents, filled int64)` — `min(budget/price, levelQty)`; no one-share floor; subtract only filled shares.
- Add `takerOrder` as specified above and `func (o *takerOrder) execute(b *book) (MarketUpdate, bool)` — execute at the current level, deduct actual cost, return a copied post-fill update with its instrument. False means no affordable execution and no state mutation. Level refresh is owned by Task 2.

- [ ] **Step 1: Write failing tests.** Use the example's book and money values; both sides must preserve the untouched side. Assert first execution 9 @ 10000, 110000 left, snapshot askQty 0. Refresh with depth 1000500 cents, execute again: 10 @ 10005, askQty 90, 9950 left. Verify the first snapshot is unchanged. For bid: start bid 10000 × 9 / ask 10001 × 600, budget 200000; after 9 @ 10000 refresh to 9995 × 100, then fill 11, leaving 55 cents and bidQty 89. Assert budgets 0 and price−1 return no execution/no mutation; exactly price buys one share. Cover previews at bid 1/ask 2 and an unchanged book after preview.
- [ ] **Step 2: Run** `cd wasm && go test ./generator/ -run 'W29|W06_Refresh|W24_Refresh'`. Expected: new tests fail because helpers/types do not exist.
- [ ] **Step 3: Implement** the interfaces above. Reuse post-fill field conversion/saturation conventions from `NextBatch`; keep budget/cost arithmetic int64. Do not change configuration or activate the new path yet.
- [ ] **Step 4: Run** `pnpm test:go`. Expected: all existing and new helper tests pass.
- [ ] **Step 5: Commit** only the Task 1 files: `git add wasm/generator/book.go wasm/generator/book_test.go wasm/generator/order.go wasm/generator/order_test.go` then `git commit -m "feat(wasm): budget-aware taker continuation primitives"`.

### Task 2: Consecutive fills across batches (lazy continuation)

**Files:**
- Modify: `wasm/generator/generator.go` — order state, new-order setup and emission orchestration.
- Modify: `wasm/generator/order.go` — generator continuation helper.
- Test: `wasm/generator/generator_test.go`, `wasm/generator/order_test.go`.

**Interfaces:**
- Consume Task 1 primitives.
- Add `func (g *Generator) startOrder()` — today's instrument/refresh/maker/side/budget sequence, normalizing the initial effective budget once. Called only when no order is active (`remainingCents == 0`).
- Add `func (g *Generator) continueOrder() (MarketUpdate, bool)` — if the hit side has shares, execute there; if empty, preview affordability, refresh/clamp and execute. If unaffordable set `remainingCents = 0`, return false, and leave the book unchanged. After a fill set `remainingCents = 0` when the hit level remains nonempty; otherwise keep the order for the next slot's affordability check.
- Keep `NextBatch(dst []MarketUpdate)` public signature. Implement the lazy loop from **Model and decisions → Lazy continuation**.

- [ ] **Step 1: Write failing generator tests.** Seed active orders directly in package tests to isolate sweeps from random maker behavior. Use the example book with a fixed depth budget 1000500, gap 5 and spread cap 200. A batch of 1 returns execution 1 and keeps the order; the next call executes and returns execution 2 once. Compare with a two-slot batch from an identical fixture. Assert emitted snapshots remain unchanged by later book mutation (value copy). After the second fill the active order is cleared. A new order whose drawn budget is below its hit price executes one share only, never repeatedly floors its remainder (`TestW29_InitialBudgetFloorAppliedOnce`).
- [ ] **Step 2: Add long-sweep and accounting tests.** With bid 9999 × 600 / ask 10000 × 1, fixed new depth 10005 cents and budget 40030, collect four one-slot batches. Expect ask-side executions 1 @ 10000, 1 @ 10005, 1 @ 10010, 1 @ 10015; all exhausted snapshots, exact spend 40030, no active order afterwards. Check the untouched bid quantity is unchanged (no maker between fills). Repeat an affordable bid-floor continuation with an empty ask: bid stays ≥1, bid < ask, quantities nonnegative, progress consumes money. Exact exhaustion and next-price−1 remainder must not generate a second event or replace the level.
- [ ] **Step 3: Add quote-transition regression tests.** `TestW31_SweepKeepsOppositeQuoteUntilCap`: with the Task 2 fixture below the spread cap, verify the ask sweep preserves bid price **and** quantity. Keep the existing clamp test for the explicit cap exception. `TestW26_ImprovementReplacesPreviousDepth`: starting at bid 10200 × 500 / ask 10220, call `makerAdd(Bid, 3060300, true)`; expect bid 10201 × 300, not 800. Exhaust those 300 shares with an affordable sell; refresh using a depth budget of 1020000 and verify the new bid depth is `sharesFor(1020000, newBid)`, not the historical 500. Mirror for Ask improvement/exhaustion. This pins the existing one-level replacement behavior without adding any previous-level storage.
- [ ] **Step 4: Run** `cd wasm && go test ./generator/ -run 'W26|W29|W30|W31'`. Expected: tests fail against missing orchestration/state.
- [ ] **Step 5: Implement** the lazy continuation loop. Retain existing setup draw order for new orders; continuation draws a depth budget only after affordability succeeds, with no instrument/maker/side/order-budget draws. Document this draw order. Keep the old `takerTrade` helper/tests if still useful; do not alter assertions merely to preserve old random outputs.
- [ ] **Step 6: Add W32/W33 regression tests.** Compare 2000 emitted updates from identically seeded generators using partitions `[1000,1000]`, 2000 calls of size 1, and mixed sizes summing to 2000. Compare fields exactly. Repeat with a forced long-sweep fixture so the test certainly continues sweeps across batch boundaries. Sum emitted quantities and price×quantity using int64 for these bounded fixtures and compare partition results and the four-fill totals (volume 4, notional 40030). Create a fresh generator while another has an active order and compare its output to another fresh generator with the same seed. Extend W15 with a forced-continuation fixture (one-share fresh depth, affordable large orders, batch size 1), requiring zero allocations as well as the existing default-path test.
- [ ] **Step 7: Run** `pnpm test:go` then `pnpm test --run src/app/producer/wasm.integration.spec.ts`. Expected: all pass, including W11 step-size bounds, W24 movement after exhaustion, W08 price match, W09 positive quantities and W15 zero allocations. Do not freeze a historical test count.
- [ ] **Step 8: Commit** the Task 2 files only: `git add wasm/generator/generator.go wasm/generator/generator_test.go wasm/generator/order.go wasm/generator/order_test.go` then `git commit -m "feat(wasm): sweep taker budgets across levels and batches"`.

### Task 3: Measure and document the actual behavior

**Files:**
- Modify: `README.md` market model; `progress.md` decisions/completion; design spec's market-model revision.
- Modify: `docs/superpowers/plans/2026-10-28-realtime-dashboard/02-wasm.md` requirements W23/W24 and W29–W33, money-policy explanation and link here.
- Modify: `docs/superpowers/specs/2026-10-28-exhausted-level.md` — retain historical measurements, document continuation decision/results and remaining zero-depth cases.
- Modify: `00-overview.md` if needed to reflect completion, not to mark it complete prematurely.

**Interfaces:** No runtime interface changes. Explain one incoming order versus several emitted executions, before/after timing, order lifecycle across batches, initial-budget compatibility floor and the current synthetic replacement-level limitation.

- [ ] **Step 1: Measure with a temporary Go test.** Same baseline/new comparison: seed 42, 50 instruments, 200000 emitted updates; same config. Record fraction of zero-depth events, |imbalance| >0.95, consecutive same-instrument fills, spread-at-cap rate and mean per-instrument mid-price range. Also compare the last-per-instrument state after simulated batches of 1 and 100; these are boundary snapshots, not a claim about actual timed UI exposure. Fixed seed/fixture inputs; no timing waits. Delete the temporary measurement file afterwards. Report measured values, not desired targets; neither zero-depth count nor UI boundary rate is guaranteed to improve.
- [ ] **Step 2: Update** the listed docs consistently. Set the exhausted-level issue to partially addressed/accepted residual behavior, not “no empty quotes” or unconditionally resolved. Mark this plan complete only when its checks actually pass.
- [ ] **Step 3: Verify scope and full checks.** Record `BASE` as the commit before implementation and use `git diff --stat "$BASE" -- src wasm/main.go wasm/generator/types.go wasm/generator/encode.go wasm/generator/config.go` (must print nothing; includes uncommitted tracked edits). Run `pnpm test:go`, `pnpm test --run`, `pnpm typecheck`, `pnpm build`. Expected: successful commands, no contract changes or new runtime dependencies.
- [ ] **Step 4: Commit** only the documentation paths listed above with `git commit -m "docs: document multi-level fills and cross-batch sweeps"`. Do not stage unrelated files with `git add -A`.
