package generator

import "testing"

func alfa() book { return book{bid: 10196, ask: 10200, bidQty: 600, askQty: 50} }

func TestW23_TakerFillsWithinLevel(test *testing.T) {
	orderBook := alfa()
	price, filled := orderBook.takerTrade(Ask, 100_000) // buyer with $1,000
	if price != 10200 || filled != 9 || orderBook.askQty != 41 {
		test.Fatalf("got price %d filled %d askQty %d, want 10200 / 9 / 41", price, filled, orderBook.askQty)
	}
	if orderBook.bid != 10196 || orderBook.ask != 10200 || orderBook.bidQty != 600 {
		test.Fatalf("trade changed other book fields: %+v", orderBook)
	}
}

func TestW23_TakerFillCappedByLevel(test *testing.T) {
	orderBook := alfa()
	orderBook.askQty = 5
	if _, filled := orderBook.takerTrade(Ask, 100_000); filled != 5 || orderBook.askQty != 0 {
		test.Fatalf("filled %d askQty %d, want 5 / 0", filled, orderBook.askQty)
	}
}

func TestW09_SmallBudgetTradesOneShare(test *testing.T) {
	orderBook := alfa()
	if _, filled := orderBook.takerTrade(Ask, 1_000); filled != 1 { // $10 budget, $102 share
		test.Fatalf("filled %d, want 1", filled)
	}
}

func TestW08_SellTradesAtBid(test *testing.T) {
	orderBook := alfa()
	price, filled := orderBook.takerTrade(Bid, 100_000)
	if price != 10196 || filled != 9 || orderBook.bidQty != 591 {
		test.Fatalf("got price %d filled %d bidQty %d, want 10196 / 9 / 591", price, filled, orderBook.bidQty)
	}
}

func TestW26_MakerJoinAddsShares(test *testing.T) {
	orderBook := alfa()
	orderBook.makerAdd(Ask, 100_000, false)
	if orderBook.ask != 10200 || orderBook.askQty != 59 {
		test.Fatalf("got ask %d askQty %d, want 10200 / 59", orderBook.ask, orderBook.askQty)
	}
}

func TestW07_MakerImproveNarrowsSpread(test *testing.T) {
	orderBook := alfa()
	orderBook.makerAdd(Bid, 100_000, true)
	if orderBook.bid != 10197 || orderBook.bidQty != 9 { // new best level: 1¢ better, only the maker's shares
		test.Fatalf("got bid %d bidQty %d, want 10197 / 9", orderBook.bid, orderBook.bidQty)
	}
}

func TestW07_MakerImproveNeverCrosses(test *testing.T) {
	orderBook := book{bid: 10199, ask: 10200, bidQty: 600, askQty: 50}
	orderBook.makerAdd(Bid, 100_000, true) // spread is already 1¢: joins instead
	if orderBook.bid != 10199 || orderBook.bidQty != 609 {
		test.Fatalf("got bid %d bidQty %d, want 10199 / 609", orderBook.bid, orderBook.bidQty)
	}
}

func TestW24_RefreshMovesOnlyExhaustedLevel(test *testing.T) {
	config := DefaultModelConfig()
	orderBook := alfa()
	orderBook.askQty = 0
	moved, ok := orderBook.refresh(config, 1_000_000) // new level holds $10,000
	if !ok || moved != Ask {
		test.Fatalf("refresh = (%v, %v), want (Ask, true)", moved, ok)
	}
	if orderBook.ask != 10205 || orderBook.askQty != 97 { // gap = 5 bps of $102.00 = 5¢; $10,000 / $102.05 = 97 shares
		test.Fatalf("got ask %d askQty %d, want 10205 / 97", orderBook.ask, orderBook.askQty)
	}
	if orderBook.bid != 10196 || orderBook.bidQty != 600 {
		test.Fatalf("bid side changed: %+v", orderBook)
	}
}

func TestW24_RefreshNoopWhenLevelsHaveShares(test *testing.T) {
	orderBook := alfa()
	if _, ok := orderBook.refresh(DefaultModelConfig(), 1_000_000); ok || orderBook != alfa() {
		test.Fatalf("refresh changed a book with shares on both sides: %+v", orderBook)
	}
}

func TestW06_RefreshKeepsBidPositive(test *testing.T) {
	orderBook := book{bid: 1, ask: 2, bidQty: 0, askQty: 10}
	orderBook.refresh(DefaultModelConfig(), 1_000)
	if orderBook.bid < 1 || orderBook.bid >= orderBook.ask {
		test.Fatalf("bid %d ask %d, want 1 <= bid < ask", orderBook.bid, orderBook.ask)
	}
}

func TestW07_ClampSpreadPullsOtherSideIn(test *testing.T) {
	config := DefaultModelConfig()
	orderBook := book{bid: 10000, ask: 10100, bidQty: 1, askQty: 1} // spread 100¢ > cap(10100) = 20¢
	orderBook.clampSpread(config, Ask)                                 // ask moved, so the bid follows
	if orderBook.ask != 10100 || orderBook.bid != 10080 {
		test.Fatalf("got bid %d ask %d, want 10080 / 10100", orderBook.bid, orderBook.ask)
	}
	orderBook = book{bid: 10000, ask: 10100, bidQty: 1, askQty: 1}
	orderBook.clampSpread(config, Bid) // bid moved, so the ask follows
	if orderBook.bid != 10000 || orderBook.ask != 10020 {
		test.Fatalf("got bid %d ask %d, want 10000 / 10020", orderBook.bid, orderBook.ask)
	}
}

func TestW25_DefaultConfigValid(test *testing.T) {
	if err := DefaultModelConfig().Validate(); err != nil {
		test.Fatal(err)
	}
}

func TestW25_InvalidConfigRejected(test *testing.T) {
	cases := map[string]func(*ModelConfig){
		"start price range reversed": func(config *ModelConfig) { config.MinStartPriceCents, config.MaxStartPriceCents = 50_000, 1_000 },
		"start price below 2¢":       func(config *ModelConfig) { config.MinStartPriceCents = 1 },
		"order range reversed":       func(config *ModelConfig) { config.MinOrderCents, config.MaxOrderCents = 500_000, 10_000 },
		"zero depth":                 func(config *ModelConfig) { config.MinDepthCents = 0 },
		"zero gap":                   func(config *ModelConfig) { config.LevelGapBps = 0 },
		"max spread below initial":   func(config *ModelConfig) { config.MaxSpreadBps = config.InitialSpreadBps - 1 },
		"improve chance above 100":   func(config *ModelConfig) { config.ImproveChancePct = 101 },
		"improve chance negative":    func(config *ModelConfig) { config.ImproveChancePct = -1 },
	}
	for name, mutate := range cases {
		config := DefaultModelConfig()
		mutate(&config)
		if config.Validate() == nil {
			test.Errorf("%s: Validate() = nil, want error", name)
		}
		if _, err := New(1, 5, config); err == nil {
			test.Errorf("%s: New accepted an invalid config", name)
		}
	}
}
