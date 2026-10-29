import { type EnvironmentProviders, type Provider, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { test as base } from 'vitest';
import { ProducerService } from '../app/producer/producer.service';
import { DEFAULT_SETTINGS, type MetricsRow, type ProducerStatus, type WatchedEvents } from '../app/producer/protocol';

export function createProducerStub() {
  return {
    status: signal<ProducerStatus>('running'),
    error: signal<string | null>(null),
    rows: signal<MetricsRow[]>([]),
    settings: signal(DEFAULT_SETTINGS),
    ready: signal(true),
    watched: signal<WatchedEvents | null>(null),
    names: signal<ReadonlyMap<string, string>>(new Map()),
    elapsedMs: signal(0),
    load: vi.fn(async () => {}),
    start: vi.fn(),
    retry: vi.fn(),
    apply: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    watch: vi.fn(),
  };
}
export type ProducerStub = ReturnType<typeof createProducerStub>;

/** `producer`: a stub ProducerService; `providers`: ready to pass to ATL `render`. */
export const pageTest = base.extend<{ producer: ProducerStub; providers: Array<Provider | EnvironmentProviders> }>({
  producer: async ({}, use) => use(createProducerStub()),
  providers: async ({ producer }, use) => use([{ provide: ProducerService, useValue: producer }, provideRouter([])]),
});

/** Fake Worker recording sent messages; `emit`/`crash` drive the main-thread side. */
export class FakeWorker {
  sent: unknown[] = [];
  terminated = false;
  private listeners = new Map<string, Set<(event: Event) => void>>();
  addEventListener(type: string, listener: (event: Event) => void) { (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(listener); }
  removeEventListener(type: string, listener: (event: Event) => void) { this.listeners.get(type)?.delete(listener); }
  postMessage(message: unknown) { this.sent.push(message); }
  terminate() { this.terminated = true; }
  emit(data: unknown) { this.listeners.get('message')?.forEach((listener) => listener(new MessageEvent('message', { data }))); }
  crash(message: string) { this.listeners.get('error')?.forEach((listener) => listener(new ErrorEvent('error', { message }))); }
}
