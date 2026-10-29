import { EventLog } from './event-log';
import { MetricsStore } from './metrics';
import { PriceHistory } from './price-history';
import { FIELDS_PER_UPDATE, type FromWorker, type ProducerConfig, type ToWorker, type WatchedEvents } from './protocol';
import type { WasmProducer } from './wasm-api';

export interface ProducerControllerDeps {
  wasm: Promise<WasmProducer>;
  post: (message: FromWorker) => void;
  seed: () => number;
  /** environment.uiRefreshMs in the worker entry. */
  refreshMs: number;
}

type State = 'idle' | 'running' | 'paused' | 'error';

/** Worker-side run lifecycle: apply / pause / resume, batch generation and snapshot emission. */
export class ProducerController {
  private runId = 0;
  private state: State = 'idle';
  private config: ProducerConfig | null = null;
  private wasm: WasmProducer | null = null;
  /** The run's only batch buffer, bound to wasm in init and overwritten by every nextBatch(). */
  private ints = new Int32Array(0);
  private store = new MetricsStore([]);
  private log = new EventLog(0);
  private history = new PriceHistory(0);
  /** Symbol shown by an instrument page; its events ride along with every snapshot. */
  private watchedSymbol: string | null = null;
  private batchTimer: ReturnType<typeof setTimeout> | undefined;
  private emitTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: ProducerControllerDeps) {
    deps.wasm.catch(() => {});
  }

  async handle(message: ToWorker): Promise<void> {
    switch (message.type) {
      case 'apply':
        return this.apply(message.runId, message.config);
      case 'pause':
        if (message.runId !== this.runId || this.state !== 'running') return;
        this.stopTimers();
        this.state = 'paused';
        this.emit();
        this.status('paused');
        return;
      case 'resume':
        if (message.runId !== this.runId || this.state !== 'paused') return;
        this.state = 'running';
        this.startTimers();
        this.status('running');
        return;
      case 'watch':
        this.watchedSymbol = message.symbol;
        if (this.state === 'running' || this.state === 'paused') this.emit();
        return;
    }
  }

  dispose(): void {
    this.stopTimers();
  }

  private async apply(runId: number, config: ProducerConfig): Promise<void> {
    this.stopTimers();
    this.runId = runId;
    this.state = 'idle';
    this.status('initializing');

    let wasm: WasmProducer;
    try {
      wasm = await this.deps.wasm;
    } catch (error) {
      if (runId === this.runId) this.fail(errorText(error));
      return;
    }
    if (runId !== this.runId) return;

    const ints = new Int32Array(config.updatesPerBatch * FIELDS_PER_UPDATE);
    const error = wasm.init({ seed: this.deps.seed(), instrumentCount: config.symbols.length, updatesPerBatch: config.updatesPerBatch }, ints);
    if (error !== null) {
      this.fail(error);
      return;
    }

    this.wasm = wasm;
    this.config = config;
    this.ints = ints;
    this.store = new MetricsStore(config.symbols);
    this.log = new EventLog(config.symbols.length);
    this.history = new PriceHistory(config.symbols.length);
    this.state = 'running';
    this.startTimers();
    this.status('running');
  }

  private startTimers(): void {
    this.scheduleBatch();
    this.emitTimer = setInterval(() => this.emit(), this.deps.refreshMs);
  }

  private scheduleBatch(): void {
    this.batchTimer = setTimeout(() => {
      this.wasm!.nextBatch();
      this.store.add(this.ints, this.config!.updatesPerBatch);
      const timeMs = Date.now();
      this.log.add(this.ints, this.config!.updatesPerBatch, timeMs);
      this.history._add(this.ints, this.config!.updatesPerBatch, timeMs);
      this.scheduleBatch();
    }, this.config!.batchIntervalMs);
  }

  private stopTimers(): void {
    clearTimeout(this.batchTimer);
    clearInterval(this.emitTimer);
    this.batchTimer = undefined;
    this.emitTimer = undefined;
  }

  private emit(): void {
    this.deps.post({ type: 'snapshot', runId: this.runId, rows: this.store.snapshot(), watched: this.watchedEvents() });
  }

  private watchedEvents(): WatchedEvents | null {
    if (this.watchedSymbol === null) return null;
    const instrument = this.config!.symbols.indexOf(this.watchedSymbol);
    if (instrument === -1) return { symbol: this.watchedSymbol, events: [], seconds: [] };
    return { symbol: this.watchedSymbol, events: this.log.events(instrument), seconds: this.history._points(instrument) };
  }

  private status(status: 'initializing' | 'running' | 'paused'): void {
    this.deps.post({ type: 'status', runId: this.runId, status });
  }

  private fail(error: string): void {
    this.state = 'error';
    this.deps.post({ type: 'status', runId: this.runId, status: 'error', error });
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
