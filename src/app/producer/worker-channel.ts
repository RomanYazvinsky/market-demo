import { Observable } from 'rxjs';

export interface RxWorker<In, Out> {
  /** Hot, shared stream of worker messages. Errors on worker `error`/`messageerror`; completes on terminate. */
  readonly messages$: Observable<Out>;
  send(message: In): void;
  /** Terminates the worker and completes `messages$`. Idempotent. */
  terminate(): void;
}

export function rxWorker<In, Out>(worker: Worker): RxWorker<In, Out> {
  void worker;
  throw new Error('not implemented');
}
