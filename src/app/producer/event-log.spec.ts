import { EventLog } from './event-log';
import { tradeSide, type TickerEvent } from './protocol';

type UpdateFields = [instrument: number, price: number, quantity: number, bid: number, ask: number, bidQty: number, askQty: number];
const pack = (...updates: UpdateFields[]) => Int32Array.from(updates.flat());

describe('EventLog', () => {
  it('K25 keeps only the last 100 events, oldest first', () => {
    const log = new EventLog(1);
    const updates = Array.from({ length: 250 }, (_, index): UpdateFields => [0, 10000 + index, 1, 9999, 10001 + index, 5, 5]);
    log.add(pack(...updates), updates.length, 0);
    const events = log.events(0);
    expect(events).toHaveLength(100);
    expect(events.map((event) => event.sequence)).toEqual(Array.from({ length: 100 }, (_, index) => 151 + index));
    expect(events[0].priceCents).toBe(10150);
  });

  it('K26 events carry a run-wide sequence and the batch time', () => {
    const log = new EventLog(2);
    log.add(pack([1, 10200, 30, 10196, 10200, 600, 400], [0, 500, 1, 499, 500, 1, 1], [1, 10196, 7, 10196, 10200, 593, 400]), 3, 5000);
    expect(log.events(1)).toEqual<TickerEvent[]>([
      { sequence: 1, timeMs: 5000, priceCents: 10200, quantity: 30, bidCents: 10196, askCents: 10200, bidQty: 600, askQty: 400 },
      { sequence: 3, timeMs: 5000, priceCents: 10196, quantity: 7, bidCents: 10196, askCents: 10200, bidQty: 593, askQty: 400 },
    ]);
    log.add(pack([0, 501, 2, 500, 501, 1, 1]), 1, 6000);
    expect(log.events(0).map((event) => [event.sequence, event.timeMs])).toEqual([[2, 5000], [4, 6000]]);
  });

  it('K26 instruments are isolated', () => {
    const log = new EventLog(3);
    log.add(pack([0, 500, 1, 499, 500, 1, 1]), 1, 0);
    expect(log.events(2)).toEqual([]);
  });

  it('K26 reads only the first updateCount updates of the batch', () => {
    const log = new EventLog(1);
    log.add(pack([0, 500, 1, 499, 500, 1, 1], [0, 600, 1, 599, 600, 1, 1]), 1, 0);
    expect(log.events(0)).toHaveLength(1);
  });

  it('K25 tradeSide is buy at the ask and sell at the bid', () => {
    const event: TickerEvent = { sequence: 1, timeMs: 0, priceCents: 10200, quantity: 1, bidCents: 10196, askCents: 10200, bidQty: 1, askQty: 1 };
    expect(tradeSide(event)).toBe('buy');
    expect(tradeSide({ ...event, priceCents: 10196 })).toBe('sell');
  });
});
