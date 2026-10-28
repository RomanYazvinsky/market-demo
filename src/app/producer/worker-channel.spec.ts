import { test as baseTest } from 'vitest';
import { FakeWorker } from '../../testing/producer-fixtures';
import { rxWorker } from './worker-channel';

const test = baseTest.extend<{ worker: FakeWorker; channel: ReturnType<typeof rxWorker<string, number>> }>({
  worker: async ({}, use) => use(new FakeWorker()),
  channel: async ({ worker }, use) => {
    const channel = rxWorker<string, number>(worker as unknown as Worker);
    await use(channel);
    channel.terminate();
  },
});

describe('rxWorker', () => {
  test('U01 emits worker messages to every subscriber', ({ worker, channel }) => {
    const a: number[] = [];
    const b: number[] = [];
    channel.messages$.subscribe((m) => a.push(m));
    channel.messages$.subscribe((m) => b.push(m));
    worker.emit(1);
    worker.emit(2);
    expect(a).toEqual([1, 2]);
    expect(b).toEqual([1, 2]);
  });

  test('U02 send posts to the worker', ({ worker, channel }) => {
    channel.send('hello');
    expect(worker.sent).toEqual(['hello']);
  });

  test('U03 worker error becomes an error notification', ({ worker, channel }) => {
    const error = vi.fn();
    channel.messages$.subscribe({ error });
    worker.crash('boom');
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
  });

  test('U04 terminate completes the stream, terminates the worker, and is idempotent', ({ worker, channel }) => {
    const complete = vi.fn();
    channel.messages$.subscribe({ complete });
    channel.terminate();
    channel.terminate();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(worker.terminated).toBe(true);
    worker.emit(3); // ignored after terminate
  });

  test('U02 U04 send after terminate is a no-op', ({ worker, channel }) => {
    channel.terminate();
    channel.send('late');
    expect(worker.sent).toEqual([]);
  });
});
