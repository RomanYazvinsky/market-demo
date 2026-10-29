/**
 * JS surface registered by wasm/main.go on `globalThis.producer`.
 *
 * ## Data layout
 * One update is 7 int32 values (FIELDS_PER_UPDATE; offsets in `FIELD`):
 *   [instrumentIndex, priceCents, tradeQuantity, bidCents, askCents, bidQuantity, askQuantity]
 * A batch of k updates occupies the first k * 7 elements of the run's Int32Array.
 *
 * ## Memory model — how a batch gets from Go into the worker
 * 1. The worker allocates ONE Int32Array per run (length updatesPerBatch * 7) and hands it to `init`.
 * 2. Go keeps a reference to it for the whole run. Go's own memory and JS memory are separate,
 *    so Go cannot write into the Int32Array directly; the only bulk copy primitive syscall/js
 *    offers is `js.CopyBytesToJS(dst, src []byte)`, which accepts only a Uint8Array destination.
 *    Therefore, inside `init`, Go creates
 *    `new Uint8Array(dst.buffer, dst.byteOffset, updatesPerBatch * 28)`: a second *view* over the
 *    same memory as the first updatesPerBatch * 7 elements of `dst` (no new memory, no copy, never
 *    past the batch). This is a Go-side implementation detail; JS only ever sees the Int32Array.
 * 3. `nextBatch()` generates the updates, encodes them into a reused Go []byte as
 *    little-endian int32, and performs exactly one CopyBytesToJS into that byte view.
 *    After it returns, the worker reads the values through its Int32Array.
 *    Per batch: one bulk copy (max 28 KB), zero allocations on either side.
 * 4. Byte order: Wasm memory is little-endian by spec; JS typed arrays use the platform's
 *    byte order. All supported browser platforms are little-endian; the worker verifies this
 *    at load time (`loadWasmProducer` rejects on a big-endian platform) instead of assuming it.
 *
 * Rejected alternatives: writing element by element via `dst.SetIndex` (7,000 JS calls per
 * batch); reading Go's linear memory from JS by pointer (depends on wasm_exec.js internals,
 * the view detaches whenever Go's memory grows).
 */
/** The run settings `init` takes; every field must be a number. */
export interface ProducerInit {
  seed: number;
  instrumentCount: number;
  updatesPerBatch: number;
}

export interface WasmProducer {
  /**
   * Starts a new run: seeds the PRNG, creates per-instrument state and binds `dst` as the
   * output buffer for every following `nextBatch()`.
   * Returns null on success, otherwise a readable error:
   *  - `config` not an object, or a field missing or not a number,
   *  - instrumentCount outside 1–50, updatesPerBatch outside 1–1000,
   *  - `dst` not an Int32Array, or shorter than updatesPerBatch * 7.
   * On error the previous run (state and bound buffer) is left untouched.
   */
  init(config: ProducerInit, dst: Int32Array): string | null;

  /**
   * Overwrites the first updatesPerBatch * 7 elements of the bound Int32Array with a new batch.
   * Generator state (prices, book) carries over between calls. No-op before a successful init.
   */
  nextBatch(): void;
}
