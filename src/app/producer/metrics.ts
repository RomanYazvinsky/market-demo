import { F, FIELDS_PER_UPDATE, emptyRow, type MetricsRow } from './protocol';

export function spreadCents(bidCents: number, askCents: number): number {
  return askCents - bidCents;
}

/** Cumulative VWAP in cents with two fractional digits (truncated); null with zero volume. */
export function vwapCents(notionalCents: bigint, volume: bigint): number | null {
  return volume === 0n ? null : Number((notionalCents * 100n) / volume) / 100;
}

export function imbalance(bidQty: number, askQty: number): number | null {
  const total = bidQty + askQty;
  return total === 0 ? null : (bidQty - askQty) / total;
}

/** Per-instrument running totals and latest quote. Fixed size per instrument; no event history. */
export class MetricsStore {
  private readonly hasData: Uint8Array;
  private readonly last: Int32Array;
  private readonly bid: Int32Array;
  private readonly ask: Int32Array;
  private readonly bidQty: Int32Array;
  private readonly askQty: Int32Array;
  private readonly volume: bigint[];
  private readonly notional: bigint[];

  constructor(private readonly symbols: string[]) {
    const n = symbols.length;
    this.hasData = new Uint8Array(n);
    this.last = new Int32Array(n);
    this.bid = new Int32Array(n);
    this.ask = new Int32Array(n);
    this.bidQty = new Int32Array(n);
    this.askQty = new Int32Array(n);
    this.volume = new Array<bigint>(n).fill(0n);
    this.notional = new Array<bigint>(n).fill(0n);
  }

  /** Folds the first `updateCount` updates of `batch` into the totals. */
  add(batch: Int32Array, updateCount: number): void {
    for (let u = 0; u < updateCount; u++) {
      const o = u * FIELDS_PER_UPDATE;
      const i = batch[o + F.instrument];
      const price = batch[o + F.price];
      const qty = batch[o + F.tradeQty];
      this.hasData[i] = 1;
      this.last[i] = price;
      this.bid[i] = batch[o + F.bid];
      this.ask[i] = batch[o + F.ask];
      this.bidQty[i] = batch[o + F.bidQty];
      this.askQty[i] = batch[o + F.askQty];
      this.volume[i] += BigInt(qty);
      this.notional[i] += BigInt(price) * BigInt(qty);
    }
  }

  snapshot(): MetricsRow[] {
    return this.symbols.map((symbol, i) =>
      this.hasData[i]
        ? {
            symbol,
            lastPriceCents: this.last[i],
            spreadCents: spreadCents(this.bid[i], this.ask[i]),
            volume: this.volume[i],
            vwapCents: vwapCents(this.notional[i], this.volume[i]),
            imbalance: imbalance(this.bidQty[i], this.askQty[i]),
          }
        : emptyRow(symbol),
    );
  }
}
