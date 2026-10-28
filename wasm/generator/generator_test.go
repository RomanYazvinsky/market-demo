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
