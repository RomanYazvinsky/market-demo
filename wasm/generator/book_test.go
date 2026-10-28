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
	b.makerAdd(Ask, 100_000, false)
	if b.ask != 10200 || b.askQty != 59 {
		t.Fatalf("got ask %d askQty %d, want 10200 / 59", b.ask, b.askQty)
	}
}

func TestW07_MakerImproveNarrowsSpread(t *testing.T) {
	b := alfa()
	b.makerAdd(Bid, 100_000, true)
	if b.bid != 10197 || b.bidQty != 9 { // new best level: 1¢ better, only the maker's shares
		t.Fatalf("got bid %d bidQty %d, want 10197 / 9", b.bid, b.bidQty)
	}
}

func TestW07_MakerImproveNeverCrosses(t *testing.T) {
	b := book{bid: 10199, ask: 10200, bidQty: 600, askQty: 50}
	b.makerAdd(Bid, 100_000, true) // spread is already 1¢: joins instead
	if b.bid != 10199 || b.bidQty != 609 {
		t.Fatalf("got bid %d bidQty %d, want 10199 / 609", b.bid, b.bidQty)
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
		"improve chance above 100":   func(c *ModelConfig) { c.ImproveChancePct = 101 },
		"improve chance negative":    func(c *ModelConfig) { c.ImproveChancePct = -1 },
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
