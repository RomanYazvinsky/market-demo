import { ProducerController } from './producer-controller';
import type { FromWorker, ToWorker } from './protocol';
import { loadWasmProducer } from './wasm-loader';
import { environment } from '../../environments/environment';

const scope = self as unknown as {
  postMessage(message: FromWorker): void;
  addEventListener(type: 'message', listener: (e: MessageEvent<ToWorker>) => void): void;
};

const controller = new ProducerController({
  wasm: loadWasmProducer(environment.wasmUrl),
  refreshMs: environment.uiRefreshMs,
  post: (m) => scope.postMessage(m),
  seed: () => crypto.getRandomValues(new Uint32Array(1))[0],
});

scope.addEventListener('message', (e) => void controller.handle(e.data));
