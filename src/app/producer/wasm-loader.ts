import type { WasmProducer } from './wasm-api';

export interface LoaderDeps {
  fetch: typeof fetch;
  littleEndian: boolean;
}

export function isLittleEndian(): boolean {
  throw new Error('not implemented');
}

export const defaultLoaderDeps: LoaderDeps = {
  get fetch(): typeof fetch {
    throw new Error('not implemented');
  },
  get littleEndian(): boolean {
    throw new Error('not implemented');
  },
};

export function loadWasmProducer(wasmUrl: string, deps: LoaderDeps = defaultLoaderDeps): Promise<WasmProducer> {
  throw new Error('not implemented');
}
