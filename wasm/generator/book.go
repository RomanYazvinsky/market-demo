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
}

// bps returns bps basis points of price, at least 1¢.
func (c ModelConfig) bps(price, bps int64) int64 { return max(1, price*bps/10_000) }

// gap is the distance of a new level from an exhausted one.
func (c ModelConfig) gap(price int64) int64 { return c.bps(price, c.LevelGapBps) }

// spreadCap is the widest allowed spread for a book whose ask is at ask.
func (c ModelConfig) spreadCap(ask int64) int64 { return c.bps(ask, c.MaxSpreadBps) }

// sharesFor is how many whole shares money buys at price, at least 1.
func sharesFor(moneyCents, priceCents int64) int64 { return max(1, moneyCents/priceCents) }

// refresh replaces an exhausted level with a new one c.gap away, holding depthCents of shares.
// It reports which side moved; ok is false if both levels still had shares.
func (b *book) refresh(c ModelConfig, depthCents int64) (moved Side, ok bool) {
	switch {
	case b.askQty == 0:
		b.ask += c.gap(b.ask)
		b.askQty = sharesFor(depthCents, b.ask)
		return Ask, true
	case b.bidQty == 0:
		b.bid = max(1, b.bid-c.gap(b.bid))
		b.bidQty = sharesFor(depthCents, b.bid)
		if b.bid >= b.ask { // only possible at the 1¢ floor
			b.ask = b.bid + 1
		}
		return Bid, true
	}
	return 0, false
}

// clampSpread pulls the side that did not move toward the one that did if the spread
// exceeds the cap. The moved-in level keeps its quantity.
func (b *book) clampSpread(c ModelConfig, moved Side) {
	limit := c.spreadCap(b.ask)
	if b.ask-b.bid <= limit {
		return
	}
	if moved == Ask {
		b.bid = b.ask - limit
		return
	}
	b.ask = b.bid + limit
	// A lower ask can have a 1¢ smaller cap (integer rounding); step down until it fits.
	for b.ask-b.bid > c.spreadCap(b.ask) {
		b.ask--
	}
}

// makerAdd adds liquidity on side s. With improve (and room inside the spread) the maker
// sets a new best level 1¢ better holding only its shares; otherwise it joins the best level.
func (b *book) makerAdd(s Side, budgetCents int64, improve bool) {
	if improve && b.ask-b.bid > 1 {
		if s == Bid {
			b.bid++
			b.bidQty = sharesFor(budgetCents, b.bid)
		} else {
			b.ask--
			b.askQty = sharesFor(budgetCents, b.ask)
		}
		return
	}
	if s == Bid {
		b.bidQty += sharesFor(budgetCents, b.bid)
	} else {
		b.askQty += sharesFor(budgetCents, b.ask)
	}
}

// takerTrade takes liquidity from side s (Ask for a buyer, Bid for a seller): it fills
// min(budget/price, shares at the level) at the best price; the rest is cancelled.
// Callers guarantee the level has at least one share (refresh runs first).
func (b *book) takerTrade(s Side, budgetCents int64) (priceCents, filled int64) {
	price, qty := &b.bid, &b.bidQty
	if s == Ask {
		price, qty = &b.ask, &b.askQty
	}
	filled = min(sharesFor(budgetCents, *price), *qty)
	*qty -= filled
	return *price, filled
}
