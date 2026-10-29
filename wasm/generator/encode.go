package generator

import "encoding/binary"

// Encode writes updates into dst as little-endian int32, FieldsPerUpdate per update in wire order:
// [instrument, price, tradeQty, bid, ask, bidQty, askQty]. dst needs len(updates)*BytesPerUpdate bytes.
func Encode(dst []byte, updates []MarketUpdate) {
	byteOrder := binary.LittleEndian
	for index, update := range updates {
		offset := index * BytesPerUpdate
		byteOrder.PutUint32(dst[offset:], uint32(int32(update.Instrument)))
		byteOrder.PutUint32(dst[offset+4:], uint32(int32(update.PriceCents)))
		byteOrder.PutUint32(dst[offset+8:], uint32(int32(update.TradeQuantity)))
		byteOrder.PutUint32(dst[offset+12:], uint32(int32(update.BidCents)))
		byteOrder.PutUint32(dst[offset+16:], uint32(int32(update.AskCents)))
		byteOrder.PutUint32(dst[offset+20:], uint32(int32(update.BidQuantity)))
		byteOrder.PutUint32(dst[offset+24:], uint32(int32(update.AskQuantity)))
	}
}
