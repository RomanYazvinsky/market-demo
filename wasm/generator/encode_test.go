package generator

import (
	"encoding/binary"
	"testing"
)

func TestW14_EncodeLayout(t *testing.T) {
	ups := []MarketUpdate{
		{Instrument: 3, PriceCents: 10200, TradeQuantity: 30, BidCents: 10196, AskCents: 10200, BidQuantity: 600, AskQuantity: 400},
		{Instrument: 1, PriceCents: 1, TradeQuantity: 2, BidCents: 1, AskCents: 2, BidQuantity: 0, AskQuantity: 7},
	}
	buf := make([]byte, len(ups)*BytesPerUpdate)
	Encode(buf, ups)
	want := []int32{3, 10200, 30, 10196, 10200, 600, 400, 1, 1, 2, 1, 2, 0, 7}
	for i, w := range want {
		if got := int32(binary.LittleEndian.Uint32(buf[i*4:])); got != w {
			t.Errorf("int32[%d] = %d, want %d", i, got, w)
		}
	}
}

func TestW15_EncodeDoesNotAllocate(t *testing.T) {
	ups := make([]MarketUpdate, MaxBatch)
	buf := make([]byte, MaxBatch*BytesPerUpdate)
	if allocs := testing.AllocsPerRun(100, func() { Encode(buf, ups) }); allocs != 0 {
		t.Fatalf("Encode allocs = %v, want 0", allocs)
	}
}
