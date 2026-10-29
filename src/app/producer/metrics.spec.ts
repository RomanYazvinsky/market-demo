import { test as base } from 'vitest';
import { MetricsStore, imbalance, spreadCents, vwapCents } from './metrics';
import { emptyRow } from './protocol';

/** `store`: a fresh single-instrument store per test. */
const test = base.extend<{ store: MetricsStore }>({
  store: async ({}, use) => use(new MetricsStore(['ALFA'])),
});

type UpdateFields = [instrument: number, price: number, quantity: number, bid: number, ask: number, bidQty: number, askQty: number];
const pack = (...updates: UpdateFields[]) => Int32Array.from(updates.flat());

describe('metric functions', () => {
  it('K02 spread is ask minus bid', () => expect(spreadCents(10196, 10200)).toBe(4));
  it('K04 vwap of the worked example', () => expect(vwapCents(10000n * 10n + 10200n * 30n, 40n)).toBe(10150));
  it('K10 vwap keeps two fractional cent digits', () => expect(vwapCents(1n, 3n)).toBe(0.33));
  it('K06 vwap is null with zero volume', () => expect(vwapCents(0n, 0n)).toBeNull());
  it('K09 vwap exact beyond Number.MAX_SAFE_INTEGER', () => {
    const volume = 2n ** 60n;
    expect(vwapCents(volume * 10150n + 1n, volume)).toBe(10150);
  });
  it('K05 imbalance of the worked example', () => expect(imbalance(600, 400)).toBeCloseTo(0.2, 10));
  it('K05 imbalance bounds', () => {
    expect(imbalance(5, 0)).toBe(1);
    expect(imbalance(0, 5)).toBe(-1);
  });
  it('K06 imbalance is null with empty book', () => expect(imbalance(0, 0)).toBeNull());
});

describe('MetricsStore', () => {
  const example = pack([0, 10000, 10, 9996, 10000, 500, 500], [0, 10200, 30, 10196, 10200, 600, 400]);
  const exampleRow = {
    symbol: 'ALFA', lastPriceCents: 10200, spreadCents: 4, volume: 40n, vwapCents: 10150, imbalance: 0.2,
  };

  test('K07 starts with unavailable values and zero volume', () => {
    expect(new MetricsStore(['ALFA', 'BETA']).snapshot()).toEqual([emptyRow('ALFA'), emptyRow('BETA')]);
  });

  test('K01 K02 K03 K04 K05 computes the worked example', ({ store }) => {
    store.add(example, 2);
    expect(store.snapshot()).toEqual([exampleRow]);
  });

  test('K03 K04 accumulates across batches', ({ store }) => {
    store.add(example.subarray(0, 7), 1);
    store.add(example.subarray(7), 1);
    expect(store.snapshot()).toEqual([exampleRow]);
  });

  test('K08 isolates instruments', () => {
    const store = new MetricsStore(['ALFA', 'BETA']);
    store.add(pack([1, 10200, 30, 10196, 10200, 600, 400]), 1);
    const [alfa, beta] = store.snapshot();
    expect(alfa).toEqual(emptyRow('ALFA'));
    expect(beta).toEqual({ ...exampleRow, symbol: 'BETA', volume: 30n, vwapCents: 10200 });
  });

  test('K03 reads only updateCount updates from a reused buffer', ({ store }) => {
    store.add(example, 1);
    expect(store.snapshot()[0].volume).toBe(10n);
  });

  test('K06 imbalance is null when both book quantities are zero', ({ store }) => {
    store.add(pack([0, 100, 1, 99, 100, 0, 0]), 1);
    expect(store.snapshot()[0].imbalance).toBeNull();
  });

  test('K09 stays exact over a long run', ({ store }) => {
    const big = pack([0, 2_000_000_000, 1000, 1_999_999_999, 2_000_000_000, 1, 1]);
    for (let index = 0; index < 10_000; index++) store.add(big, 1);
    const [row] = store.snapshot();
    expect(row.volume).toBe(10_000_000n);
    expect(row.vwapCents).toBe(2_000_000_000);
  });

  test('K11 snapshot returns copies', ({ store }) => {
    const before = store.snapshot();
    store.add(example, 2);
    expect(before[0]).toEqual(emptyRow('ALFA'));
  });
});
