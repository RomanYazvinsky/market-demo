import { test as base } from 'vitest';
import { loadWasmProducer, type LoaderDeps } from './wasm-loader';

const test = base.extend<{ deps: LoaderDeps }>({
  deps: async ({}, use) =>
    use({ fetch: vi.fn(async () => new Response(null, { status: 404 })), littleEndian: true }),
});

describe('loadWasmProducer', () => {
  test('K21 reports the HTTP status of a failed fetch', async ({ deps }) => {
    await expect(loadWasmProducer('/producer.wasm', deps)).rejects.toThrow('Failed to load /producer.wasm: HTTP 404');
  });

  test('K22 rejects a big-endian platform before fetching', async ({ deps }) => {
    await expect(loadWasmProducer('/producer.wasm', { ...deps, littleEndian: false })).rejects.toThrow(
      'Big-endian platforms are not supported',
    );
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});
