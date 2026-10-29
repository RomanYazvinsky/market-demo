# Simplified Market Model Implementation Plan

**Status: rejected, not implemented.** Superseded by `07-multi-level-fills.md`. The author did not accept its compromises: levels never refill between price moves, makers are removed, and the never-empty rule exists only to avoid ±1 imbalance, which TASK.md allows (book quantities may be 0). Kept for history.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the maker/taker order-book model with a semi-random taker-only model in which a quoted level is never empty.

**Architecture:** Each instrument keeps its one-level book `{bid, ask, bidQty, askQty}`. Every update is one taker trade. The trade never takes the whole level, and it moves the price with probability `filled / shares before`. When the price moves, the hit side goes one gap away with fresh depth and the other side follows at a random spread. Only `wasm/generator` and the docs change; the wire format, the bridge, the worker and the UI stay as they are.

**Tech Stack:** Go 1.27.1 (`math/rand/v2` PCG), `go test`.

**Spec:** `docs/superpowers/specs/2026-10-28-realtime-dashboard-design.md` (Revisions → *Market model, simplified*, added in Task 3). Background and measurements: `docs/superpowers/specs/2026-10-28-exhausted-level.md`.

## Global Constraints

- No file under `src/` changes. Check: `git diff --stat <BASE>..HEAD -- src` prints nothing.
- `wasm/main.go` and `wasm/generator/encode.go` / `types.go` do not change. The wire format stays 7 int32 per update (W14).
- TASK.md §3 still holds:
  - prices positive, bid < ask;
  - trade price is that update's bid or ask;
  - trade quantity > 0, book quantities ≥ 0;
  - prices evolve from previous values.
- `NextBatch` allocates nothing (W15). Same seed gives the same stream (W12).
- All model numbers stay in `ModelConfig` / `DefaultModelConfig()`. The config is Go-side only.
- Test names start with the requirement IDs they cover.

## Review Focus

1. **A fresh level of 1 share.** With a $5,000 share price and a $5,000 depth budget, `sharesFor` gives 1, and the next trade would fill 0 (breaks W09). A fresh level must hold at least 2 shares. Pinned by `TestW28_FreshLevelHasAtLeastTwoShares`.
2. **Bid at the 1¢ floor hit by a seller.** `bid = max(1, bid − gap)` can leave the bid in place; the ask must still end above it. Pinned by `TestW06_MoveKeepsBidPositive`.
3. **The other side after a buy-side move.** `bid = ask − spread` must stay ≥ 1¢. That holds because spread ≤ 20 bps of ask < ask. Covered by the sample invariants W06/W07.
4. **Spread drawn from the wrong price.** Drawing it from the bid on a sell-side move is fine, since `spreadCap(bid) ≤ spreadCap(ask)`. Drawing it from the old ask is not. Covered by `TestW07_BidBelowAsk`, which also checks the cap.
5. **Exactly ±1.00 imbalance.** It must never be emitted. Pinned by `TestW27_QuotedLevelsNeverEmpty`.

## The model

Per update, draws in this fixed order:
1. instrument
2. side (Bid = a seller hits the bid, Ask = a buyer lifts the ask)
3. taker budget
4. roll in `[0, before)`
5. only if the price moves: depth budget, then spread

```
before := level shares
filled := min(sharesFor(budget, price), before − 1)    // never the whole level; before ≥ 2 always
level  -= filled
emit {price, filled, bid, ask, bidQty, askQty}         // after the fill, before any move
if remaining == 1 || roll < filled:                    // a bigger bite moves the price more often
    hit side moves one gap away, fresh depth: max(2, sharesFor(depth, newPrice))
    other side = hit price ∓ spread, spread uniform in [1¢, spreadCap(hit price)], keeps its shares
```

A move happens *after* the emit. So the emitted price is always the emitted bid or ask (W08), and the instrument's next update shows the new book.

`ModelConfig` keeps:
- `MinStartPriceCents`, `MaxStartPriceCents`
- `MinOrderCents`, `MaxOrderCents`
- `MinDepthCents`, `MaxDepthCents`
- `LevelGapBps`
- `MaxSpreadBps`

`InitialSpreadBps` and `ImproveChancePct` are removed. The initial book is `bid = uniform(start range)`, `ask = bid + spread(bid)`, with fresh depth on each side.

