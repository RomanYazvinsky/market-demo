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

/** Loads the instrument list. Default: HttpClient GET environment.symbolsUrl. */
export const INSTRUMENT_SYMBOLS_LOADER = new InjectionToken<() => Promise<readonly string[]>>('INSTRUMENT_SYMBOLS_LOADER', {
  providedIn: 'root',
  factory: () => {
    const http = inject(HttpClient);
    return () => firstValueFrom(http.get<string[]>(environment.symbolsUrl));
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
  private readonly _started = signal(false);
  private readonly _watched = signal<WatchedEvents | null>(null);

  readonly status = this._status.asReadonly();
  readonly error = this._error.asReadonly();
  readonly rows = this._rows.asReadonly();
  readonly settings = this._settings.asReadonly();
  /** true once the first status from the current run arrived (drives skeletons). */
  readonly started = this._started.asReadonly();
  /** Latest events of the symbol passed to watch(); empty until the worker reports them. */
  readonly watched = this._watched.asReadonly();

  private channel?: RxWorker<ToWorker, FromWorker>;
  private symbols?: readonly string[];
  private runId = 1;
  private watchedSymbol: string | null = null;
  private starting?: Promise<void>;
  private destroyed = false;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.channel?.terminate();
    });
  }

  /** Idempotent; resolves immediately on the server. */
  start(): Promise<void> {
    return (this.starting ??= isPlatformBrowser(this.platformId) ? this.doStart() : Promise.resolve());
  }

  apply(settings: ProducerSettings): void {
    this.runId++;
    this._settings.set(settings);
    const config = this.symbols ? toProducerConfig(settings, this.symbols) : undefined;
    if (config) this._rows.set(config.symbols.map(emptyRow));
    this.clearWatchedEvents();
    this._status.set('initializing');
    this._error.set(null);
    if (config && this.channel) {
      this.channel.send({ type: 'apply', runId: this.runId, config });
    } else {
      // No live worker: either still starting (start() sends the latest settings once it is up)
      // or a previous start/worker failed, in which case start() retries.
      void this.start();
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

  private async doStart(): Promise<void> {
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

    this.symbols = symbols.value;
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
    channel.send({ type: 'apply', runId: this.runId, config });
  }

  private onMessage(message: FromWorker): void {
    if (message.type === 'status') {
      this._status.set(message.status);
      this._error.set(message.error ?? null);
      this._started.set(true);
    } else {
      this._rows.set(message.rows);
      // A snapshot posted before the worker saw the latest watch belongs to another symbol.
      if (message.watched && message.watched.symbol === this.watchedSymbol) this._watched.set(message.watched);
    }
  }

  private clearWatchedEvents(): void {
    this._watched.set(this.watchedSymbol === null ? null : { symbol: this.watchedSymbol, events: [] });
  }

  /** Errors end the skeleton too, so the message is visible. The next Apply retries start(). */
  private fail(message: string): void {
    this.starting = undefined;
    this._status.set('error');
    this._error.set(message);
    this._started.set(true);
  }
}
