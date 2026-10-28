import type { FromWorker, ToWorker } from './protocol';
import type { WasmProducer } from './wasm-api';

export interface ProducerControllerDeps {
  wasm: Promise<WasmProducer>;
  post: (message: FromWorker) => void;
  seed: () => number;
  /** environment.uiRefreshMs in the worker entry. */
  refreshMs: number;
}

export class ProducerController {
  constructor(private readonly deps: ProducerControllerDeps) {}

  handle(message: ToWorker): Promise<void> {
    throw new Error('not implemented');
  }

  dispose(): void {
    throw new Error('not implemented');
  }
}
