import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, InjectionToken, PLATFORM_ID, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  DEFAULT_SETTINGS,
  emptyRow,
  type FromWorker,
  type MetricsRow,
  type ProducerSettings,
  type ProducerStatus,
  type ToWorker,
  type WatchedEvents,
} from './protocol';
import { toProducerConfig } from './symbols';
import { rxWorker, type RxWorker } from './worker-channel';

/** Loads the worker lazily. Default: `() => import('./producer.worker?worker').then((workerModule) => new workerModule.default())`. */
export const PRODUCER_WORKER_LOADER = new InjectionToken<() => Promise<Worker>>('PRODUCER_WORKER_LOADER', {
  providedIn: 'root',
  factory: () => () => import('./producer.worker?worker').then((workerModule) => new workerModule.default()),
});

/** One entry of public/resources/sp500.json. */
export interface Instrument {
  symbol: string;
  name: string;
}

/** Loads the instrument list. Default: HttpClient GET environment.symbolsUrl. */
export const INSTRUMENT_SYMBOLS_LOADER = new InjectionToken<() => Promise<readonly Instrument[]>>('INSTRUMENT_SYMBOLS_LOADER', {
  providedIn: 'root',
  factory: () => {
    const http = inject(HttpClient);
    return () => firstValueFrom(http.get<Instrument[]>(environment.symbolsUrl));
  },
});

const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

