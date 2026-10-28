package generator

type Instrument int8
type PriceCents int32
type TradeQuantity int32
type BidCents int32
type AskCents int32
type BidQuantity int32
type AskQuantity int32

type Settings struct {
	Instruments map[Instrument]PriceCents
}

type MarketUpdate struct {
	Instrument    Instrument
	PriceCents    PriceCents
	TradeQuantity TradeQuantity
	BidCents      BidCents
	AskCents      AskCents
	BidQuantity   BidQuantity
	AskQuantity   AskQuantity
}
