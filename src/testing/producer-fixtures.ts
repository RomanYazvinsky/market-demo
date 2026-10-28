import { signal } from '@angular/core';
import { test as base } from 'vitest';
import { ProducerService } from '../app/producer/producer.service';
import { DEFAULT_SETTINGS, type MetricsRow, type ProducerStatus } from '../app/producer/protocol';

export function createProducerStub() {
  return {
    status: signal<ProducerStatus>('running'),
    error: signal<string | null>(null),
    rows: signal<MetricsRow[]>([]),
    settings: signal(DEFAULT_SETTINGS),
    started: signal(true),
    start: vi.fn(async () => {}),
    apply: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  };
}
export type ProducerStub = ReturnType<typeof createProducerStub>;

/** `producer`: a stub ProducerService; `providers`: ready to pass to ATL `render`. */
export const pageTest = base.extend<{ producer: ProducerStub; providers: unknown[] }>({
  producer: async ({}, use) => use(createProducerStub()),
  providers: async ({ producer }, use) => use([{ provide: ProducerService, useValue: producer }]),
});

/** Fake Worker recording sent messages; `emit`/`crash` drive the main-thread side. */
export class FakeWorker {
  sent: unknown[] = [];
  terminated = false;
  private listeners = new Map<string, Set<(e: Event) => void>>();
  addEventListener(type: string, fn: (e: Event) => void) { (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(fn); }
  removeEventListener(type: string, fn: (e: Event) => void) { this.listeners.get(type)?.delete(fn); }
  postMessage(m: unknown) { this.sent.push(m); }
  terminate() { this.terminated = true; }
  emit(data: unknown) { this.listeners.get('message')?.forEach((fn) => fn(new MessageEvent('message', { data }))); }
  crash(message: string) { this.listeners.get('error')?.forEach((fn) => fn(new ErrorEvent('error', { message }))); }
}
