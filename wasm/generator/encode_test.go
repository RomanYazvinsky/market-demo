package generator

import (
	"encoding/binary"
	"testing"
)

func TestW14_EncodeLayout(test *testing.T) {
	updates := []MarketUpdate{
		{Instrument: 3, PriceCents: 10200, TradeQuantity: 30, BidCents: 10196, AskCents: 10200, BidQuantity: 600, AskQuantity: 400},
		{Instrument: 1, PriceCents: 1, TradeQuantity: 2, BidCents: 1, AskCents: 2, BidQuantity: 0, AskQuantity: 7},
	}
	encoded := make([]byte, len(updates)*BytesPerUpdate)
	Encode(encoded, updates)
	want := []int32{3, 10200, 30, 10196, 10200, 600, 400, 1, 1, 2, 1, 2, 0, 7}
	for index, expected := range want {
		if got := int32(binary.LittleEndian.Uint32(encoded[index*4:])); got != expected {
			test.Errorf("int32[%d] = %d, want %d", index, got, expected)
		}
	}
}

func TestW15_EncodeDoesNotAllocate(test *testing.T) {
	updates := make([]MarketUpdate, MaxBatch)
	encoded := make([]byte, MaxBatch*BytesPerUpdate)
	if allocs := testing.AllocsPerRun(100, func() { Encode(encoded, updates) }); allocs != 0 {
		test.Fatalf("Encode allocs = %v, want 0", allocs)
	}
}
