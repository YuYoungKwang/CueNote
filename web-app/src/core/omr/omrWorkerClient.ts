import type { OmrWorkerRequest, OmrWorkerResponse } from './workerProtocol';

export interface OmrWorkerClient {
  post(request: OmrWorkerRequest): void;
  subscribe(listener: (message: OmrWorkerResponse) => void): () => void;
  terminate(): void;
}

export function createOmrWorkerClient(): OmrWorkerClient {
  const worker = new Worker(new URL('../../workers/omr.worker.ts', import.meta.url), { type: 'module' });
  const listeners = new Set<(message: OmrWorkerResponse) => void>();
  worker.addEventListener('message', (event: MessageEvent<OmrWorkerResponse>) => {
    listeners.forEach((listener) => listener(event.data));
  });

  return {
    post(request) {
      worker.postMessage(request);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    terminate() {
      worker.terminate();
      listeners.clear();
    }
  };
}

export function isLatestOmrJob(jobId: string, latestJobId: string | null): boolean {
  return latestJobId === jobId;
}