## Requirements → tests (changes to the 02-wasm table)

| ID | Requirement | Change | Go test |
|---|---|---|---|
| W06 | Prices are positive | test rewritten for `move` | `TestW06_PricesPositive` (kept), `TestW06_MoveKeepsBidPositive` (replaces `TestW06_RefreshKeepsBidPositive`) |
| W07 | Bid < ask; spread within 1¢…`spreadCap(ask)` | maker and clamp tests removed | `TestW07_BidBelowAsk` (now also checks the cap), `TestW07_FollowPlacesSpread` |
| W08 | Trade price is that update's bid or ask | unit test renamed function | `TestW08_TradeAtBidOrAsk` (kept), `TestW08_SellTradesAtBid` |
| W09 | Trade quantity > 0 | kept | `TestW09_TradeQuantityPositive`, `TestW09_SmallBudgetTradesOneShare` |
| W23 | A taker fills `min(budget/price, level − 1)`; the level loses exactly the filled shares | **changed** (was `min(budget/price, level)`) | `TestW23_TakerFillsWithinLevel`, `TestW23_TakerFillLeavesOneShare` |
| W24 | The price moves only after a trade, with probability `filled / shares before`, and always when 1 share is left; the hit side moves away | **changed** (was "moves only after exhaustion") | `TestW24_ShouldMove`, `TestW24_BookMovesAwayFromTrade` |
| W25 | Model numbers come from `ModelConfig`; invalid configs are rejected | fewer fields | `TestW25_DefaultConfigValid`, `TestW25_InvalidConfigRejected` |
| W26 | ~~A maker joining the best price adds shares~~ | **retired** (no makers) | — |
| W27 | Quoted levels are never empty (bid and ask quantity ≥ 1), so imbalance is strictly between −1 and +1 | **new** | `TestW27_QuotedLevelsNeverEmpty` |
| W28 | A move puts the hit side one gap away with at least 2 shares of fresh depth; the other side follows at a spread in [1¢, cap] and keeps its shares | **new** | `TestW28_MoveAsk`, `TestW28_MoveBid`, `TestW28_FreshLevelHasAtLeastTwoShares` |

W01–W05, W10–W22 are unchanged, and so is the JS `wasm.integration.spec.ts`.

---

### Task 1: Book primitives for the semi-random model

**Files:**
- Modify: `wasm/generator/book.go` (add new functions; the old ones stay until Task 2)
- Test: `wasm/generator/book_test.go`

**Interfaces:**
- Produces (used by Task 2):
  - `func freshShares(depthCents, priceCents int64) int64`: returns `max(2, sharesFor(depthCents, priceCents))`.
  - `func (b *book) trade(s Side, budgetCents int64) (priceCents, filled, before int64)`: fills `min(sharesFor(budget, price), before−1)` on side `s` (Ask = buyer) and subtracts it.
  - `func shouldMove(roll, filled, remaining int64) bool`: `remaining == 1 || roll < filled`.
  - `func (b *book) move(c ModelConfig, s Side, depthCents int64) (hitPriceCents int64)`:
    - Ask: `ask += gap(ask)`, `askQty = freshShares(depth, ask)`.
    - Bid: `bid = max(1, bid − gap(bid))`, `bidQty = freshShares(depth, bid)`.
  - `func (b *book) follow(s Side, spreadCents int64)`: after an Ask move `bid = ask − spread`; after a Bid move `ask = bid + spread`. Quantities are unchanged.

- [ ] **Step 1: Write the failing tests** in `book_test.go`, using the existing `alfa()` (`bid 10196, ask 10200, bidQty 600, askQty 50`):

