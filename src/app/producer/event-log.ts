import { EVENT_LOG_SIZE, FIELD, FIELDS_PER_UPDATE, type TickerEvent } from './protocol';

const STORED_FIELDS = [FIELD.price, FIELD.tradeQty, FIELD.bid, FIELD.ask, FIELD.bidQty, FIELD.askQty] as const;

/**
 * The last `capacity` updates of every instrument, in fixed-size ring buffers, so nothing
 * is allocated per update and the history stays bounded. Sequence numbers count every update of the run.
 */
export class EventLog {
  private readonly fields: Int32Array;
  /** sequence and timeMs per slot */
  private readonly stamps: Float64Array;
  private readonly nextSlot: Uint32Array;
  private readonly storedCount: Uint32Array;
  private sequence = 0;

  constructor(
    instrumentCount: number,
    private readonly capacity = EVENT_LOG_SIZE,
  ) {
    this.fields = new Int32Array(instrumentCount * capacity * STORED_FIELDS.length);
    this.stamps = new Float64Array(instrumentCount * capacity * 2);
    this.nextSlot = new Uint32Array(instrumentCount);
    this.storedCount = new Uint32Array(instrumentCount);
  }

  /** Appends the first `updateCount` updates of `batch`, all stamped with `timeMs`. */
  add(batch: Int32Array, updateCount: number, timeMs: number): void {
    for (let updateIndex = 0; updateIndex < updateCount; updateIndex++) {
      const offset = updateIndex * FIELDS_PER_UPDATE;
      const instrument = batch[offset + FIELD.instrument];
      const slot = instrument * this.capacity + this.nextSlot[instrument];
      for (let fieldIndex = 0; fieldIndex < STORED_FIELDS.length; fieldIndex++) {
        this.fields[slot * STORED_FIELDS.length + fieldIndex] = batch[offset + STORED_FIELDS[fieldIndex]];
      }
      this.stamps[slot * 2] = ++this.sequence;
      this.stamps[slot * 2 + 1] = timeMs;
      this.nextSlot[instrument] = (this.nextSlot[instrument] + 1) % this.capacity;
      this.storedCount[instrument] = Math.min(this.storedCount[instrument] + 1, this.capacity);
    }
  }

  /** The instrument's stored events, oldest first. */
  events(instrument: number): TickerEvent[] {
    const count = this.storedCount[instrument];
    const oldest = (this.nextSlot[instrument] - count + this.capacity) % this.capacity;
    return Array.from({ length: count }, (_, position) => {
      const slot = instrument * this.capacity + ((oldest + position) % this.capacity);
      const base = slot * STORED_FIELDS.length;
      return {
        sequence: this.stamps[slot * 2],
        timeMs: this.stamps[slot * 2 + 1],
        priceCents: this.fields[base],
        quantity: this.fields[base + 1],
        bidCents: this.fields[base + 2],
        askCents: this.fields[base + 3],
        bidQty: this.fields[base + 4],
        askQty: this.fields[base + 5],
      };
    });
  }
}
