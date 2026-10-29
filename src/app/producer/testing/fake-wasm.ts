import type { ProducerInit, WasmProducer } from '../wasm-api';

/** Writes `updatesPerBatch` updates of qty 1, round-robin over instruments. */
export class FakeWasm implements WasmProducer {
  inits: Array<[seed: number, instruments: number, updates: number, dstLength: number]> = [];
  batches = 0;
  initResult: string | null = null;
  private instrumentCount = 0;
  private updatesPerBatch = 0;
  private dst: Int32Array = new Int32Array(0);

  init(config: ProducerInit, dst: Int32Array) {
    this.inits.push([config.seed, config.instrumentCount, config.updatesPerBatch, dst.length]);
    if (this.initResult === null) {
      this.instrumentCount = config.instrumentCount;
      this.updatesPerBatch = config.updatesPerBatch;
      this.dst = dst;
    }
    return this.initResult;
  }

  nextBatch() {
    for (let index = 0; index < this.updatesPerBatch; index++) {
      this.dst.set([index % this.instrumentCount, 10000, 1, 9999, 10000, 10, 10], index * 7);
    }
    this.batches++;
  }
}