```go
func TestW23_TakerFillsWithinLevel(t *testing.T) // b.trade(Ask, 100_000) → price 10200, filled 9, before 50, askQty 41; bid side unchanged
func TestW23_TakerFillLeavesOneShare(t *testing.T) // askQty 5; trade(Ask, 100_000) → filled 4, askQty 1
func TestW08_SellTradesAtBid(t *testing.T)     // trade(Bid, 100_000) → price 10196, filled 9, bidQty 591
func TestW09_SmallBudgetTradesOneShare(t *testing.T) // trade(Ask, 1_000) → filled 1
func TestW24_ShouldMove(t *testing.T) // table: (roll 0, filled 9, rem 41) → true; (roll 8, 9, 41) → true;
                                      // (roll 9, 9, 41) → false; (roll 49, 1, 1) → true (1 share left)
func TestW28_MoveAsk(t *testing.T)  // move(cfg, Ask, 1_000_000) returns 10205; ask 10205, askQty 97;
                                    // follow(Ask, 3) → bid 10202, bidQty 600 (unchanged)
func TestW28_MoveBid(t *testing.T)  // move(cfg, Bid, 1_000_000) returns 10191; bid 10191, bidQty 98;
                                    // follow(Bid, 4) → ask 10195, askQty 50
func TestW28_FreshLevelHasAtLeastTwoShares(t *testing.T) // freshShares(100, 10200) == 2; freshShares(1_000_000, 10205) == 97
func TestW06_MoveKeepsBidPositive(t *testing.T) // book{bid 1, ask 2, 10, 10}: move(cfg, Bid, 1_000), follow(Bid, 1) → bid 1, ask 2
func TestW07_FollowPlacesSpread(t *testing.T)   // alfa: follow(Ask, 20) → bid 10180; alfa: follow(Bid, 1) → ask 10197
```

The existing `TestW23_*`, `TestW08_SellTradesAtBid` and `TestW09_SmallBudgetTradesOneShare` call `takerTrade`. Rewrite them in place to call `trade` with the values above. The `TestW23_TakerFillCappedByLevel` case (fill 5, level 0) is replaced by `TestW23_TakerFillLeavesOneShare`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd wasm && go test ./generator/ -run 'W23|W08_Sell|W09_Small|W24_ShouldMove|W28|W06_Move|W07_Follow'`
Expected: FAIL to build: `b.trade undefined`, `shouldMove undefined`, `b.move undefined`, `b.follow undefined`, `freshShares undefined`.

- [ ] **Step 3: Implement the five functions in `book.go`** with the signatures from *Interfaces*. Doc comments should match the style of the existing `takerTrade` / `refresh` comments.

- [ ] **Step 4: Run them to verify they pass**

Run: `cd wasm && go test ./generator/`
Expected: `ok`. The old tests (`TestW24_Refresh…`, `TestW26…`, `TestW07_Maker…`, `TestW07_Clamp…`) still pass, because the old functions are still there.

- [ ] **Step 5: Commit**

```bash
git add wasm/generator/book.go wasm/generator/book_test.go
git commit -m "feat(wasm): semi-random book primitives (W23 W24 W28)"
```

### Task 2: Switch the generator and remove the maker model

**Files:**
- Modify: `wasm/generator/generator.go` (`New`, `NextBatch`, add `spread`, change `uniformDepth` use)
- Modify: `wasm/generator/book.go` (delete `refresh`, `clampSpread`, `makerAdd`, `takerTrade`, `spreadCap` if unused)
- Modify: `wasm/generator/config.go` (remove `InitialSpreadBps`, `ImproveChancePct` and their validation)
- Test: `wasm/generator/generator_test.go`, `wasm/generator/book_test.go`

**Interfaces:**
- Consumes: Task 1's `trade`, `shouldMove`, `move`, `follow`, `freshShares`.
- Produces: `func (g *Generator) spread(priceCents int64) int64`, which draws uniformly from `[1, c.spreadCap(priceCents)]`. Keep `spreadCap` (the W07 test uses it).

- [ ] **Step 1: Write the failing tests** in `generator_test.go`:

```go
func TestW27_QuotedLevelsNeverEmpty(t *testing.T) // eachSampled: u.BidQuantity >= 1 && u.AskQuantity >= 1
func TestW24_BookMovesAwayFromTrade(t *testing.T) // per instrument, prev → next update:
    // if bid or ask changed, then prev.PriceCents == prev.AskCents ⇒ next.AskCents > prev.AskCents,
    // and prev.PriceCents == prev.BidCents ⇒ next.BidCents < prev.BidCents  (the hit side moved away)
