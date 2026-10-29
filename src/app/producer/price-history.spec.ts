import { PriceHistory } from './price-history';
import type { PricePoint } from './protocol';

type UpdateFields = [instrument: number, price: number, quantity: number, bid: number, ask: number, bidQty: number, askQty: number];
const pack = (...updates: UpdateFields[]) => Int32Array.from(updates.flat());

describe('PriceHistory', () => {
  it('K30 keeps one point per second: the last update of that second', () => {
    const history = new PriceHistory(1);
    history._add(pack([0, 10200, 1, 10196, 10200, 1, 1], [0, 10196, 1, 10196, 10200, 1, 1]), 2, 5_200);
    history._add(pack([0, 10205, 1, 10200, 10205, 1, 1]), 1, 5_800);
    history._add(pack([0, 10210, 1, 10205, 10210, 1, 1]), 1, 7_100);
    expect(history._points(0)).toEqual<PricePoint[]>([
      { timeMs: 5_800, priceCents: 10205, bidCents: 10200, askCents: 10205 },
      { timeMs: 7_100, priceCents: 10210, bidCents: 10205, askCents: 10210 },
    ]);
  });

  it('K30 keeps only the last 300 seconds, oldest first', () => {
    const history = new PriceHistory(1);
    for (let second = 0; second < 400; second++) history._add(pack([0, 10000 + second, 1, 9999, 10001 + second, 1, 1]), 1, second * 1000);
    const points = history._points(0);
    expect(points).toHaveLength(300);
    expect(points[0]).toMatchObject({ timeMs: 100_000, priceCents: 10100 });
    expect(points.at(-1)).toMatchObject({ timeMs: 399_000, priceCents: 10399 });
  });

  it('K30 instruments are isolated; only the first updateCount updates are read', () => {
    const history = new PriceHistory(3);
    history._add(pack([1, 500, 1, 499, 500, 1, 1], [2, 600, 1, 599, 600, 1, 1]), 1, 0);
    expect(history._points(1)).toHaveLength(1);
    expect(history._points(0)).toEqual([]);
    expect(history._points(2)).toEqual([]);
  });
});
