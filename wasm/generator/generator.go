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
	config ModelConfig
	random *rand.Rand
	books  []book // one per instrument
}

func New(seed uint64, instrumentCount int, config ModelConfig) (*Generator, error) {
	if instrumentCount < 1 || instrumentCount > MaxInstruments {
		return nil, fmt.Errorf("instrumentCount must be 1-%d, got %d", MaxInstruments, instrumentCount)
	}
	if err := config.Validate(); err != nil {
		return nil, err
	}
	generator := &Generator{
		config: config,
		random: rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15)),
		books:  make([]book, instrumentCount),
	}
	for instrument := range generator.books {
		mid := generator.uniform(config.MinStartPriceCents, config.MaxStartPriceCents)
		spread := config.bps(mid, config.InitialSpreadBps)
		bid := max(1, mid-spread/2)
		ask := bid + spread
		generator.books[instrument] = book{
			bid: bid, ask: ask,
			bidQty: sharesFor(generator.uniformDepth(), bid),
			askQty: sharesFor(generator.uniformDepth(), ask),
		}
	}
	return generator, nil
}

func ValidateBatchSize(updatesPerBatch int) error {
	if updatesPerBatch < 1 || updatesPerBatch > MaxBatch {
		return fmt.Errorf("updatesPerBatch must be 1-%d, got %d", MaxBatch, updatesPerBatch)
	}
	return nil
}

func (generator *Generator) InstrumentCount() int { return len(generator.books) }

// NextBatch fills every element of dst in place, without allocating. The draw order per
// update is fixed (instrument, depth, maker side, maker budget, taker side, sweep,
// taker budget), so a seed always gives the same stream.
func (generator *Generator) NextBatch(dst []MarketUpdate) {
	config := generator.config
	for index := range dst {
		instrument := generator.random.IntN(len(generator.books)) // an instrument may repeat or be missing in a batch
		orderBook := &generator.books[instrument]
		if moved, ok := orderBook.refresh(config, generator.uniformDepth()); ok {
			orderBook.clampSpread(config, moved)
		}
		orderBook.makerAdd(generator.side(), generator.uniformOrder())
		takerSide := generator.side()
		sweep := generator.random.Int64N(100) < config.SweepChancePct
		takerBudget := generator.uniformOrder()
		if sweep { // more than the level holds; the rest is cancelled
			takerBudget += orderBook.levelCents(takerSide)
		}
		price, filled := orderBook.takerTrade(takerSide, takerBudget)
		// Quantities are after the fill, so a level can show 0; it moves at that
		// instrument's next update, which keeps price equal to this update's bid or ask.
		dst[index] = MarketUpdate{
			Instrument:    Instrument(instrument),
			PriceCents:    PriceCents(price),
			TradeQuantity: TradeQuantity(sat32(filled)),
			BidCents:      BidCents(orderBook.bid),
			AskCents:      AskCents(orderBook.ask),
			BidQuantity:   BidQuantity(sat32(orderBook.bidQty)),
			AskQuantity:   AskQuantity(sat32(orderBook.askQty)),
		}
	}
}

func (generator *Generator) uniform(low, high int64) int64 {
	return low + generator.random.Int64N(high-low+1)
}

func (generator *Generator) uniformDepth() int64 {
	return generator.uniform(generator.config.MinDepthCents, generator.config.MaxDepthCents)
}

func (generator *Generator) uniformOrder() int64 {
	return generator.uniform(generator.config.MinOrderCents, generator.config.MaxOrderCents)
}

func (generator *Generator) side() Side {
	if generator.random.IntN(2) == 0 {
		return Bid
	}
	return Ask
}

// sat32 saturates a book quantity at math.MaxInt32 so it fits the int32 wire format.
func sat32(value int64) int32 { return int32(min(value, math.MaxInt32)) }
