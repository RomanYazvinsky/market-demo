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
	SweepChancePct                         int64 // chance a taker order is larger than the best level, so it empties it
}

func DefaultModelConfig() ModelConfig {
	return ModelConfig{
		MinStartPriceCents: 1_000, MaxStartPriceCents: 50_000, // $10–$500
		MinOrderCents: 10_000, MaxOrderCents: 500_000, // $100–$5,000
		MinDepthCents: 500_000, MaxDepthCents: 5_000_000, // $5k–$50k
		LevelGapBps:      5,
		InitialSpreadBps: 5,
		MaxSpreadBps:     20,
		SweepChancePct:   10,
	}
}

// Validate checks min <= max for each range, all values > 0, MinStartPriceCents >= 2
// (so a 1¢ bid below a >= 2¢ ask exists), InitialSpreadBps <= MaxSpreadBps and
// 0 <= SweepChancePct <= 100.
func (config ModelConfig) Validate() error {
	ranges := []struct {
		name     string
		min, max int64
	}{
		{"StartPriceCents", config.MinStartPriceCents, config.MaxStartPriceCents},
		{"OrderCents", config.MinOrderCents, config.MaxOrderCents},
		{"DepthCents", config.MinDepthCents, config.MaxDepthCents},
	}
	for _, valueRange := range ranges {
		if valueRange.min <= 0 {
			return fmt.Errorf("Min%s must be > 0, got %d", valueRange.name, valueRange.min)
		}
		if valueRange.min > valueRange.max {
			return fmt.Errorf("Min%s (%d) must be <= Max%s (%d)", valueRange.name, valueRange.min, valueRange.name, valueRange.max)
		}
	}
	if config.MinStartPriceCents < 2 {
		return fmt.Errorf("MinStartPriceCents must be >= 2, got %d", config.MinStartPriceCents)
	}
	positive := []struct {
		name  string
		value int64
	}{
		{"LevelGapBps", config.LevelGapBps},
		{"InitialSpreadBps", config.InitialSpreadBps},
		{"MaxSpreadBps", config.MaxSpreadBps},
	}
	for _, field := range positive {
		if field.value <= 0 {
			return fmt.Errorf("%s must be > 0, got %d", field.name, field.value)
		}
	}
	if config.InitialSpreadBps > config.MaxSpreadBps {
		return fmt.Errorf("InitialSpreadBps (%d) must be <= MaxSpreadBps (%d)", config.InitialSpreadBps, config.MaxSpreadBps)
	}
	if config.SweepChancePct < 0 || config.SweepChancePct > 100 {
		return fmt.Errorf("SweepChancePct must be 0-100, got %d", config.SweepChancePct)
	}
	return nil
}
