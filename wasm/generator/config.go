package generator

import "errors"

// ModelConfig holds every tunable number of the market model. All money is in cents,
// all relative sizes in basis points (1 bp = 0.01%). Defaults live in DefaultModelConfig;
// changing a number means editing that function (author decision: Go-side config only).
type ModelConfig struct {
	MinStartPriceCents, MaxStartPriceCents int64 // initial mid per instrument
	MinOrderCents, MaxOrderCents           int64 // budget of one maker or taker order
	MinDepthCents, MaxDepthCents           int64 // money resting on a freshly made level
	LevelGapBps                            int64 // distance of a new level from an exhausted one (min 1¢)
	InitialSpreadBps                       int64 // starting spread (min 1¢)
	MaxSpreadBps                           int64 // spread cap (min 1¢)
	ImproveChancePct                       int64 // chance a maker improves the best price by 1¢ instead of joining it
}

func DefaultModelConfig() ModelConfig {
	return ModelConfig{
		MinStartPriceCents: 1_000, MaxStartPriceCents: 50_000,
		MinOrderCents: 10_000, MaxOrderCents: 500_000,
		MinDepthCents: 500_000, MaxDepthCents: 5_000_000,
		LevelGapBps:      5,
		InitialSpreadBps: 5,
		MaxSpreadBps:     20,
		ImproveChancePct: 30,
	}
}

func (c ModelConfig) Validate() error { return errors.New("not implemented") }
