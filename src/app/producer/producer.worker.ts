import { ProducerController } from './producer-controller';
import type { FromWorker, ToWorker } from './protocol';
import { loadWasmProducer } from './wasm-loader';
import { environment } from '../../environments/environment';

const scope = self as unknown as {
  postMessage(message: FromWorker): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ToWorker>) => void): void;
};

const controller = new ProducerController({
  wasm: loadWasmProducer(environment.wasmUrl),
  refreshMs: environment.uiRefreshMs,
  post: (message) => scope.postMessage(message),
  seed: () => crypto.getRandomValues(new Uint32Array(1))[0],
});

scope.addEventListener('message', (event) => void controller.handle(event.data));
