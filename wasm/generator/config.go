package generator

import "fmt"

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
		MinStartPriceCents: 1_000, MaxStartPriceCents: 50_000, // $10–$500
		MinOrderCents: 10_000, MaxOrderCents: 500_000, // $100–$5,000
		MinDepthCents: 500_000, MaxDepthCents: 5_000_000, // $5k–$50k
		LevelGapBps:      5,
		InitialSpreadBps: 5,
		MaxSpreadBps:     20,
		ImproveChancePct: 30,
	}
}

// Validate checks min <= max for each range, all values > 0, MinStartPriceCents >= 2
// (so a 1¢ bid below a >= 2¢ ask exists), InitialSpreadBps <= MaxSpreadBps and
// 0 <= ImproveChancePct <= 100.
func (c ModelConfig) Validate() error {
	ranges := []struct {
		name     string
		min, max int64
	}{
		{"StartPriceCents", c.MinStartPriceCents, c.MaxStartPriceCents},
		{"OrderCents", c.MinOrderCents, c.MaxOrderCents},
		{"DepthCents", c.MinDepthCents, c.MaxDepthCents},
	}
	for _, r := range ranges {
		if r.min <= 0 {
			return fmt.Errorf("Min%s must be > 0, got %d", r.name, r.min)
		}
		if r.min > r.max {
			return fmt.Errorf("Min%s (%d) must be <= Max%s (%d)", r.name, r.min, r.name, r.max)
		}
	}
	if c.MinStartPriceCents < 2 {
		return fmt.Errorf("MinStartPriceCents must be >= 2, got %d", c.MinStartPriceCents)
	}
	positive := []struct {
		name string
		v    int64
	}{
		{"LevelGapBps", c.LevelGapBps},
		{"InitialSpreadBps", c.InitialSpreadBps},
		{"MaxSpreadBps", c.MaxSpreadBps},
	}
	for _, p := range positive {
		if p.v <= 0 {
			return fmt.Errorf("%s must be > 0, got %d", p.name, p.v)
		}
	}
	if c.InitialSpreadBps > c.MaxSpreadBps {
		return fmt.Errorf("InitialSpreadBps (%d) must be <= MaxSpreadBps (%d)", c.InitialSpreadBps, c.MaxSpreadBps)
	}
	if c.ImproveChancePct < 0 || c.ImproveChancePct > 100 {
		return fmt.Errorf("ImproveChancePct must be 0-100, got %d", c.ImproveChancePct)
	}
	return nil
}