/** Owns the single producer worker for the whole app; pages only read its signals. */
@Injectable({ providedIn: 'root' })
export class ProducerService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly loadWorker = inject(PRODUCER_WORKER_LOADER);
  private readonly loadSymbols = inject(INSTRUMENT_SYMBOLS_LOADER);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _status = signal<ProducerStatus>('initializing');
  private readonly _error = signal<string | null>(null);
  private readonly _rows = signal<MetricsRow[]>([]);
  private readonly _settings = signal<ProducerSettings>(DEFAULT_SETTINGS);
  private readonly _ready = signal(false);
  private readonly _watched = signal<WatchedEvents | null>(null);
  private readonly _elapsedMs = signal(0);
  private readonly _names = signal<ReadonlyMap<string, string>>(new Map());

  readonly status = this._status.asReadonly();
  readonly error = this._error.asReadonly();
  readonly rows = this._rows.asReadonly();
  readonly settings = this._settings.asReadonly();
  /** true once loaded (idle), a run reported its first status, or loading failed; drives skeletons. */
  readonly ready = this._ready.asReadonly();
  /** Latest events of the symbol passed to watch(); empty until the worker reports them. */
  readonly watched = this._watched.asReadonly();
  /** Generating time of the current run, paused intervals excluded; ticks once a second while running. */
  readonly elapsedMs = this._elapsedMs.asReadonly();
  /** Company name per ticker, empty until the instrument list is loaded. */
  readonly names = this._names.asReadonly();

  private channel?: RxWorker<ToWorker, FromWorker>;
  private symbols?: readonly string[];
  private runId = 0;
  private watchedSymbol: string | null = null;
  private loading?: Promise<void>;
  private destroyed = false;
  /** Run time before the current running interval. */
  private elapsedBeforeMs = 0;
  /** Date.now() when the worker last reported `running`; null while not running. */
  private runningSinceMs: number | null = null;
  private clockTimer?: ReturnType<typeof setInterval>;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      clearInterval(this.clockTimer);
      this.channel?.terminate();
    });
  }

  /** Loads the instrument list and the worker without starting a run. Idempotent; resolves immediately on the server. */
  load(): Promise<void> {
    return (this.loading ??= isPlatformBrowser(this.platformId) ? this.doLoad() : Promise.resolve());
  }

  /** The Start button: the first run, with the current settings. */
  start(): void {
    this.apply(this._settings());
  }

  apply(settings: ProducerSettings): void {
    this.runId++;
    this._settings.set(settings);
    const config = this.symbols ? toProducerConfig(settings, this.symbols) : undefined;
    if (config) this._rows.set(config.symbols.map(emptyRow));
    this.clearWatchedEvents();
    this.stopClock();
    this.elapsedBeforeMs = 0;
    this.tickClock();
    this._status.set('initializing');
    this._error.set(null);
    if (config && this.channel) {
      this.channel.send({ type: 'apply', runId: this.runId, config });
    } else {
      // No live worker: either still loading (load() sends the latest settings once it is up)
      // or a previous load/worker failed, in which case load() retries.
      void this.load();
    }
  }

  /** Selects the symbol whose events snapshots carry (an instrument page), or none. */
  watch(symbol: string | null): void {
    this.watchedSymbol = symbol;
    this.clearWatchedEvents();
    this.channel?.send({ type: 'watch', symbol });
  }

  pause(): void {
    this.channel?.send({ type: 'pause', runId: this.runId });
  }

  resume(): void {
    this.channel?.send({ type: 'resume', runId: this.runId });
  }

  private async doLoad(): Promise<void> {
    const [symbols, worker] = await Promise.allSettled([this.loadSymbols(), this.loadWorker()]);
    if (symbols.status === 'rejected') {
      if (worker.status === 'fulfilled') worker.value.terminate();
      return this.fail(`Failed to load instrument list: ${messageOf(symbols.reason)}`);
    }
    if (worker.status === 'rejected') {
      return this.fail(`Failed to start producer: ${messageOf(worker.reason)}`);
    }
    if (this.destroyed) {
      worker.value.terminate();
      return;
    }

    this.symbols = symbols.value.map((instrument) => instrument.symbol);
    this._names.set(new Map(symbols.value.map((instrument) => [instrument.symbol, instrument.name])));
    const channel = rxWorker<ToWorker, FromWorker>(worker.value);
    channel.messages$
      .pipe(
        filter((message) => message.runId === this.runId),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (message) => this.onMessage(message),
        error: (err: unknown) => {
          // The crashed worker's stream is dead: drop it so the next Apply starts a new one.
          channel.terminate();
          this.channel = undefined;
          this.fail((err instanceof Error && err.message) || 'Producer worker failed');
        },
      });
    this.channel = channel;

    const config = toProducerConfig(this._settings(), this.symbols);
    this._rows.set(config.symbols.map(emptyRow));
    if (this.watchedSymbol !== null) channel.send({ type: 'watch', symbol: this.watchedSymbol });
    if (this.runId > 0) {
      channel.send({ type: 'apply', runId: this.runId, config });
    } else {
      this._status.set('idle');
      this._ready.set(true);
    }
  }

  private onMessage(message: FromWorker): void {
    if (message.type === 'status') {
      this._status.set(message.status);
      this._error.set(message.error ?? null);
      if (message.status === 'running') this.startClock();
      else this.stopClock();
      this._ready.set(true);
    } else {
      this._rows.set(message.rows);
      // A snapshot posted before the worker saw the latest watch belongs to another symbol.
      if (message.watched && message.watched.symbol === this.watchedSymbol) this._watched.set(message.watched);
    }
  }

  private clearWatchedEvents(): void {
    this._watched.set(this.watchedSymbol === null ? null : { symbol: this.watchedSymbol, events: [], seconds: [] });
  }

  private startClock(): void {
    if (this.runningSinceMs !== null) return;
    this.runningSinceMs = Date.now();
    this.clockTimer = setInterval(() => this.tickClock(), 1000);
  }

  private stopClock(): void {
    if (this.runningSinceMs === null) return;
    this.elapsedBeforeMs += Date.now() - this.runningSinceMs;
    this.runningSinceMs = null;
    clearInterval(this.clockTimer);
    this.tickClock();
  }

  private tickClock(): void {
    this._elapsedMs.set(this.elapsedBeforeMs + (this.runningSinceMs === null ? 0 : Date.now() - this.runningSinceMs));
  }

  /** Errors end the skeleton too, so the message is visible. The next Apply retries load(). */
  private fail(message: string): void {
    this.stopClock();
    this.loading = undefined;
    this._status.set('error');
    this._error.set(message);
    this._ready.set(true);
  }
}
