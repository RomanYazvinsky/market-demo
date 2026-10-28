import type { MetricsRow } from './protocol';

export function spreadCents(bidCents: number, askCents: number): number {
  throw new Error('not implemented');
}

export function vwapCents(notionalCents: bigint, volume: bigint): number | null {
  throw new Error('not implemented');
}

export function imbalance(bidQty: number, askQty: number): number | null {
  throw new Error('not implemented');
}

export class MetricsStore {
  constructor(symbols: string[]) {
    throw new Error('not implemented');
  }

  add(batch: Int32Array, updateCount: number): void {
    throw new Error('not implemented');
  }

  snapshot(): MetricsRow[] {
    throw new Error('not implemented');
  }
}
