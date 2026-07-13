/// <reference lib="webworker" />

import { detectBaselineLayout, BASELINE_LAYOUT_DETECTOR_VERSION } from '../core/import/layoutDetector';
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

  if (message.type !== 'DETECT_LAYOUT') {
    return;
  }

  scope.postMessage({ type: 'JOB_STARTED', jobId: message.jobId, jobType: 'DETECT_LAYOUT' } satisfies ImportWorkerResponse);
  if (cancelledJobs.has(message.jobId)) {
    scope.postMessage({ type: 'JOB_CANCELLED', jobId: message.jobId } satisfies ImportWorkerResponse);
    return;
  }

  try {
    scope.postMessage({ type: 'JOB_PROGRESS', jobId: message.jobId, progress: 0.25, message: 'Scanning staff candidates.' } satisfies ImportWorkerResponse);
    const result = detectBaselineLayout({ pageId: message.pageId, imageData: message.imageData });
    scope.postMessage({
      type: 'JOB_COMPLETED',
      jobId: message.jobId,
      result: {
        type: 'DETECT_LAYOUT',
        pageId: message.pageId,
        regions: result.regions,
        warnings: result.warnings.map((warning) => warning.code),
        detectorVersion: BASELINE_LAYOUT_DETECTOR_VERSION
      }
    } satisfies ImportWorkerResponse);
  } catch (error) {
    scope.postMessage({
      type: 'JOB_FAILED',
      jobId: message.jobId,
      error: { code: 'DETECTION_FAILED', message: error instanceof Error ? error.message : 'Layout detection failed.' }
    } satisfies ImportWorkerResponse);
  }
});

export {};
