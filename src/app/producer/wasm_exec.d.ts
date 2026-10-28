import type { WasmProducer } from './wasm-api';

declare global {
  class Go {
    importObject: WebAssembly.Imports;
    run(instance: WebAssembly.Instance): Promise<void>;
  }
  // eslint-disable-next-line no-var
  var producer: WasmProducer | undefined;
}
