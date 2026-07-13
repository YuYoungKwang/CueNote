import type { ImportError, ImportJobId, ImportRegion, PageTransform } from '@cuenote/score-domain';

export type WorkerJobType = 'PREPROCESS_PAGE' | 'DETECT_LAYOUT';

export type ImportWorkerRequest =
  | {
      type: 'PREPROCESS_PAGE';
      jobId: ImportJobId;
      pageId: string;
      imageData: ImageData;
      transform: PageTransform;
    }
  | {
      type: 'DETECT_LAYOUT';
      jobId: ImportJobId;
      pageId: string;
      imageData: ImageData;
      dimensions: { width: number; height: number };
    }
  | {
      type: 'CANCEL_JOB';
      jobId: ImportJobId;
    }
  | {
      type: 'DISPOSE_PAGE';
      pageId: string;
    };

export type ImportWorkerResponse =
  | {
      type: 'JOB_STARTED';
      jobId: ImportJobId;
      jobType: WorkerJobType;
    }
  | {
      type: 'JOB_PROGRESS';
      jobId: ImportJobId;
      progress: number;
      message: string;
    }
  | {
      type: 'JOB_COMPLETED';
      jobId: ImportJobId;
      result:
        | { type: 'PREPROCESS_PAGE'; pageId: string; imageData: ImageData; warnings: string[] }
        | { type: 'DETECT_LAYOUT'; pageId: string; regions: ImportRegion[]; warnings: string[]; detectorVersion: string };
    }
  | {
      type: 'JOB_CANCELLED';
      jobId: ImportJobId;
    }
  | {
      type: 'JOB_FAILED';
      jobId: ImportJobId;
      error: ImportError;
    };

export function createJobId(prefix = 'job'): ImportJobId {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
