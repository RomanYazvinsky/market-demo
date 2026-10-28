import './wasm_exec.js';
import type { WasmProducer } from './wasm-api';

export interface LoaderDeps {
  fetch: typeof fetch;
  littleEndian: boolean;
}

/** The batch wire format is little-endian int32 read through an Int32Array; see the memory model in wasm-api.ts. */
export function isLittleEndian(): boolean {
  return new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
}

export const defaultLoaderDeps: LoaderDeps = {
  fetch: (input, init) => globalThis.fetch(input, init),
  littleEndian: isLittleEndian(),
};

/** Fetches, instantiates and starts the Go module, resolving with the API it registers on globalThis. */
export async function loadWasmProducer(wasmUrl: string, deps: LoaderDeps = defaultLoaderDeps): Promise<WasmProducer> {
  if (!deps.littleEndian) throw new Error('Big-endian platforms are not supported');

  const response = await deps.fetch(wasmUrl);
  if (!response.ok) throw new Error(`Failed to load ${wasmUrl}: HTTP ${response.status}`);

  const go = new Go();
  let instance: WebAssembly.Instance;
  try {
    ({ instance } = await WebAssembly.instantiateStreaming(Promise.resolve(response), go.importObject));
  } catch (cause) {
    throw new Error(`Failed to start ${wasmUrl}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  void go.run(instance);
  await Promise.resolve();

  const producer = globalThis.producer;
  if (!producer) throw new Error('producer.wasm did not register the producer API');
  return producer;
}
