package generator

import "encoding/binary"

// Encode writes ups into dst as little-endian int32, FieldsPerUpdate per update in wire order:
// [instrument, price, tradeQty, bid, ask, bidQty, askQty]. dst needs len(ups)*BytesPerUpdate bytes.
func Encode(dst []byte, ups []MarketUpdate) {
	le := binary.LittleEndian
	for k, u := range ups {
		o := k * BytesPerUpdate
		le.PutUint32(dst[o:], uint32(int32(u.Instrument)))
		le.PutUint32(dst[o+4:], uint32(int32(u.PriceCents)))
		le.PutUint32(dst[o+8:], uint32(int32(u.TradeQuantity)))
		le.PutUint32(dst[o+12:], uint32(int32(u.BidCents)))
		le.PutUint32(dst[o+16:], uint32(int32(u.AskCents)))
		le.PutUint32(dst[o+20:], uint32(int32(u.BidQuantity)))
		le.PutUint32(dst[o+24:], uint32(int32(u.AskQuantity)))
	}
}
