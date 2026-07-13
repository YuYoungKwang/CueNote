/// <reference lib="webworker" />

import { preprocessImageData } from '../core/import/imagePreprocessing';
import type { ImportWorkerRequest, ImportWorkerResponse } from '../core/import/workerProtocol';

const scope = self as DedicatedWorkerGlobalScope;
const cancelledJobs = new Set<string>();

scope.addEventListener('message', (event: MessageEvent<ImportWorkerRequest>) => {
  const message = event.data;
  if (message.type === 'CANCEL_JOB') {
    cancelledJobs.add(message.jobId);
    scope.postMessage({ type: 'JOB_CANCELLED', jobId: message.jobId } satisfies ImportWorkerResponse);
    return;
  }

  if (message.type === 'DISPOSE_PAGE') {
    return;
  }

  if (message.type !== 'PREPROCESS_PAGE') {
    return;
  }

  scope.postMessage({ type: 'JOB_STARTED', jobId: message.jobId, jobType: 'PREPROCESS_PAGE' } satisfies ImportWorkerResponse);
  if (cancelledJobs.has(message.jobId)) {
    scope.postMessage({ type: 'JOB_CANCELLED', jobId: message.jobId } satisfies ImportWorkerResponse);
    return;
  }

  try {
    scope.postMessage({ type: 'JOB_PROGRESS', jobId: message.jobId, progress: 0.4, message: 'Applying page corrections.' } satisfies ImportWorkerResponse);
    const imageData = preprocessImageData(message.imageData, message.transform);
    scope.postMessage(
      {
        type: 'JOB_COMPLETED',
        jobId: message.jobId,
        result: {
          type: 'PREPROCESS_PAGE',
          pageId: message.pageId,
          imageData,
          warnings: []
        }
      } satisfies ImportWorkerResponse,
      [imageData.data.buffer]
    );
  } catch (error) {
    scope.postMessage({
      type: 'JOB_FAILED',
      jobId: message.jobId,
      error: { code: 'PREPROCESSING_FAILED', message: error instanceof Error ? error.message : 'Preprocessing failed.' }
    } satisfies ImportWorkerResponse);
  }
});

export {};
