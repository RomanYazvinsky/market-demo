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

func (c ModelConfig) bps(price, bps int64) int64 { return 0 }

func (c ModelConfig) gap(price int64) int64 { return 0 }

func (c ModelConfig) spreadCap(ask int64) int64 { return 0 }

func sharesFor(moneyCents, priceCents int64) int64 { return 0 }

func (b *book) refresh(c ModelConfig, depthCents int64) (moved Side, ok bool) { return 0, false }

func (b *book) clampSpread(c ModelConfig, moved Side) {}

func (b *book) makerAdd(s Side, budgetCents int64, improve bool) {}

func (b *book) takerTrade(s Side, budgetCents int64) (priceCents, filled int64) { return 0, 0 }
