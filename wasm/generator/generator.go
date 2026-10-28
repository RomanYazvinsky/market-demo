package generator

import "errors"

const (
	MaxInstruments  = 50
	MaxBatch        = 1000
	FieldsPerUpdate = 7
	BytesPerUpdate  = FieldsPerUpdate * 4
)

type Generator struct{}

func New(seed uint64, instrumentCount int, cfg ModelConfig) (*Generator, error) {
	return nil, errors.New("not implemented")
}

func ValidateBatchSize(n int) error { return errors.New("not implemented") }

func (g *Generator) InstrumentCount() int { return 0 }

func (g *Generator) NextBatch(dst []MarketUpdate) {}
