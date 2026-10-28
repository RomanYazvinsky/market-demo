import type { WasmProducer } from '../wasm-api';

/** Writes `updatesPerBatch` updates of qty 1, round-robin over instruments. */
export class FakeWasm implements WasmProducer {
  inits: Array<[seed: number, instruments: number, updates: number, dstLength: number]> = [];
  batches = 0;
  initResult: string | null = null;
  private n = 0;
  private k = 0;
  private dst = new Int32Array(0);

  init(seed: number, n: number, k: number, dst: Int32Array) {
    this.inits.push([seed, n, k, dst.length]);
    if (this.initResult === null) {
      this.n = n;
      this.k = k;
      this.dst = dst;
    }
    return this.initResult;
  }

  nextBatch() {
    for (let i = 0; i < this.k; i++) this.dst.set([i % this.n, 10000, 1, 9999, 10000, 10, 10], i * 7);
    this.batches++;
  }
}