```

In the same step:
- Extend `TestW07_BidBelowAsk` to also require `ask − bid <= cfg.spreadCap(ask)`.
- Delete `TestW24_QuotesMoveAwayOnlyAfterExhaustion`, which reads exhaustion from an emitted 0 and is superseded by W27 + `TestW24_BookMovesAwayFromTrade`.
- In `book_test.go`, delete:
  - `TestW26_MakerJoinAddsShares`
  - `TestW07_MakerImproveNarrowsSpread`
  - `TestW07_MakerImproveNeverCrosses`
  - `TestW24_RefreshMovesOnlyExhaustedLevel`
  - `TestW24_RefreshNoopWhenLevelsHaveShares`
  - `TestW06_RefreshKeepsBidPositive`
  - `TestW07_ClampSpreadPullsOtherSideIn`
- In `TestW25_InvalidConfigRejected`, delete the cases `max spread below initial`, `improve chance above 100` and `improve chance negative`.

- [ ] **Step 2: Run them to verify W27 fails**

Run: `cd wasm && go test ./generator/ -run 'W27|W24_BookMoves'`
Expected: `TestW27_QuotedLevelsNeverEmpty` FAILS on an update with quantity 0, because the old model is still in `NextBatch`. `TestW24_BookMovesAwayFromTrade` may pass or fail; W27 is the gate.

- [ ] **Step 3: Rewrite `NextBatch` and `New`** per *The model*. Use the draw order exactly as listed, and update the doc comment on `NextBatch` to match. Replace the comment above `dst[k]` with one line: the book is emitted after the fill and before a move, so the price is that update's bid or ask. `New` draws, per instrument: start bid, spread, bid depth, ask depth. Then delete the dead functions in `book.go` and the two config fields with their `Validate` checks. Also update the `ModelConfig` doc comment if it mentions makers.

- [ ] **Step 4: Run all Go tests and the JS contract test**

Run: `pnpm test:go && pnpm test --run src/app/producer/wasm.integration.spec.ts`
Expected: Go `ok`, including W12 determinism, W11 bounds and W15 with 0 allocations. Vitest: 11/11 pass.

- [ ] **Step 5: Measure, for the docs**

Use a throwaway `zz_measure_test.go` (delete it after the run; do not commit it) over 50 instruments, seed 42, 200 × 1000 updates. Print:
- the share of updates with a 0-share level;
- `|imbalance| > 0.95`;
- the share of spreads at the cap, and the mean spread in bps;
- the mean (max − min) / min mid range per instrument.

Expected, roughly as in the prototype: 0%, about 1.6%, about 2.7%, about 10 bps, about 2.4%. Record the numbers for Task 3.

- [ ] **Step 6: Commit**

```bash
git add wasm/generator
git commit -m "feat(wasm): semi-random taker model, quoted levels never empty (W24 W27 W28)"
```

### Task 3: Document the decision

**Files:**
- Modify:
  - `docs/superpowers/specs/2026-10-28-realtime-dashboard-design.md`: a new Revisions bullet, *Market model, simplified*. It supersedes the *Order-driven market model* bullet; mark that bullet "superseded" instead of deleting it.
  - `docs/superpowers/specs/2026-10-28-exhausted-level.md`: set Status to "resolved"; the Decision names the adopted model and the Task 2 numbers.
  - `docs/superpowers/plans/2026-10-28-realtime-dashboard/02-wasm.md`: apply the table changes above (W07, W23, W24, W26 retired, W27, W28 added; update test names). Add a line pointing to this plan.
  - `docs/superpowers/plans/2026-10-28-realtime-dashboard/00-overview.md`: add `06-simplified-model.md` to the parts table.
  - `README.md` → *Where things happen → Market model*: the four steps become the model above, with the config list.
  - `progress.md`:
    - *Decisions → Market model*: semi-random taker-only, no empty quoted level, and why (link the exhausted-level doc).
    - Add a checklist line `- [x] 06 Simplified market model`.

- [ ] **Step 1: Edit the files above.** Keep the wording consistent with this plan's *The model* section.
- [ ] **Step 2: Verify nothing outside `wasm/` and docs changed, and everything is green**

Run: `git diff --stat <BASE>..HEAD -- src` (prints nothing), then `pnpm test:go && pnpm test --run && pnpm typecheck && pnpm build`
Expected: no `src` changes. Go `ok`, Vitest all pass (115/115), typecheck clean, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add README.md progress.md docs
git commit -m "docs: simplified market model decision"
```
