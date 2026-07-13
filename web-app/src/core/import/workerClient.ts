import type { ImportRegion, PageTransform } from '@cuenote/score-domain';
import { createJobId, type ImportWorkerRequest, type ImportWorkerResponse } from './workerProtocol';

export interface PreprocessResult {
  imageData: ImageData;
  warnings: string[];
}

export interface DetectLayoutResult {
  regions: ImportRegion[];
  warnings: string[];
  detectorVersion: string;
}

export interface ImportWorkerClient {
  preprocessPage(pageId: string, imageData: ImageData, transform: PageTransform, signal?: AbortSignal): Promise<PreprocessResult>;
  detectLayout(pageId: string, imageData: ImageData, signal?: AbortSignal): Promise<DetectLayoutResult>;
  dispose(): void;
}

export function createImportWorkerClient(): ImportWorkerClient {
  const imageWorker = new Worker(new URL('../../workers/image.worker.ts', import.meta.url), { type: 'module' });
  const layoutWorker = new Worker(new URL('../../workers/layout.worker.ts', import.meta.url), { type: 'module' });

  return {
    preprocessPage(pageId, imageData, transform, signal) {
      return runWorkerJob<PreprocessResult>(
        imageWorker,
        {
          type: 'PREPROCESS_PAGE',
          jobId: createJobId('preprocess'),
          pageId,
          imageData,
          transform
        },
        signal
      );
    },

    detectLayout(pageId, imageData, signal) {
      return runWorkerJob<DetectLayoutResult>(
        layoutWorker,
        {
          type: 'DETECT_LAYOUT',
          jobId: createJobId('layout'),
          pageId,
          imageData,
          dimensions: { width: imageData.width, height: imageData.height }
        },
        signal
      );
    },

    dispose() {
      imageWorker.terminate();
      layoutWorker.terminate();
    }
  };
}

function runWorkerJob<T>(worker: Worker, request: ImportWorkerRequest, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      worker.postMessage({ type: 'CANCEL_JOB', jobId: request.jobId } satisfies ImportWorkerRequest);
      cleanup();
      reject(new DOMException('Job cancelled', 'AbortError'));
    };

    const onMessage = (event: MessageEvent<ImportWorkerResponse>) => {
      const message = event.data;
      if (message.jobId !== request.jobId) {
        return;
      }
      if (message.type === 'JOB_COMPLETED') {
        cleanup();
        resolve(message.result as T);
      } else if (message.type === 'JOB_CANCELLED') {
        cleanup();
        reject(new DOMException('Job cancelled', 'AbortError'));
      } else if (message.type === 'JOB_FAILED') {
        cleanup();
        reject(new Error(message.error.code));
      }
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    worker.addEventListener('message', onMessage);
    worker.postMessage(request, request.type === 'PREPROCESS_PAGE' || request.type === 'DETECT_LAYOUT' ? [request.imageData.data.buffer] : []);
  });
}
