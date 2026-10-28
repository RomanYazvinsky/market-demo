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

  test('K21 reports a binary that is not valid wasm as a start failure', async ({ deps }) => {
    const notWasm = new Response(new Uint8Array([0, 1, 2]), { headers: { 'content-type': 'application/wasm' } });
    await expect(loadWasmProducer('/producer.wasm', { ...deps, fetch: async () => notWasm })).rejects.toThrow(
      /^Failed to start \/producer\.wasm: /,
    );
  });

  test('K21 reports a module that never registers the producer API', async ({ deps }) => {
    // A valid but empty wasm module; the Go runtime is stubbed so nothing registers `globalThis.producer`.
    const emptyModule = new Response(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]), {
      headers: { 'content-type': 'application/wasm' },
    });
    const run = vi.spyOn(Go.prototype, 'run').mockResolvedValue(undefined);
    await expect(loadWasmProducer('/producer.wasm', { ...deps, fetch: async () => emptyModule })).rejects.toThrow(
      'producer.wasm did not register the producer API',
    );
    expect(run).toHaveBeenCalledTimes(1);
    run.mockRestore();
  });

  test('K22 rejects a big-endian platform before fetching', async ({ deps }) => {
    await expect(loadWasmProducer('/producer.wasm', { ...deps, littleEndian: false })).rejects.toThrow(
      'Big-endian platforms are not supported',
    );
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});
