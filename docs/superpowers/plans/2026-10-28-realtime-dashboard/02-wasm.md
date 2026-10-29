# Module 02 — Wasm (Go generator + JS bridge)

Read `00-overview.md` and `01-contracts.md` (Task 1.2 is this module's external contract). Branch `feat/wasm`. Owns `wasm/**` and `src/app/producer/wasm.integration.spec.ts` only.

**Interfaces produced** (package `findev-test/wasm/generator`, internal to this module):

```go
const (
	MaxInstruments  = 50
	MaxBatch        = 1000
	FieldsPerUpdate = 7
	BytesPerUpdate  = FieldsPerUpdate * 4
)

// ModelConfig holds every tunable number of the market model. All money is in cents,
// all relative sizes in basis points (1 bp = 0.01%). Defaults live in DefaultModelConfig;
// changing a number means editing that function (author decision: Go-side config only).
type ModelConfig struct {
	MinStartPriceCents, MaxStartPriceCents int64 // initial mid per instrument            (1_000 / 50_000     = $10–$500)
	MinOrderCents, MaxOrderCents           int64 // budget of one maker or taker order    (10_000 / 500_000   = $100–$5,000)
	MinDepthCents, MaxDepthCents           int64 // money resting on a freshly made level (500_000 / 5_000_000 = $5k–$50k)
	LevelGapBps                            int64 // distance of a new level from an exhausted one (5; min 1¢)
	InitialSpreadBps                       int64 // starting spread                         (5; min 1¢)
	MaxSpreadBps                           int64 // spread cap                              (20; min 1¢)
	SweepChancePct                         int64 // chance a taker order is larger than the best level, so it empties it (10)
	MinRestoreTicks, MaxRestoreTicks       int64 // updates until the other side follows a moved level (1 / 20)
}

func DefaultModelConfig() ModelConfig
func (c ModelConfig) Validate() error // min <= max, all > 0 (SweepChancePct 0–100), MinStartPriceCents >= 2

type Generator struct{ /* config, per-instrument one-level books, seeded PRNG */ }

func New(seed uint64, instrumentCount int, cfg ModelConfig) (*Generator, error) // error unless 1 <= count <= MaxInstruments and cfg.Validate() == nil
func ValidateBatchSize(n int) error                                              // error unless 1 <= n <= MaxBatch
func (g *Generator) InstrumentCount() int
func (g *Generator) NextBatch(dst []MarketUpdate)                                // fills every element in place; no allocation
func Encode(dst []byte, ups []MarketUpdate)                                      // len(ups)*BytesPerUpdate bytes, LE, wire order
```

**Internal model API** (unexported, unit-tested in-package so each step is checked with fixed numbers, no randomness):

```go
type Side int8 // Bid or Ask: a side of the book. A buyer takes from Ask, a seller from Bid.
const (
	Bid Side = iota
	Ask
)

// book is one instrument's one-level order book: best price and the shares resting there.
type book struct {
	bid, ask       int64 // cents
	bidQty, askQty int64 // shares
}

func (c ModelConfig) bps(price, bps int64) int64      // max(1, price*bps/10_000)
func (c ModelConfig) gap(price int64) int64           // bps(price, LevelGapBps)
func (c ModelConfig) spreadCap(ask int64) int64       // bps(ask, MaxSpreadBps)
func sharesFor(moneyCents, priceCents int64) int64    // max(1, money/price)

func (b *book) refresh(c ModelConfig, depthCents int64) (moved Side, ok bool) // replace an exhausted level
func (b *book) clampSpread(c ModelConfig, moved Side)                        // pull the other side in if spread > cap
func (b *book) makerAdd(s Side, budgetCents int64)                           // add liquidity at the best level
func (b *book) levelCents(s Side) int64                                      // money resting at the best level
func (b *book) noteMove(s Side, previousSpread, ticks int64)                 // start (or extend) the wait after a move
func (b *book) tickRestore(depthCents int64) bool                            // count down; place the following level
func (b *book) takerTrade(s Side, budgetCents int64) (priceCents, filled int64) // take liquidity = the trade
```

External: `globalThis.producer` implementing `WasmProducer` from `src/app/producer/wasm-api.ts`.


## Requirements → tests

Every requirement has an ID, and every test name starts with the ID or IDs it proves: `TestW07_…` in Go, `'W07 …'` in Vitest. Running `grep -rn "W07" wasm src/app/producer/wasm.integration.spec.ts` lists the evidence. A requirement with no test needs a stated reason in the last column.

Source column: **T** = TASK.md §3, **S** = design spec / author decision, **C** = `wasm-api.ts` contract (01).

| ID | Requirement | Src | Go test (`wasm/generator`) | JS contract test (`wasm.integration.spec.ts`) |
|---|---|---|---|---|
| W01 | Per-instrument state is retained between calls | T | `TestW01_StateRetainedBetweenCalls` | `W01 keeps state between calls` |
| W02 | A batch has exactly the requested number of updates | T | `TestW02_BatchHasRequestedSize` | `W02 W05–W10 fills a batch of the requested size with valid updates`, `W02 W19 writes exactly updatesPerBatch updates` |
| W03 | Updates per batch outside 1–1000 is rejected with a readable error | T, C | `TestW03_BatchSizeRange` | `W03 W04 rejects out-of-range settings with a message` |
| W04 | Instrument count outside 1–50 is rejected with a readable error | T, C | `TestW04_InstrumentCountRange` | `W03 W04 rejects out-of-range settings with a message` |
| W05 | Instrument index is in [0, count); every instrument occurs; an instrument may repeat within a batch | T | `TestW05_InstrumentIndexInRange`, `TestW05_EveryInstrumentAppears`, `TestW05_InstrumentsMayRepeatInBatch` | `W02 W05–W10 …` |
| W06 | Prices are positive (an exhausted bid never drops below 1¢) | T | `TestW06_PricesPositive`, `TestW06_RefreshKeepsBidPositive` | `W02 W05–W10 …` |
| W07 | Bid is below ask; spread stays within 1¢…`spreadCap(ask)` | T | `TestW07_BidBelowAsk`, `TestW07_ClampSpreadPullsOtherSideIn` | `W02 W05–W10 …` |
| W08 | Trade price is that update's bid or ask (buy at ask, sell at bid) | T | `TestW08_TradeAtBidOrAsk`, `TestW08_SellTradesAtBid` | `W02 W05–W10 …` |
| W09 | Trade quantities are positive (a budget below the price still buys 1 share) | T | `TestW09_TradeQuantityPositive`, `TestW09_SmallBudgetTradesOneShare` | `W02 W05–W10 …` |
| W10 | Book quantities are non-negative | T | `TestW10_BookQuantitiesNonNegative` | `W02 W05–W10 …` |
| W11 | Prices evolve from previous values: a quote moves at most one level gap + spread cap + 1¢ per update, and prices do move | T | `TestW11_PricesEvolveFromPreviousValues` | — (statistical; Go test is authoritative) |
| W12 | Generation is seeded: same seed gives the same sequence (enables fixed-input tests) | T §4, S | `TestW12_DeterministicForSeed` | `W12 same seed restarts the same sequence` |
| W13 | Prices are integer cents | T | — | — *Enforced by types:* author's int32 types and the int32 wire format (W14). |
| W14 | Wire layout is 7 little-endian int32 in the documented order | C | `TestW14_EncodeLayout` | covered by every JS test reading fields through `F` |
| W15 | No allocation per batch (buffers are reused) | S | `TestW15_NextBatchDoesNotAllocate`, `TestW15_EncodeDoesNotAllocate` | — (Go-side property) |
| W16 | `globalThis.producer` exposes `init` and `nextBatch` | C | — | `W16 registers the producer API` |
| W17 | `init` rejects a `dst` that is not an Int32Array or is shorter than updatesPerBatch × 7 | C | — | `W17 rejects an output buffer that is too small or not an Int32Array` |
| W18 | A rejected `init` keeps the previous run and its buffer | C | — | `W18 a rejected init keeps the previous run and its buffer` |
| W19 | `nextBatch` writes only inside the bound view (respects byteOffset, no overrun) | C | — | `W02 W19 writes exactly updatesPerBatch updates`, `W19 respects the byteOffset of a subarray view` |
| W20 | Invalid argument types never crash the Go runtime; `init` takes `(config: { seed, instrumentCount, updatesPerBatch }, dst)` and names a missing or non-number field | C | — | `W20 survives invalid argument types`, `W20 rejects a config with a missing field` |
| W21 | `nextBatch` before any successful `init` is a no-op | C | — | `W21 nextBatch before init is a no-op` |
| W23 | A taker fills `min(budget/price, shares at the level)`; the level loses exactly the filled shares | S | `TestW23_TakerFillsWithinLevel`, `TestW23_TakerFillCappedByLevel` | — |
| W24 | A level moves away only after it was exhausted (ask up only if askQty hit 0, bid down only if bidQty hit 0) | S | `TestW24_RefreshMovesOnlyExhaustedLevel`, `TestW24_RefreshNoopWhenLevelsHaveShares`, `TestW24_QuotesMoveAwayOnlyAfterExhaustion` | — |
| W25 | Model numbers come from `ModelConfig`; invalid configs are rejected | S | `TestW25_DefaultConfigValid`, `TestW25_InvalidConfigRejected` | — (bridge always uses the defaults) |
| W26 | A maker joining the best price adds `budget/price` shares to it | S | `TestW26_MakerJoinAddsShares` | — |
| W34 | With `SweepChancePct` a taker's budget is the level's value plus a normal order, so it empties the level (the rest is cancelled); this is what moves prices. Replaced the maker's 1¢ improve (`ImproveChancePct`), whose thin levels moved quotes on 42% of updates | S | `TestW34_SweepBudgetEmptiesLevel`, `TestW34_EverySweepEmptiesTheTradedLevel`, `TestW34_SweepRateFollowsConfig` | — |
| W35 | After a level moves away, the spread stays wide for N updates of that instrument (N uniform in `MinRestoreTicks`–`MaxRestoreTicks`, 1–20); then the side opposite the last move gets a new level (fresh depth) that returns the spread to its value before the first move. Moves during the wait keep that spread; the cap still applies | S | `TestW35_OppositeSideFollowsAfterTheWait`, `TestW35_BidMoveIsFollowedByTheAsk`, `TestW35_LaterMovesKeepTheFirstSpreadAndWait`, `TestW35_LastMovedSideDecidesWhoFollows`, `TestW35_NoRestoreWhenTheSpreadIsAlreadyNarrow`, `TestW35_SpreadReturnsAfterTheWait` | — |
| W22 | Randomness and price logic run in Wasm, not TypeScript | T | — | — *Review check:* `grep -rnE "Math\.random\|crypto\.getRandomValues" src/app` may show only the seed in `producer.worker.ts`. |

The Go invariant tests (W05–W10) run over one shared sample: seed 42, 5 instruments, 200 batches of 1000. It's computed once with `sync.OnceValue` so each requirement has its own focused test without regenerating the data.

---

### Task 2.1: Package skeleton

**Files:**
- Move: `wasm/types.go` → `wasm/generator/types.go` (`git mv`; change only `package main` → `package generator`; the author's types stay as they are)
- Create: `wasm/generator/config.go` (`ModelConfig`, `DefaultModelConfig` with the documented defaults, `Validate` stub returning `errors.New("not implemented")`), `wasm/generator/book.go` (`Side`, `book`, the helpers and the four methods as stubs that return zero values), `wasm/generator/generator.go`, `wasm/generator/encode.go`. The constants are as above. Stubs: `New` returns `nil, errors.New("not implemented")`, `ValidateBatchSize` returns `errors.New("not implemented")`, `InstrumentCount` returns 0, `NextBatch`/`Encode` empty.
- Modify: `wasm/main.go` — remove `goAdd` and `func ApplySettings()`; register `producer` with `init(seed, count, batch, dst)` returning `"not implemented"` and `nextBatch()` returning `nil`; keep `select {}`.

- [ ] **Step 1:** Make the changes above.
- [ ] **Step 2: Verify** `cd wasm && go vet ./... && GOOS=js GOARCH=wasm go vet .` — no output. `pnpm build:wasm` exits 0.
- [ ] **Step 3: Commit** — `git add -A wasm && git commit -m "feat(wasm): generator package skeleton"`.

---

### Task 2.2: Generator and encoder tests (red)

**Files:** Create `wasm/generator/generator_test.go`, `wasm/generator/encode_test.go`

- [ ] **Step 1:** `generator_test.go`:

```go
package generator

// Test names carry requirement IDs (W01…); see the matrix in
// docs/superpowers/plans/2026-10-28-realtime-dashboard/02-wasm.md.

import (
	"slices"
	"sync"
	"testing"
)

func newGen(t *testing.T, seed uint64, n int) *Generator {
	t.Helper()
	g, err := New(seed, n, DefaultModelConfig())
	if err != nil {
		t.Fatalf("New(%d, %d): %v", seed, n, err)
	}
	return g
}

func batch(g *Generator, n int) []MarketUpdate {
	dst := make([]MarketUpdate, n)
	g.NextBatch(dst)
	return dst
}

const sampleInstruments = 5

// sample is 200 batches × 1000 updates from seed 42, shared by the invariant tests (W05–W10).
var sample = sync.OnceValues(func() ([]MarketUpdate, error) {
	g, err := New(42, sampleInstruments, DefaultModelConfig())
	if err != nil {
		return nil, err
	}
	out := make([]MarketUpdate, 0, 200*MaxBatch)
	dst := make([]MarketUpdate, MaxBatch)
	for range 200 {
		g.NextBatch(dst)
		out = append(out, dst...)
	}
	return out, nil
})

func eachSampled(t *testing.T, check func(u MarketUpdate) bool, what string) {
	t.Helper()
	ups, err := sample()
	if err != nil {
		t.Fatalf("sample: %v", err)
	}
	for i, u := range ups {
		if !check(u) {
			t.Fatalf("update %d violates %q: %+v", i, what, u)
		}
	}
}

func TestW01_StateRetainedBetweenCalls(t *testing.T) {
	g := newGen(t, 7, 5)
	first, second := batch(g, 500), batch(g, 500)
	fresh := batch(newGen(t, 7, 5), 500)
	if !slices.Equal(first, fresh) {
		t.Fatal("first batch should match a fresh generator with the same seed")
	}
	if slices.Equal(second, fresh) {
		t.Fatal("second batch equals a fresh first batch: state was reset between calls")
	}
}

func TestW02_BatchHasRequestedSize(t *testing.T) {
	for _, n := range []int{1, 100, MaxBatch} {
		for i, u := range batch(newGen(t, 1, 5), n) {
			if u.PriceCents <= 0 {
				t.Fatalf("n=%d: dst[%d] not filled: %+v", n, i, u)
			}
		}
	}
}

func TestW03_BatchSizeRange(t *testing.T) {
	for _, n := range []int{-1, 0, MaxBatch + 1} {
		if ValidateBatchSize(n) == nil {
			t.Errorf("ValidateBatchSize(%d) = nil, want error", n)
		}
	}
	for _, n := range []int{1, MaxBatch} {
		if err := ValidateBatchSize(n); err != nil {
			t.Errorf("ValidateBatchSize(%d) = %v", n, err)
		}
	}
}

func TestW04_InstrumentCountRange(t *testing.T) {
	for _, n := range []int{-1, 0, MaxInstruments + 1} {
		if _, err := New(1, n, DefaultModelConfig()); err == nil {
			t.Errorf("New(1, %d) err = nil, want error", n)
		}
	}
	for _, n := range []int{1, MaxInstruments} {
		if g := newGen(t, 1, n); g.InstrumentCount() != n {
			t.Errorf("InstrumentCount() = %d, want %d", g.InstrumentCount(), n)
		}
	}
}

func TestW05_InstrumentIndexInRange(t *testing.T) {
	eachSampled(t, func(u MarketUpdate) bool {
		return int(u.Instrument) >= 0 && int(u.Instrument) < sampleInstruments
	}, "0 <= instrument < count")
}

func TestW05_EveryInstrumentAppears(t *testing.T) {
	seen := map[Instrument]bool{}
	for _, u := range batch(newGen(t, 3, 5), MaxBatch) {
		seen[u.Instrument] = true
	}
	if len(seen) != 5 {
		t.Fatalf("saw %d instruments, want 5", len(seen))
	}
}

func TestW05_InstrumentsMayRepeatInBatch(t *testing.T) {
	seen := map[Instrument]int{}
	for _, u := range batch(newGen(t, 3, 5), 100) {
		seen[u.Instrument]++
	}
	for _, c := range seen {
		if c > 1 {
			return
		}
	}
	t.Fatal("no instrument repeated in a batch of 100 over 5 instruments")
}

func TestW06_PricesPositive(t *testing.T) {
	eachSampled(t, func(u MarketUpdate) bool {
		return u.PriceCents > 0 && u.BidCents > 0 && u.AskCents > 0
	}, "prices > 0")
}

func TestW07_BidBelowAsk(t *testing.T) {
	cfg := DefaultModelConfig()
	eachSampled(t, func(u MarketUpdate) bool {
		spread := int64(u.AskCents) - int64(u.BidCents)
		return spread >= 1 && spread <= cfg.spreadCap(int64(u.AskCents))
	}, "1 <= ask-bid <= spreadCap(ask)")
}

func TestW08_TradeAtBidOrAsk(t *testing.T) {
	eachSampled(t, func(u MarketUpdate) bool {
		p := int(u.PriceCents)
		return p == int(u.BidCents) || p == int(u.AskCents)
	}, "price == bid || price == ask")
}

func TestW09_TradeQuantityPositive(t *testing.T) {
	eachSampled(t, func(u MarketUpdate) bool {
		return u.TradeQuantity >= 1
	}, "tradeQuantity >= 1")
}

func TestW10_BookQuantitiesNonNegative(t *testing.T) {
	eachSampled(t, func(u MarketUpdate) bool {
		return u.BidQuantity >= 0 && u.AskQuantity >= 0
	}, "bid/ask quantity >= 0")
}

func TestW11_PricesEvolveFromPreviousValues(t *testing.T) {
	ups, err := sample()
	if err != nil {
		t.Fatalf("sample: %v", err)
	}
	cfg := DefaultModelConfig()
	last := map[Instrument]MarketUpdate{}
	changes := 0
	for _, u := range ups {
		if prev, ok := last[u.Instrument]; ok {
			d := max(int64(u.BidCents)-int64(prev.BidCents), int64(prev.BidCents)-int64(u.BidCents))
			limit := cfg.gap(int64(prev.BidCents)) + cfg.spreadCap(int64(prev.AskCents)) + 1
			if d > limit {
				t.Fatalf("bid jumped %d cents (limit %d, unrelated to previous value): %+v -> %+v", d, limit, prev, u)
			}
			if d != 0 {
				changes++
			}
		}
		last[u.Instrument] = u
	}
	if changes == 0 {
		t.Fatal("prices never moved")
	}
}

func TestW24_QuotesMoveAwayOnlyAfterExhaustion(t *testing.T) {
	ups, err := sample()
	if err != nil {
		t.Fatalf("sample: %v", err)
	}
	last := map[Instrument]MarketUpdate{}
	for _, u := range ups {
		if prev, ok := last[u.Instrument]; ok {
			if u.AskCents > prev.AskCents && prev.AskQuantity != 0 {
				t.Fatalf("ask moved up while %d shares were still offered: %+v -> %+v", prev.AskQuantity, prev, u)
			}
			if u.BidCents < prev.BidCents && prev.BidQuantity != 0 {
				t.Fatalf("bid moved down while %d shares were still bid: %+v -> %+v", prev.BidQuantity, prev, u)
			}
		}
		last[u.Instrument] = u
	}
}

func TestW12_DeterministicForSeed(t *testing.T) {
	if !slices.Equal(batch(newGen(t, 7, 5), 500), batch(newGen(t, 7, 5), 500)) {
		t.Fatal("same seed produced different batches")
	}
	if slices.Equal(batch(newGen(t, 7, 5), 500), batch(newGen(t, 8, 5), 500)) {
		t.Fatal("different seeds produced identical batches")
	}
}

func TestW15_NextBatchDoesNotAllocate(t *testing.T) {
	g := newGen(t, 1, MaxInstruments)
	dst := make([]MarketUpdate, MaxBatch)
	if allocs := testing.AllocsPerRun(100, func() { g.NextBatch(dst) }); allocs != 0 {
		t.Fatalf("NextBatch allocs = %v, want 0", allocs)
	}
}
```

- [ ] **Step 1b:** `book_test.go`. These are step-by-step unit tests of the model with fixed numbers. The first test is your example: a $1,000 buy budget on a ticker quoted at $101.96 / $102.00.

```go
package generator

import "testing"

func alfa() book { return book{bid: 10196, ask: 10200, bidQty: 600, askQty: 50} }

func TestW23_TakerFillsWithinLevel(t *testing.T) {
	b := alfa()
	price, filled := b.takerTrade(Ask, 100_000) // buyer with $1,000
	if price != 10200 || filled != 9 || b.askQty != 41 {
		t.Fatalf("got price %d filled %d askQty %d, want 10200 / 9 / 41", price, filled, b.askQty)
	}
	if b.bid != 10196 || b.ask != 10200 || b.bidQty != 600 {
		t.Fatalf("trade changed other book fields: %+v", b)
	}
}

func TestW23_TakerFillCappedByLevel(t *testing.T) {
	b := alfa()
	b.askQty = 5
	if _, filled := b.takerTrade(Ask, 100_000); filled != 5 || b.askQty != 0 {
		t.Fatalf("filled %d askQty %d, want 5 / 0", filled, b.askQty)
	}
}

func TestW09_SmallBudgetTradesOneShare(t *testing.T) {
	b := alfa()
	if _, filled := b.takerTrade(Ask, 1_000); filled != 1 { // $10 budget, $102 share
		t.Fatalf("filled %d, want 1", filled)
	}
}

func TestW08_SellTradesAtBid(t *testing.T) {
	b := alfa()
	price, filled := b.takerTrade(Bid, 100_000)
	if price != 10196 || filled != 9 || b.bidQty != 591 {
		t.Fatalf("got price %d filled %d bidQty %d, want 10196 / 9 / 591", price, filled, b.bidQty)
	}
}

func TestW26_MakerJoinAddsShares(t *testing.T) {
	b := alfa()
	b.makerAdd(Ask, 100_000)
	if b.ask != 10200 || b.askQty != 59 {
		t.Fatalf("got ask %d askQty %d, want 10200 / 59", b.ask, b.askQty)
	}
}

func TestW34_SweepBudgetEmptiesLevel(t *testing.T) {
	b := alfa()
	price, filled := b.takerTrade(Ask, b.levelCents(Ask)+100_000) // the level's value plus $1,000
	if price != 10200 || filled != 50 || b.askQty != 0 {
		t.Fatalf("got price %d filled %d askQty %d, want 10200 / 50 / 0", price, filled, b.askQty)
	}
}

func TestW24_RefreshMovesOnlyExhaustedLevel(t *testing.T) {
	cfg := DefaultModelConfig()
	b := alfa()
	b.askQty = 0
	moved, ok := b.refresh(cfg, 1_000_000) // new level holds $10,000
	if !ok || moved != Ask {
		t.Fatalf("refresh = (%v, %v), want (Ask, true)", moved, ok)
	}
	if b.ask != 10205 || b.askQty != 97 { // gap = 5 bps of $102.00 = 5¢; $10,000 / $102.05 = 97 shares
		t.Fatalf("got ask %d askQty %d, want 10205 / 97", b.ask, b.askQty)
	}
	if b.bid != 10196 || b.bidQty != 600 {
		t.Fatalf("bid side changed: %+v", b)
	}
}

func TestW24_RefreshNoopWhenLevelsHaveShares(t *testing.T) {
	b := alfa()
	if _, ok := b.refresh(DefaultModelConfig(), 1_000_000); ok || b != alfa() {
		t.Fatalf("refresh changed a book with shares on both sides: %+v", b)
	}
}

func TestW06_RefreshKeepsBidPositive(t *testing.T) {
	b := book{bid: 1, ask: 2, bidQty: 0, askQty: 10}
	b.refresh(DefaultModelConfig(), 1_000)
	if b.bid < 1 || b.bid >= b.ask {
		t.Fatalf("bid %d ask %d, want 1 <= bid < ask", b.bid, b.ask)
	}
}

func TestW07_ClampSpreadPullsOtherSideIn(t *testing.T) {
	cfg := DefaultModelConfig()
	b := book{bid: 10000, ask: 10100, bidQty: 1, askQty: 1} // spread 100¢ > cap(10100) = 20¢
	b.clampSpread(cfg, Ask)                                 // ask moved, so the bid follows
	if b.ask != 10100 || b.bid != 10080 {
		t.Fatalf("got bid %d ask %d, want 10080 / 10100", b.bid, b.ask)
	}
	b = book{bid: 10000, ask: 10100, bidQty: 1, askQty: 1}
	b.clampSpread(cfg, Bid) // bid moved, so the ask follows
	if b.bid != 10000 || b.ask != 10020 {
		t.Fatalf("got bid %d ask %d, want 10000 / 10020", b.bid, b.ask)
	}
}

func TestW25_DefaultConfigValid(t *testing.T) {
	if err := DefaultModelConfig().Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestW25_InvalidConfigRejected(t *testing.T) {
	cases := map[string]func(*ModelConfig){
		"start price range reversed": func(c *ModelConfig) { c.MinStartPriceCents, c.MaxStartPriceCents = 50_000, 1_000 },
		"start price below 2¢":       func(c *ModelConfig) { c.MinStartPriceCents = 1 },
		"order range reversed":       func(c *ModelConfig) { c.MinOrderCents, c.MaxOrderCents = 500_000, 10_000 },
		"zero depth":                 func(c *ModelConfig) { c.MinDepthCents = 0 },
		"zero gap":                   func(c *ModelConfig) { c.LevelGapBps = 0 },
		"max spread below initial":   func(c *ModelConfig) { c.MaxSpreadBps = c.InitialSpreadBps - 1 },
		"sweep chance above 100":     func(c *ModelConfig) { c.SweepChancePct = 101 },
		"sweep chance negative":      func(c *ModelConfig) { c.SweepChancePct = -1 },
	}
	for name, mutate := range cases {
		cfg := DefaultModelConfig()
		mutate(&cfg)
		if cfg.Validate() == nil {
			t.Errorf("%s: Validate() = nil, want error", name)
		}
		if _, err := New(1, 5, cfg); err == nil {
			t.Errorf("%s: New accepted an invalid config", name)
		}
	}
}
```

- [ ] **Step 2:** `encode_test.go`:

```go
package generator

import (
	"encoding/binary"
	"testing"
)

func TestW14_EncodeLayout(t *testing.T) {
	ups := []MarketUpdate{
		{Instrument: 3, PriceCents: 10200, TradeQuantity: 30, BidCents: 10196, AskCents: 10200, BidQuantity: 600, AskQuantity: 400},
		{Instrument: 1, PriceCents: 1, TradeQuantity: 2, BidCents: 1, AskCents: 2, BidQuantity: 0, AskQuantity: 7},
	}
	buf := make([]byte, len(ups)*BytesPerUpdate)
	Encode(buf, ups)
	want := []int32{3, 10200, 30, 10196, 10200, 600, 400, 1, 1, 2, 1, 2, 0, 7}
	for i, w := range want {
		if got := int32(binary.LittleEndian.Uint32(buf[i*4:])); got != w {
			t.Errorf("int32[%d] = %d, want %d", i, got, w)
		}
	}
}

func TestW15_EncodeDoesNotAllocate(t *testing.T) {
	ups := make([]MarketUpdate, MaxBatch)
	buf := make([]byte, MaxBatch*BytesPerUpdate)
	if allocs := testing.AllocsPerRun(100, func() { Encode(buf, ups) }); allocs != 0 {
		t.Fatalf("Encode allocs = %v, want 0", allocs)
	}
}
```

- [ ] **Step 3: Run** `pnpm test:go`. Expected: FAIL. Each `TestW…` that touches `New` fails with `not implemented`, `TestW03` fails with `= nil, want error`, and `TestW14` fails on wrong values. The `book_test.go` tests fail on zero values from the stub methods. The two `TestW15` tests may pass against empty stubs.
- [ ] **Step 4: Check the matrix.** Every Go test ID in the table above exists, and nothing else does: `grep -oE "func TestW[0-9]+_[A-Za-z]+" wasm/generator/*_test.go | sort` matches the table's Go column.
- [ ] **Step 5: Commit** with `git add wasm && git commit -m "test(wasm): generator, model and encoder specs W01–W26 (red)"`.

---

### Task 2.3: Implement generator and encoder (green)

**Files:** `wasm/generator/config.go`, `wasm/generator/book.go`, `wasm/generator/generator.go`, `wasm/generator/encode.go`

- [ ] **Step 1:** Range checks with messages naming field and range, e.g. `instrumentCount must be 1-50, got 0`, `updatesPerBatch must be 1-1000, got 1001`.
- [ ] **Step 2: Config.** `DefaultModelConfig()` returns the defaults from the interface block. `Validate()` checks min ≤ max for each range, all values > 0, `MinStartPriceCents ≥ 2` (so a 1¢ bid below a ≥2¢ ask exists), `InitialSpreadBps ≤ MaxSpreadBps` and `0 ≤ SweepChancePct ≤ 100`. Error messages name the field.
- [ ] **Step 3: Book methods** (`book.go`). Each step is a pure function of the book and its arguments, with no randomness. They're tested by `book_test.go`.
  - `bps(price, bps) = max(1, price*bps/10_000)`. `sharesFor(money, price) = max(1, money/price)`.
  - `takerTrade(s, budget)`: on side `s` (Ask for a buyer, Bid for a seller), `wanted := sharesFor(budget, levelPrice)` and `filled := min(wanted, levelQty)`. Subtract `filled` and return `(levelPrice, filled)`. Callers guarantee `levelQty ≥ 1` (refresh runs first). The rest of the order is cancelled, because only the best level is filled.
  - `makerAdd(s, budget)`: join the best level, adding `sharesFor(budget, price)` to side `s`. `levelCents(s)` is `price × qty` of that level.
  - `refresh(c, depth)`: if `askQty == 0`, set `ask += c.gap(ask)` and `askQty = sharesFor(depth, ask)`, then return `(Ask, true)`. Else if `bidQty == 0`, set `bid = max(1, bid − c.gap(bid))` and `bidQty = sharesFor(depth, bid)`. If `bid ≥ ask` after that, which can only happen at the 1¢ floor, set `ask = bid + 1`. Return `(Bid, true)`. Otherwise return `(_, false)`. At most one side is empty, since each update makes one trade.
  - `clampSpread(c, moved)`: if `ask − bid > c.spreadCap(ask)`, move the side that did not move. After an Ask move, `bid = ask − cap`; after a Bid move, `ask = bid + cap`. The moved-in level keeps its quantity.
  - Quantities are `int64` inside the book and saturate at `math.MaxInt32` when emitted, so long runs of maker joins can't overflow the int32 wire format.
- [ ] **Step 4: Generator** (`generator.go`):
  ```go
  type Generator struct {
  	cfg   ModelConfig
  	rng   *rand.Rand // math/rand/v2: rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
  	books []book     // one per instrument
  }
  ```
  - `New`: validate the count and config. For each instrument, draw `mid` uniform in [MinStartPrice, MaxStartPrice] and set `spread := cfg.bps(mid, InitialSpreadBps)`, `bid := max(1, mid − spread/2)`, `ask := bid + spread`. Each side gets `sharesFor(depth, price)`, with `depth` uniform in [MinDepth, MaxDepth].
  - `NextBatch`, for each `dst[k]`:
    1. Pick `i := rng.IntN(len(books))` uniformly. An instrument may repeat or be missing in a batch, by design.
    2. Call `refresh(cfg, uniformDepth())`. If it moved a side, call `clampSpread(cfg, moved)` and `noteMove(moved, spreadBefore, uniform(MinRestoreTicks, MaxRestoreTicks))`; otherwise, while a wait is pending, `tickRestore(uniformDepth())` (W35).
    3. A maker joins side `Bid`/`Ask` (coin flip) with budget `uniformOrder()`.
    4. A taker trades: a coin flip picks a buyer (side `Ask`) or seller (side `Bid`), `sweep := rng.Int64N(100) < SweepChancePct`, budget `uniformOrder()`, plus `levelCents(side)` on a sweep so the level is emptied. That gives `(price, filled)`.
    5. Write `dst[k] = {i, price, filled, bid, ask, bidQty, askQty}`. Quantities are after the fill, so a level can show 0. It moves at that instrument's next update (step 2), which keeps the price equal to that update's bid or ask (W08).
  - Draw order is fixed (instrument, depth, maker side, maker budget, taker side, sweep, taker budget), so a seed always gives the same stream (W12).
- [ ] **Step 5:** `Encode`: `binary.LittleEndian.PutUint32(dst[o:], uint32(int32(field)))` for the 7 fields in wire order.
- [ ] **Step 6: Run** `pnpm test:go`. Expected: PASS (all `TestW…`).
- [ ] **Step 7: Commit** with `git commit -am "feat(wasm): order-driven market model, generator and encoder"`.

---

### Task 2.4: JS bridge contract test (red)

This test runs the compiled module through the `WasmProducer` contract, the same surface the worker uses. Vitest runs the tests of a file in order, and `W21` must run before any `init`, so it comes first.

**Files:** Create `src/app/producer/wasm.integration.spec.ts`

- [ ] **Step 1:**

```ts
// @vitest-environment node
// Test names carry requirement IDs (W…); see the matrix in docs/superpowers/plans/2026-10-28-realtime-dashboard/02-wasm.md.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import './wasm_exec.js';
import { F, FIELDS_PER_UPDATE } from './protocol';
import type { WasmProducer } from './wasm-api';

let producer: WasmProducer;

beforeAll(async () => {
  const go = new Go();
  const bytes = await readFile(resolve(process.cwd(), 'public/producer.wasm'));
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  void go.run(instance);
  producer = globalThis.producer!;
});

/** Starts a run bound to a fresh Int32Array and returns that array. */
function run(seed: number, instruments: number, updates: number): Int32Array {
  const ints = new Int32Array(updates * FIELDS_PER_UPDATE);
  expect(producer.init(seed, instruments, updates, ints)).toBeNull();
  return ints;
}

const update = (ints: Int32Array, i: number) => ints.subarray(i * FIELDS_PER_UPDATE, (i + 1) * FIELDS_PER_UPDATE);

describe('compiled producer.wasm', () => {
  it('W21 nextBatch before init is a no-op', () => {
    expect(() => producer.nextBatch()).not.toThrow();
  });

  it('W16 registers the producer API', () => {
    expect(typeof producer.init).toBe('function');
    expect(typeof producer.nextBatch).toBe('function');
  });

  it('W03 W04 rejects out-of-range settings with a message', () => {
    const dst = new Int32Array(1001 * FIELDS_PER_UPDATE);
    expect(producer.init(1, 0, 100, dst)).toMatch(/instrumentCount/);
    expect(producer.init(1, 51, 100, dst)).toMatch(/instrumentCount/);
    expect(producer.init(1, 5, 0, dst)).toMatch(/updatesPerBatch/);
    expect(producer.init(1, 5, 1001, dst)).toMatch(/updatesPerBatch/);
  });

  it('W17 rejects an output buffer that is too small or not an Int32Array', () => {
    expect(producer.init(1, 5, 10, new Int32Array(69))).toMatch(/Int32Array/);
    expect(producer.init(1, 5, 10, new Float64Array(70) as unknown as Int32Array)).toMatch(/Int32Array/);
  });

  it('W20 survives invalid argument types', () => {
    expect(producer.init('x' as unknown as number, 5, 10, null as unknown as Int32Array)).toEqual(expect.any(String));
    expect(() => run(1, 5, 10)).not.toThrow();
  });

  it('W02 W05–W10 fills a batch of the requested size with valid updates', () => {
    const ints = run(7, 5, 100);
    producer.nextBatch();
    for (let i = 0; i < 100; i++) {
      const u = update(ints, i);
      expect(u[F.instrument]).toBeGreaterThanOrEqual(0); // W05
      expect(u[F.instrument]).toBeLessThan(5); // W05
      expect(u[F.price]).toBeGreaterThan(0); // W06
      expect(u[F.ask]).toBeGreaterThan(u[F.bid]); // W07
      expect([u[F.bid], u[F.ask]]).toContain(u[F.price]); // W08
      expect(u[F.tradeQty]).toBeGreaterThanOrEqual(1); // W09
      expect(u[F.bidQty]).toBeGreaterThanOrEqual(0); // W10
      expect(u[F.askQty]).toBeGreaterThanOrEqual(0); // W10
    }
  });

  it('W02 W19 writes exactly updatesPerBatch updates', () => {
    const ints = new Int32Array(11 * FIELDS_PER_UPDATE).fill(-1);
    expect(producer.init(7, 5, 10, ints)).toBeNull();
    producer.nextBatch();
    expect(update(ints, 9)[F.price]).toBeGreaterThan(0);
    expect(Array.from(update(ints, 10))).toEqual(Array(FIELDS_PER_UPDATE).fill(-1));
  });

  it('W19 respects the byteOffset of a subarray view', () => {
    const backing = new Int32Array(12 * FIELDS_PER_UPDATE).fill(-1);
    const dst = backing.subarray(FIELDS_PER_UPDATE, 11 * FIELDS_PER_UPDATE); // skips the first update slot
    expect(producer.init(3, 5, 10, dst)).toBeNull();
    producer.nextBatch();
    expect(Array.from(update(backing, 0))).toEqual(Array(FIELDS_PER_UPDATE).fill(-1));
    expect(Array.from(update(backing, 11))).toEqual(Array(FIELDS_PER_UPDATE).fill(-1));
    expect(dst[F.price]).toBeGreaterThan(0);
  });

  it('W01 keeps state between calls', () => {
    const ints = run(7, 5, 100);
    producer.nextBatch();
    const first = Array.from(ints);
    producer.nextBatch();
    expect(Array.from(ints)).not.toEqual(first);
  });

  it('W12 same seed restarts the same sequence', () => {
    const a = run(9, 5, 50);
    producer.nextBatch();
    const b = run(9, 5, 50);
    producer.nextBatch();
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it('W18 a rejected init keeps the previous run and its buffer', () => {
    const ints = run(9, 5, 50);
    expect(producer.init(9, 5, 0, new Int32Array(0))).toEqual(expect.any(String));
    ints.fill(0);
    producer.nextBatch();
    expect(ints[F.price]).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run** `pnpm test -- --run src/app/producer/wasm.integration.spec.ts`. Expected: `W21` and `W16` pass, because the skeleton registers both functions. The rest FAIL, since `init` returns `"not implemented"`.
- [ ] **Step 3: Check the matrix.** `grep -oE "it\('W[0-9][^']*" src/app/producer/wasm.integration.spec.ts` should match the table's JS column.
- [ ] **Step 4: Commit** with `git add src/app/producer/wasm.integration.spec.ts && git commit -m "test(wasm): js bridge contract specs W01–W21 (red)"`.

---

### Task 2.5: Implement bridge (green)

**Files:** `wasm/main.go`

- [ ] **Step 1:** Package-level run state: `gen *generator.Generator`, `ups []generator.MarketUpdate`, `buf []byte`, `out js.Value` (byte view of the bound Int32Array).
- [ ] **Step 2:** `init(seed, count, batch, dst)`, validating in this order: `ValidateBatchSize(batch)`; then `dst.InstanceOf(js.Global().Get("Int32Array"))` and `dst.Get("length").Int() >= batch*FieldsPerUpdate`, with messages like `dst must be an Int32Array of at least 70 elements`; then `generator.New(uint64(seed), count, generator.DefaultModelConfig())`. Any error returns `err.Error()` and leaves the current state untouched. On success, assign `gen`, allocate `ups` (len batch) and `buf` (batch × BytesPerUpdate), set `out = Uint8Array.New(dst.Get("buffer"), dst.Get("byteOffset"), batch*BytesPerUpdate)`, and return `nil` (JS `null`). `recover()` in the handler and return the panic text, so bad args never kill the Go runtime.
- [ ] **Step 3:** `nextBatch()`: `if gen == nil { return nil }`; `gen.NextBatch(ups)`; `generator.Encode(buf, ups)`; `js.CopyBytesToJS(out, buf)`.
- [ ] **Step 3b: Document it in code.** `main.go` gets a package doc comment with the same memory-model explanation as `wasm-api.ts`: why a byte view exists (CopyBytesToJS takes only Uint8Array), why it shares memory with the Int32Array, why it's little-endian, and why it is created once per init. Keep a short comment on each of `out`, `buf` and `ups`, too. A reviewer must be able to understand the transfer without asking.
- [ ] **Step 4: Run** `pnpm test -- --run src/app/producer/wasm.integration.spec.ts` and `pnpm test:go` — expected PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(wasm): implement js bridge"`. Report to the orchestrator: test output, binary size of `public/producer.wasm`, and the requirements table with a pass/fail mark per ID (W13 and W22 marked by their stated check).
