package generator

// Side is a side of the book. A buyer takes from Ask, a seller from Bid.
type Side int8

const (
	Bid Side = iota
	Ask
)

// book is one instrument's one-level order book: best price and the shares resting there.
type book struct {
	bid, ask       int64 // cents
	bidQty, askQty int64 // shares
	// After a level moves away, the other side follows it once restoreTicks more updates
	// of this instrument have passed, bringing the spread back to restoreSpread.
	restoreSpread int64
	restoreTicks  int64 // 0 = nothing pending
	lastMoved     Side
}

// bps returns basisPoints basis points of price, at least 1¢.
func (config ModelConfig) bps(price, basisPoints int64) int64 {
	return max(1, price*basisPoints/10_000)
}

// gap is the distance of a new level from an exhausted one.
func (config ModelConfig) gap(price int64) int64 { return config.bps(price, config.LevelGapBps) }

// spreadCap is the widest allowed spread for a book whose ask is at ask.
func (config ModelConfig) spreadCap(ask int64) int64 { return config.bps(ask, config.MaxSpreadBps) }

// sharesFor is how many whole shares money buys at price, at least 1.
func sharesFor(moneyCents, priceCents int64) int64 { return max(1, moneyCents/priceCents) }

// refresh replaces an exhausted level with a new one config.gap away, holding depthCents of shares.
// It reports which side moved; ok is false if both levels still had shares.
func (orderBook *book) refresh(config ModelConfig, depthCents int64) (moved Side, ok bool) {
	switch {
	case orderBook.askQty == 0:
		orderBook.ask += config.gap(orderBook.ask)
		orderBook.askQty = sharesFor(depthCents, orderBook.ask)
		return Ask, true
	case orderBook.bidQty == 0:
		orderBook.bid = max(1, orderBook.bid-config.gap(orderBook.bid))
		orderBook.bidQty = sharesFor(depthCents, orderBook.bid)
		if orderBook.bid >= orderBook.ask { // only possible at the 1¢ floor
			orderBook.ask = orderBook.bid + 1
		}
		return Bid, true
	}
	return 0, false
}

// clampSpread pulls the side that did not move toward the one that did if the spread
// exceeds the cap. The moved-in level keeps its quantity.
func (orderBook *book) clampSpread(config ModelConfig, moved Side) {
	limit := config.spreadCap(orderBook.ask)
	if orderBook.ask-orderBook.bid <= limit {
		return
	}
	if moved == Ask {
		orderBook.bid = orderBook.ask - limit
		return
	}
	orderBook.ask = orderBook.bid + limit
	// A lower ask can have a 1¢ smaller cap (integer rounding); step down until it fits.
	for orderBook.ask-orderBook.bid > config.spreadCap(orderBook.ask) {
		orderBook.ask--
	}
}

// noteMove records that side moved away from a spread of previousSpread. The first move
// starts the wait of ticks updates and fixes the spread to return to; later moves during
// the wait only change which side moved last.
func (orderBook *book) noteMove(side Side, previousSpread, ticks int64) {
	if orderBook.restoreTicks == 0 {
		orderBook.restoreSpread = previousSpread
		orderBook.restoreTicks = ticks
	}
	orderBook.lastMoved = side
}

// tickRestore counts one update of the wait. When it ends and the spread is still wider than
// before the move, the side opposite the last move gets a new level of depthCents at the old
// distance. It reports whether a level was placed.
func (orderBook *book) tickRestore(depthCents int64) bool {
	if orderBook.restoreTicks == 0 {
		return false
	}
	orderBook.restoreTicks--
	if orderBook.restoreTicks > 0 || orderBook.ask-orderBook.bid <= orderBook.restoreSpread {
		return false
	}
	if orderBook.lastMoved == Ask {
		orderBook.bid = orderBook.ask - orderBook.restoreSpread
		orderBook.bidQty = sharesFor(depthCents, orderBook.bid)
	} else {
		orderBook.ask = orderBook.bid + orderBook.restoreSpread
		orderBook.askQty = sharesFor(depthCents, orderBook.ask)
	}
	return true
}

// makerAdd adds budget/price shares to the best level on side.
func (orderBook *book) makerAdd(side Side, budgetCents int64) {
	if side == Bid {
		orderBook.bidQty += sharesFor(budgetCents, orderBook.bid)
	} else {
		orderBook.askQty += sharesFor(budgetCents, orderBook.ask)
	}
}

// levelCents is the money resting at the best level on side.
func (orderBook *book) levelCents(side Side) int64 {
	if side == Bid {
		return orderBook.bid * orderBook.bidQty
	}
	return orderBook.ask * orderBook.askQty
}

// takerTrade takes liquidity from side (Ask for a buyer, Bid for a seller): it fills
// min(budget/price, shares at the level) at the best price; the rest is cancelled.
// Callers guarantee the level has at least one share (refresh runs first).
func (orderBook *book) takerTrade(side Side, budgetCents int64) (priceCents, filled int64) {
	price, quantity := &orderBook.bid, &orderBook.bidQty
	if side == Ask {
		price, quantity = &orderBook.ask, &orderBook.askQty
	}
	filled = min(sharesFor(budgetCents, *price), *quantity)
	*quantity -= filled
	return *price, filled
}
