import { FIELD, FIELDS_PER_UPDATE, emptyRow, type MetricsRow } from './protocol';

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
    const instrumentCount = symbols.length;
    this.hasData = new Uint8Array(instrumentCount);
    this.last = new Int32Array(instrumentCount);
    this.bid = new Int32Array(instrumentCount);
    this.ask = new Int32Array(instrumentCount);
    this.bidQty = new Int32Array(instrumentCount);
    this.askQty = new Int32Array(instrumentCount);
    this.volume = new Array<bigint>(instrumentCount).fill(0n);
    this.notional = new Array<bigint>(instrumentCount).fill(0n);
  }

  /** Folds the first `updateCount` updates of `batch` into the totals. */
  add(batch: Int32Array, updateCount: number): void {
    for (let updateIndex = 0; updateIndex < updateCount; updateIndex++) {
      const offset = updateIndex * FIELDS_PER_UPDATE;
      const instrument = batch[offset + FIELD.instrument];
      const price = batch[offset + FIELD.price];
      const quantity = batch[offset + FIELD.tradeQty];
      this.hasData[instrument] = 1;
      this.last[instrument] = price;
      this.bid[instrument] = batch[offset + FIELD.bid];
      this.ask[instrument] = batch[offset + FIELD.ask];
      this.bidQty[instrument] = batch[offset + FIELD.bidQty];
      this.askQty[instrument] = batch[offset + FIELD.askQty];
      this.volume[instrument] += BigInt(quantity);
      this.notional[instrument] += BigInt(price) * BigInt(quantity);
    }
  }

  snapshot(): MetricsRow[] {
    return this.symbols.map((symbol, instrument) =>
      this.hasData[instrument]
        ? {
            symbol,
            lastPriceCents: this.last[instrument],
            spreadCents: spreadCents(this.bid[instrument], this.ask[instrument]),
            volume: this.volume[instrument],
            vwapCents: vwapCents(this.notional[instrument], this.volume[instrument]),
            imbalance: imbalance(this.bidQty[instrument], this.askQty[instrument]),
          }
        : emptyRow(symbol),
    );
  }
}
