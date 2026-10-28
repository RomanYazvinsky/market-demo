import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { DEFAULT_SETTINGS, type MetricsRow, type ProducerSettings, type ProducerStatus } from './protocol';

/** Loads the worker lazily. Default: `() => import('./producer.worker?worker').then((m) => new m.default())`. */
export const PRODUCER_WORKER_LOADER = new InjectionToken<() => Promise<Worker>>('PRODUCER_WORKER_LOADER', {
  providedIn: 'root',
  factory: () => () => import('./producer.worker?worker').then((m) => new m.default()),
});

/** Loads the instrument list. Default: HttpClient GET environment.symbolsUrl. */
export const INSTRUMENT_SYMBOLS_LOADER = new InjectionToken<() => Promise<readonly string[]>>('INSTRUMENT_SYMBOLS_LOADER', {
  providedIn: 'root',
  factory: () => {
    const http = inject(HttpClient);
    return () => firstValueFrom(http.get<string[]>(environment.symbolsUrl));
  },
});

@Injectable({ providedIn: 'root' })
export class ProducerService {
  private readonly _status = signal<ProducerStatus>('initializing');
  private readonly _error = signal<string | null>(null);
  private readonly _rows = signal<MetricsRow[]>([]);
  private readonly _settings = signal<ProducerSettings>(DEFAULT_SETTINGS);
  private readonly _started = signal(false);

  readonly status = this._status.asReadonly();
  readonly error = this._error.asReadonly();
  readonly rows = this._rows.asReadonly();
  readonly settings = this._settings.asReadonly();
  /** true once the first status from the current run arrived (drives skeletons). */
  readonly started = this._started.asReadonly();

  async start(): Promise<void> {}

  apply(settings: ProducerSettings): void {
    void settings;
    throw new Error('not implemented');
  }

  pause(): void {
    throw new Error('not implemented');
  }

  resume(): void {
    throw new Error('not implemented');
  }
}
