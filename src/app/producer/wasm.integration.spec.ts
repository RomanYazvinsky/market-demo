// @vitest-environment node
// Test names carry requirement IDs (W…); see the matrix in docs/superpowers/plans/2026-10-28-realtime-dashboard/02-wasm.md.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import './wasm_exec.js';
import { FIELD, FIELDS_PER_UPDATE } from './protocol';
import type { WasmProducer } from './wasm-api';

let producer: WasmProducer;

beforeAll(async () => {
  const go = new Go();
  const bytes = await readFile(resolve(process.cwd(), 'public/producer.wasm'));
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  void go.run(instance);
  producer = globalThis.producer!;
});

/** Starts a run bound to a fresh Int32Array and returns that array. */
function run(seed: number, instruments: number, updates: number): Int32Array {
  const ints = new Int32Array(updates * FIELDS_PER_UPDATE);
  expect(producer.init(seed, instruments, updates, ints)).toBeNull();
  return ints;
}

const update = (ints: Int32Array, index: number) => ints.subarray(index * FIELDS_PER_UPDATE, (index + 1) * FIELDS_PER_UPDATE);

describe('compiled producer.wasm', () => {
  it('W21 nextBatch before init is a no-op', () => {
    expect(() => producer.nextBatch()).not.toThrow();
  });

  it('W16 registers the producer API', () => {
    expect(typeof producer.init).toBe('function');
    expect(typeof producer.nextBatch).toBe('function');
  });

  it('W03 W04 rejects out-of-range settings with a message', () => {
    const dst = new Int32Array(1001 * FIELDS_PER_UPDATE);
    expect(producer.init(1, 0, 100, dst)).toMatch(/instrumentCount/);
    expect(producer.init(1, 51, 100, dst)).toMatch(/instrumentCount/);
    expect(producer.init(1, 5, 0, dst)).toMatch(/updatesPerBatch/);
    expect(producer.init(1, 5, 1001, dst)).toMatch(/updatesPerBatch/);
  });

  it('W17 rejects an output buffer that is too small or not an Int32Array', () => {
    expect(producer.init(1, 5, 10, new Int32Array(69))).toMatch(/Int32Array/);
    expect(producer.init(1, 5, 10, new Float64Array(70) as unknown as Int32Array)).toMatch(/Int32Array/);
  });

  it('W20 survives invalid argument types', () => {
    expect(producer.init('x' as unknown as number, 5, 10, null as unknown as Int32Array)).toEqual(expect.any(String));
    expect(() => run(1, 5, 10)).not.toThrow();
  });

  it('W02 W05–W10 fills a batch of the requested size with valid updates', () => {
    const ints = run(7, 5, 100);
    producer.nextBatch();
    for (let index = 0; index < 100; index++) {
      const fields = update(ints, index);
      expect(fields[FIELD.instrument]).toBeGreaterThanOrEqual(0); // W05
      expect(fields[FIELD.instrument]).toBeLessThan(5); // W05
      expect(fields[FIELD.price]).toBeGreaterThan(0); // W06
      expect(fields[FIELD.ask]).toBeGreaterThan(fields[FIELD.bid]); // W07
      expect([fields[FIELD.bid], fields[FIELD.ask]]).toContain(fields[FIELD.price]); // W08
      expect(fields[FIELD.tradeQty]).toBeGreaterThanOrEqual(1); // W09
      expect(fields[FIELD.bidQty]).toBeGreaterThanOrEqual(0); // W10
      expect(fields[FIELD.askQty]).toBeGreaterThanOrEqual(0); // W10
    }
  });

  it('W02 W19 writes exactly updatesPerBatch updates', () => {
    const ints = new Int32Array(11 * FIELDS_PER_UPDATE).fill(-1);
    expect(producer.init(7, 5, 10, ints)).toBeNull();
    producer.nextBatch();
    expect(update(ints, 9)[FIELD.price]).toBeGreaterThan(0);
    expect(Array.from(update(ints, 10))).toEqual(Array(FIELDS_PER_UPDATE).fill(-1));
  });

  it('W19 respects the byteOffset of a subarray view', () => {
    const backing = new Int32Array(12 * FIELDS_PER_UPDATE).fill(-1);
    const dst = backing.subarray(FIELDS_PER_UPDATE, 11 * FIELDS_PER_UPDATE); // skips the first update slot
    expect(producer.init(3, 5, 10, dst)).toBeNull();
    producer.nextBatch();
    expect(Array.from(update(backing, 0))).toEqual(Array(FIELDS_PER_UPDATE).fill(-1));
    expect(Array.from(update(backing, 11))).toEqual(Array(FIELDS_PER_UPDATE).fill(-1));
    expect(dst[FIELD.price]).toBeGreaterThan(0);
  });

  it('W01 keeps state between calls', () => {
    const ints = run(7, 5, 100);
    producer.nextBatch();
    const first = Array.from(ints);
    producer.nextBatch();
    expect(Array.from(ints)).not.toEqual(first);
  });

  it('W12 same seed restarts the same sequence', () => {
    const first = run(9, 5, 50);
    producer.nextBatch();
    const second = run(9, 5, 50);
    producer.nextBatch();
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it('W18 a rejected init keeps the previous run and its buffer', () => {
    const ints = run(9, 5, 50);
    expect(producer.init(9, 5, 0, new Int32Array(0))).toEqual(expect.any(String));
    ints.fill(0);
    producer.nextBatch();
    expect(ints[FIELD.price]).toBeGreaterThan(0);
  });
});
