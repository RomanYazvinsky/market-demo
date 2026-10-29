package generator

// Test names carry requirement IDs (W01…); see the matrix in
// docs/superpowers/plans/2026-10-28-realtime-dashboard/02-wasm.md.

import (
	"slices"
	"sync"
	"testing"
)

func newGenerator(test *testing.T, seed uint64, instrumentCount int) *Generator {
	test.Helper()
	generator, err := New(seed, instrumentCount, DefaultModelConfig())
	if err != nil {
		test.Fatalf("New(%d, %d): %v", seed, instrumentCount, err)
	}
	return generator
}

func batch(generator *Generator, size int) []MarketUpdate {
	dst := make([]MarketUpdate, size)
	generator.NextBatch(dst)
	return dst
}

const sampleInstruments = 5

// sample is 200 batches × 1000 updates from seed 42, shared by the invariant tests (W05–W10).
var sample = sync.OnceValues(func() ([]MarketUpdate, error) {
	generator, err := New(42, sampleInstruments, DefaultModelConfig())
	if err != nil {
		return nil, err
	}
	collected := make([]MarketUpdate, 0, 200*MaxBatch)
	dst := make([]MarketUpdate, MaxBatch)
	for range 200 {
		generator.NextBatch(dst)
		collected = append(collected, dst...)
	}
	return collected, nil
})

func eachSampled(test *testing.T, check func(update MarketUpdate) bool, what string) {
	test.Helper()
	updates, err := sample()
	if err != nil {
		test.Fatalf("sample: %v", err)
	}
	for index, update := range updates {
		if !check(update) {
			test.Fatalf("update %d violates %q: %+v", index, what, update)
		}
	}
}

func TestW01_StateRetainedBetweenCalls(test *testing.T) {
	generator := newGenerator(test, 7, 5)
	first, second := batch(generator, 500), batch(generator, 500)
	fresh := batch(newGenerator(test, 7, 5), 500)
	if !slices.Equal(first, fresh) {
		test.Fatal("first batch should match a fresh generator with the same seed")
	}
	if slices.Equal(second, fresh) {
		test.Fatal("second batch equals a fresh first batch: state was reset between calls")
	}
}

func TestW02_BatchHasRequestedSize(test *testing.T) {
	for _, size := range []int{1, 100, MaxBatch} {
		for index, update := range batch(newGenerator(test, 1, 5), size) {
			if update.PriceCents <= 0 {
				test.Fatalf("size=%d: dst[%d] not filled: %+v", size, index, update)
			}
		}
	}
}

func TestW03_BatchSizeRange(test *testing.T) {
	for _, size := range []int{-1, 0, MaxBatch + 1} {
		if ValidateBatchSize(size) == nil {
			test.Errorf("ValidateBatchSize(%d) = nil, want error", size)
		}
	}
	for _, size := range []int{1, MaxBatch} {
		if err := ValidateBatchSize(size); err != nil {
			test.Errorf("ValidateBatchSize(%d) = %v", size, err)
		}
	}
}

func TestW04_InstrumentCountRange(test *testing.T) {
	for _, instrumentCount := range []int{-1, 0, MaxInstruments + 1} {
		if _, err := New(1, instrumentCount, DefaultModelConfig()); err == nil {
			test.Errorf("New(1, %d) err = nil, want error", instrumentCount)
		}
	}
	for _, instrumentCount := range []int{1, MaxInstruments} {
		if generator := newGenerator(test, 1, instrumentCount); generator.InstrumentCount() != instrumentCount {
			test.Errorf("InstrumentCount() = %d, want %d", generator.InstrumentCount(), instrumentCount)
		}
	}
}

func TestW05_InstrumentIndexInRange(test *testing.T) {
	eachSampled(test, func(update MarketUpdate) bool {
		return int(update.Instrument) >= 0 && int(update.Instrument) < sampleInstruments
	}, "0 <= instrument < count")
}

func TestW05_EveryInstrumentAppears(test *testing.T) {
	seen := map[Instrument]bool{}
	for _, update := range batch(newGenerator(test, 3, 5), MaxBatch) {
		seen[update.Instrument] = true
	}
	if len(seen) != 5 {
		test.Fatalf("saw %d instruments, want 5", len(seen))
	}
}

func TestW05_InstrumentsMayRepeatInBatch(test *testing.T) {
	seen := map[Instrument]int{}
	for _, update := range batch(newGenerator(test, 3, 5), 100) {
		seen[update.Instrument]++
	}
	for _, occurrences := range seen {
		if occurrences > 1 {
			return
		}
	}
	test.Fatal("no instrument repeated in a batch of 100 over 5 instruments")
}

func TestW06_PricesPositive(test *testing.T) {
	eachSampled(test, func(update MarketUpdate) bool {
		return update.PriceCents > 0 && update.BidCents > 0 && update.AskCents > 0
	}, "prices > 0")
}

func TestW07_BidBelowAsk(test *testing.T) {
	config := DefaultModelConfig()
	eachSampled(test, func(update MarketUpdate) bool {
		spread := int64(update.AskCents) - int64(update.BidCents)
		return spread >= 1 && spread <= config.spreadCap(int64(update.AskCents))
	}, "1 <= ask-bid <= spreadCap(ask)")
}

func TestW08_TradeAtBidOrAsk(test *testing.T) {
	eachSampled(test, func(update MarketUpdate) bool {
		price := int(update.PriceCents)
		return price == int(update.BidCents) || price == int(update.AskCents)
	}, "price == bid || price == ask")
}

func TestW09_TradeQuantityPositive(test *testing.T) {
	eachSampled(test, func(update MarketUpdate) bool {
		return update.TradeQuantity >= 1
	}, "tradeQuantity >= 1")
}

