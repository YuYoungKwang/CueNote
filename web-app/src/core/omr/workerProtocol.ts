import type {
  OmrDetectionResult,
  OmrExecutionProvider,
  OmrModelInputManifest,
  OmrModelManifest,
  OmrRuntimeReadiness
} from '@cuenote/score-domain';
import type { OmrModelCacheMetadata } from './modelRepository';

export type OmrWorkerRequest =
  | { type: 'LOAD_MODEL'; jobId: string; manifestUrl: string }
  | { type: 'ANALYZE_SYSTEM'; jobId: string; input: OmrModelInputManifest; imageData: ImageData }
  | { type: 'CANCEL_JOB'; jobId: string }
  | { type: 'DISPOSE_MODEL'; jobId: string }
  | { type: 'CLEAR_MODEL_CACHE'; jobId: string };

export type OmrWorkerResponse =
  | { type: 'MODEL_LOADING'; jobId: string; progress: number }
  | {
      type: 'MODEL_READY';
      jobId: string;
      manifest: OmrModelManifest;
      provider: OmrExecutionProvider;
      fallbackReason?: string;
      cacheHit: boolean;
      metadata: OmrModelCacheMetadata;
      readiness: OmrRuntimeReadiness;
    }
  | { type: 'MODEL_FAILED'; jobId: string; error: string }
  | { type: 'PROVIDER_FALLBACK'; jobId: string; provider: OmrExecutionProvider; reason: string }
  | { type: 'JOB_STARTED'; jobId: string; progress: number }
  | { type: 'JOB_PROGRESS'; jobId: string; progress: number }
  | { type: 'JOB_COMPLETED'; jobId: string; result: OmrDetectionResult; runtimeOutputNames: string[] }
  | { type: 'JOB_CANCELLED'; jobId: string }
  | { type: 'JOB_FAILED'; jobId: string; error: string }
  | { type: 'MODEL_CACHE_CLEARED'; jobId: string };
