package generator

import (
	"fmt"
	"math"
	"math/rand/v2"
)

const (
	MaxInstruments  = 50
	MaxBatch        = 1000
	FieldsPerUpdate = 7
	BytesPerUpdate  = FieldsPerUpdate * 4
)

// Generator is an order-driven market: one one-level book per instrument, a seeded PRNG
// and the model config. Each update is one maker order followed by one trade.
type Generator struct {
	cfg   ModelConfig
	rng   *rand.Rand
	books []book // one per instrument
}

func New(seed uint64, instrumentCount int, cfg ModelConfig) (*Generator, error) {
	if instrumentCount < 1 || instrumentCount > MaxInstruments {
		return nil, fmt.Errorf("instrumentCount must be 1-%d, got %d", MaxInstruments, instrumentCount)
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	g := &Generator{
		cfg:   cfg,
		rng:   rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15)),
		books: make([]book, instrumentCount),
	}
	for i := range g.books {
		mid := g.uniform(cfg.MinStartPriceCents, cfg.MaxStartPriceCents)
		spread := cfg.bps(mid, cfg.InitialSpreadBps)
		bid := max(1, mid-spread/2)
		ask := bid + spread
		g.books[i] = book{
			bid: bid, ask: ask,
			bidQty: sharesFor(g.uniformDepth(), bid),
			askQty: sharesFor(g.uniformDepth(), ask),
		}
	}
	return g, nil
}

func ValidateBatchSize(n int) error {
	if n < 1 || n > MaxBatch {
		return fmt.Errorf("updatesPerBatch must be 1-%d, got %d", MaxBatch, n)
	}
	return nil
}

func (g *Generator) InstrumentCount() int { return len(g.books) }

// NextBatch fills every element of dst in place, without allocating. The draw order per
// update is fixed (instrument, depth, maker side, maker budget, improve, taker side,
// taker budget), so a seed always gives the same stream.
func (g *Generator) NextBatch(dst []MarketUpdate) {
	c := g.cfg
	for k := range dst {
		i := g.rng.IntN(len(g.books)) // an instrument may repeat or be missing in a batch
		b := &g.books[i]
		if moved, ok := b.refresh(c, g.uniformDepth()); ok {
			b.clampSpread(c, moved)
		}
		makerSide := g.side()
		makerBudget := g.uniformOrder()
		improve := g.rng.Int64N(100) < c.ImproveChancePct
		b.makerAdd(makerSide, makerBudget, improve)
		takerSide := g.side()
		price, filled := b.takerTrade(takerSide, g.uniformOrder())
		// Quantities are after the fill, so a level can show 0; it moves at that
		// instrument's next update, which keeps price equal to this update's bid or ask.
		dst[k] = MarketUpdate{
			Instrument:    Instrument(i),
			PriceCents:    PriceCents(price),
			TradeQuantity: TradeQuantity(sat32(filled)),
			BidCents:      BidCents(b.bid),
			AskCents:      AskCents(b.ask),
			BidQuantity:   BidQuantity(sat32(b.bidQty)),
			AskQuantity:   AskQuantity(sat32(b.askQty)),
		}
	}
}

func (g *Generator) uniform(lo, hi int64) int64 { return lo + g.rng.Int64N(hi-lo+1) }

func (g *Generator) uniformDepth() int64 {
	return g.uniform(g.cfg.MinDepthCents, g.cfg.MaxDepthCents)
}

func (g *Generator) uniformOrder() int64 {
	return g.uniform(g.cfg.MinOrderCents, g.cfg.MaxOrderCents)
}

func (g *Generator) side() Side {
	if g.rng.IntN(2) == 0 {
		return Bid
	}
	return Ask
}

// sat32 saturates a book quantity at math.MaxInt32 so it fits the int32 wire format.
func sat32(v int64) int32 { return int32(min(v, math.MaxInt32)) }