func TestW10_BookQuantitiesNonNegative(test *testing.T) {
	eachSampled(test, func(update MarketUpdate) bool {
		return update.BidQuantity >= 0 && update.AskQuantity >= 0
	}, "bid/ask quantity >= 0")
}

func TestW11_PricesEvolveFromPreviousValues(test *testing.T) {
	updates, err := sample()
	if err != nil {
		test.Fatalf("sample: %v", err)
	}
	config := DefaultModelConfig()
	last := map[Instrument]MarketUpdate{}
	changes := 0
	for _, update := range updates {
		if previous, ok := last[update.Instrument]; ok {
			change := max(int64(update.BidCents)-int64(previous.BidCents), int64(previous.BidCents)-int64(update.BidCents))
			limit := config.gap(int64(previous.BidCents)) + config.spreadCap(int64(previous.AskCents)) + 1
			if change > limit {
				test.Fatalf("bid jumped %d cents (limit %d, unrelated to previous value): %+v -> %+v", change, limit, previous, update)
			}
			if change != 0 {
				changes++
			}
		}
		last[update.Instrument] = update
	}
	if changes == 0 {
		test.Fatal("prices never moved")
	}
}

func TestW24_QuotesMoveAwayOnlyAfterExhaustion(test *testing.T) {
	updates, err := sample()
	if err != nil {
		test.Fatalf("sample: %v", err)
	}
	last := map[Instrument]MarketUpdate{}
	for _, update := range updates {
		if previous, ok := last[update.Instrument]; ok {
			if update.AskCents > previous.AskCents && previous.AskQuantity != 0 {
				test.Fatalf("ask moved up while %d shares were still offered: %+v -> %+v", previous.AskQuantity, previous, update)
			}
			if update.BidCents < previous.BidCents && previous.BidQuantity != 0 {
				test.Fatalf("bid moved down while %d shares were still bid: %+v -> %+v", previous.BidQuantity, previous, update)
			}
		}
		last[update.Instrument] = update
	}
}

// tradedLevelEmptied reports whether the update's trade left its level with 0 shares.
func tradedLevelEmptied(update MarketUpdate) bool {
	if int64(update.PriceCents) == int64(update.AskCents) {
		return update.AskQuantity == 0
	}
	return update.BidQuantity == 0
}

func TestW34_EverySweepEmptiesTheTradedLevel(test *testing.T) {
	config := DefaultModelConfig()
	config.SweepChancePct = 100
	generator, err := New(42, 3, config)
	if err != nil {
		test.Fatal(err)
	}
	for index, update := range batch(generator, 1000) {
		if !tradedLevelEmptied(update) {
			test.Fatalf("update %d: a sweep left shares at the traded level: %+v", index, update)
		}
	}
}

func TestW34_SweepRateFollowsConfig(test *testing.T) {
	updates, err := sample()
	if err != nil {
		test.Fatalf("sample: %v", err)
	}
	emptied := 0
	for _, update := range updates {
		if tradedLevelEmptied(update) {
			emptied++
		}
	}
	share := 100 * float64(emptied) / float64(len(updates))
	want := float64(DefaultModelConfig().SweepChancePct)
	if share < want || share > want+3 { // sweeps, plus the rare natural exhaustion of a level
		test.Fatalf("traded level emptied in %.2f%% of updates, want %.0f–%.0f%%", share, want, want+3)
	}
}

func TestW35_SpreadReturnsAfterTheWait(test *testing.T) {
	config := DefaultModelConfig()
	config.SweepChancePct = 0
	config.MinDepthCents, config.MaxDepthCents = 1_000_000_000, 1_000_000_000 // no natural exhaustion
	config.MinRestoreTicks, config.MaxRestoreTicks = 4, 4
	generator, err := New(42, 1, config)
	if err != nil {
		test.Fatal(err)
	}
	start := generator.books[0]
	spread := start.ask - start.bid
	generator.books[0].askQty = 0 // as if a buyer had swept the ask
	updates := batch(generator, 5) // the move, then 4 updates of waiting; the 4th restores
	for index, update := range updates[:4] {
		if got := int64(update.AskCents) - int64(update.BidCents); got != spread+config.gap(start.ask) || int64(update.BidCents) != start.bid {
			test.Fatalf("update %d: spread %d bid %d, want the widened spread %d with the bid unchanged", index, got, update.BidCents, spread+config.gap(start.ask))
		}
	}
	last := updates[4]
	if int64(last.AskCents)-int64(last.BidCents) != spread || int64(last.AskCents) != start.ask+config.gap(start.ask) {
		test.Fatalf("5th update %+v: want spread %d back with the ask kept at %d", last, spread, start.ask+config.gap(start.ask))
	}
}

func TestW12_DeterministicForSeed(test *testing.T) {
	if !slices.Equal(batch(newGenerator(test, 7, 5), 500), batch(newGenerator(test, 7, 5), 500)) {
		test.Fatal("same seed produced different batches")
	}
	if slices.Equal(batch(newGenerator(test, 7, 5), 500), batch(newGenerator(test, 8, 5), 500)) {
		test.Fatal("different seeds produced identical batches")
	}
}

func TestW15_NextBatchDoesNotAllocate(test *testing.T) {
	generator := newGenerator(test, 1, MaxInstruments)
	dst := make([]MarketUpdate, MaxBatch)
	if allocs := testing.AllocsPerRun(100, func() { generator.NextBatch(dst) }); allocs != 0 {
		test.Fatalf("NextBatch allocs = %v, want 0", allocs)
	}
}
