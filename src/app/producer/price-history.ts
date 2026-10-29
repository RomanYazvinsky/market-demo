import { FIELD, FIELDS_PER_UPDATE, PRICE_HISTORY_SECONDS, type PricePoint } from './protocol';

const STORED_FIELDS = [FIELD.price, FIELD.bid, FIELD.ask] as const;

/**
 * One point per second per instrument (the last update of that second) for the last `capacity` seconds,
 * in fixed-size ring buffers like `EventLog`. Seconds without updates have no point.
 */
export class PriceHistory {
  private readonly fields: Int32Array;
  private readonly times: Float64Array;
  private readonly nextSlot: Uint32Array;
  private readonly storedCount: Uint32Array;
  /** The second of each instrument's newest slot, -1 before the first update. */
  private readonly newestSecond: Float64Array;

  constructor(
    instrumentCount: number,
    private readonly capacity = PRICE_HISTORY_SECONDS,
  ) {
    this.fields = new Int32Array(instrumentCount * capacity * STORED_FIELDS.length);
    this.times = new Float64Array(instrumentCount * capacity);
    this.nextSlot = new Uint32Array(instrumentCount);
    this.storedCount = new Uint32Array(instrumentCount);
    this.newestSecond = new Float64Array(instrumentCount).fill(-1);
  }

  /** Records the first `updateCount` updates of `batch`, all stamped with `timeMs`. */
  _add(batch: Int32Array, updateCount: number, timeMs: number): void {
    const second = Math.floor(timeMs / 1000);
    for (let updateIndex = 0; updateIndex < updateCount; updateIndex++) {
      const offset = updateIndex * FIELDS_PER_UPDATE;
      const instrument = batch[offset + FIELD.instrument];
      if (this.newestSecond[instrument] !== second) {
        this.newestSecond[instrument] = second;
        this.nextSlot[instrument] = (this.nextSlot[instrument] + 1) % this.capacity;
        this.storedCount[instrument] = Math.min(this.storedCount[instrument] + 1, this.capacity);
      }
      const slot = instrument * this.capacity + ((this.nextSlot[instrument] + this.capacity - 1) % this.capacity);
      for (let fieldIndex = 0; fieldIndex < STORED_FIELDS.length; fieldIndex++) {
        this.fields[slot * STORED_FIELDS.length + fieldIndex] = batch[offset + STORED_FIELDS[fieldIndex]];
      }
      this.times[slot] = timeMs;
    }
  }

  /** The instrument's points, oldest first. */
  _points(instrument: number): PricePoint[] {
    const count = this.storedCount[instrument];
    const oldest = (this.nextSlot[instrument] - count + this.capacity) % this.capacity;
    return Array.from({ length: count }, (_, position) => {
      const slot = instrument * this.capacity + ((oldest + position) % this.capacity);
      const base = slot * STORED_FIELDS.length;
      return { timeMs: this.times[slot], priceCents: this.fields[base], bidCents: this.fields[base + 1], askCents: this.fields[base + 2] };
    });
  }
}
