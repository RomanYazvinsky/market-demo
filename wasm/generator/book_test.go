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
	orderBook.makerAdd(Ask, 100_000)
	if orderBook.ask != 10200 || orderBook.askQty != 59 {
		test.Fatalf("got ask %d askQty %d, want 10200 / 59", orderBook.ask, orderBook.askQty)
	}
}

func TestW27_SweepBudgetEmptiesLevel(test *testing.T) {
	orderBook := alfa()
	price, filled := orderBook.takerTrade(Ask, orderBook.levelCents(Ask)+100_000) // the level's value plus $1,000
	if price != 10200 || filled != 50 || orderBook.askQty != 0 {
		test.Fatalf("got price %d filled %d askQty %d, want 10200 / 50 / 0", price, filled, orderBook.askQty)
	}
	if orderBook.levelCents(Bid) != 10196*600 {
		test.Fatalf("levelCents(Bid) = %d, want %d", orderBook.levelCents(Bid), 10196*600)
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
	orderBook.clampSpread(config, Ask)                              // ask moved, so the bid follows
	if orderBook.ask != 10100 || orderBook.bid != 10080 {
		test.Fatalf("got bid %d ask %d, want 10080 / 10100", orderBook.bid, orderBook.ask)
	}
	orderBook = book{bid: 10000, ask: 10100, bidQty: 1, askQty: 1}
	orderBook.clampSpread(config, Bid) // bid moved, so the ask follows
	if orderBook.bid != 10000 || orderBook.ask != 10020 {
		test.Fatalf("got bid %d ask %d, want 10000 / 10020", orderBook.bid, orderBook.ask)
	}
}

func TestW28_OppositeSideFollowsAfterTheWait(test *testing.T) {
	orderBook := book{bid: 10000, ask: 10025, bidQty: 5, askQty: 7} // a sweep moved the ask from 10020 up to 10025
	orderBook.noteMove(Ask, 20, 2)
	if orderBook.tickRestore(1_000_000) {
		test.Fatal("restored after 1 of 2 ticks")
	}
	if !orderBook.tickRestore(1_000_000) { // a new bid level $10,000 deep, ask − previous spread
		test.Fatal("did not restore after 2 ticks")
	}
	if orderBook.bid != 10005 || orderBook.bidQty != 99 || orderBook.ask != 10025 || orderBook.askQty != 7 {
		test.Fatalf("got %+v, want bid 10005 × 99, ask 10025 × 7", orderBook)
	}
	if orderBook.tickRestore(1_000_000) {
		test.Fatal("restored twice")
	}
}

func TestW28_BidMoveIsFollowedByTheAsk(test *testing.T) {
	orderBook := book{bid: 9995, ask: 10020, bidQty: 5, askQty: 7} // a sweep moved the bid from 10000 down to 9995
	orderBook.noteMove(Bid, 20, 1)
	orderBook.tickRestore(1_000_000)
	if orderBook.bid != 9995 || orderBook.ask != 10015 || orderBook.askQty != 99 {
		test.Fatalf("got %+v, want bid 9995, ask 10015 × 99", orderBook)
	}
}

func TestW28_LaterMovesKeepTheFirstSpreadAndWait(test *testing.T) {
	orderBook := book{bid: 10000, ask: 10025, bidQty: 5, askQty: 7}
	orderBook.noteMove(Ask, 20, 2) // spread 20 before the first move
	orderBook.tickRestore(1_000_000)
	orderBook.ask = 10030
	orderBook.noteMove(Ask, 25, 9) // a second sweep during the wait
	if !orderBook.tickRestore(1_000_000) {
		test.Fatal("a later move restarted the wait")
	}
	if orderBook.bid != 10010 || orderBook.ask != 10030 {
		test.Fatalf("got bid %d ask %d, want 10010 / 10030 (back to the first spread)", orderBook.bid, orderBook.ask)
	}
}

func TestW28_LastMovedSideDecidesWhoFollows(test *testing.T) {
	orderBook := book{bid: 9995, ask: 10025, bidQty: 5, askQty: 7}
	orderBook.noteMove(Ask, 20, 1)
	orderBook.noteMove(Bid, 25, 5) // the bid moved last, so the ask follows it
	orderBook.tickRestore(1_000_000)
	if orderBook.bid != 9995 || orderBook.ask != 10015 {
		test.Fatalf("got bid %d ask %d, want 9995 / 10015", orderBook.bid, orderBook.ask)
	}
}

func TestW28_NoRestoreWhenTheSpreadIsAlreadyNarrow(test *testing.T) {
	orderBook := book{bid: 10000, ask: 10020, bidQty: 5, askQty: 7} // the cap clamp already pulled the bid in
	orderBook.noteMove(Ask, 20, 1)
	orderBook.tickRestore(1_000_000)
	if orderBook.bid != 10000 || orderBook.bidQty != 5 {
		test.Fatalf("got %+v, want the bid level untouched", orderBook)
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
		"sweep chance above 100":     func(config *ModelConfig) { config.SweepChancePct = 101 },
		"sweep chance negative":      func(config *ModelConfig) { config.SweepChancePct = -1 },
		"zero restore ticks":         func(config *ModelConfig) { config.MinRestoreTicks = 0 },
		"restore ticks reversed":     func(config *ModelConfig) { config.MinRestoreTicks, config.MaxRestoreTicks = 20, 1 },
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
