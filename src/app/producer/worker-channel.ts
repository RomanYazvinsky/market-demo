import { Observable, Subject } from 'rxjs';

export interface RxWorker<In, Out> {
  /** Hot, shared stream of worker messages. Errors on worker `error`/`messageerror`; completes on terminate. */
  readonly messages$: Observable<Out>;
  send(message: In): void;
  /** Terminates the worker and completes `messages$`. Idempotent. */
  terminate(): void;
}

export function rxWorker<In, Out>(worker: Worker): RxWorker<In, Out> {
  const subject = new Subject<Out>();
  let closed = false;

  const onMessage = (event: MessageEvent<Out>) => subject.next(event.data);
  const onError = (event: ErrorEvent) => subject.error(new Error(event.message || 'Worker error'));
  const onMessageError = () => subject.error(new Error('Worker message could not be deserialized'));

  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onError);
  worker.addEventListener('messageerror', onMessageError);

  return {
    messages$: subject.asObservable(),
    send(message: In) {
      if (!closed) worker.postMessage(message);
    },
    terminate() {
      if (closed) return;
      closed = true;
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
      worker.terminate();
      subject.complete();
    },
  };
}
