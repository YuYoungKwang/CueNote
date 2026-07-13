export type ImportProjectId = string;
export type ImportPageId = string;
export type ImportSourceId = string;
export type ImportRegionId = string;
export type ImportJobId = string;

export type ImportSourceType = 'PDF' | 'IMAGE' | 'CAMERA';
export type ImportProjectStatus = 'WAITING' | 'PROCESSING' | 'NEEDS_REVIEW' | 'REVIEW_COMPLETE' | 'FAILED';
export type ImportPageStatus = 'WAITING' | 'PROCESSING' | 'NEEDS_REVIEW' | 'REVIEW_COMPLETE' | 'FAILED';
export type ImportRegionType = 'SYSTEM' | 'STAFF' | 'MEASURE';
export type ImportCorrectionOperationType = 'ADD' | 'UPDATE' | 'DELETE' | 'SPLIT' | 'MERGE' | 'REORDER' | 'RESET';
export type ImportInteractionMode = 'PAN' | 'SELECT' | 'ADD_SYSTEM' | 'ADD_STAFF' | 'ADD_MEASURE' | 'SPLIT' | 'MERGE' | 'DELETE';
export type ImportStorageBackend = 'OPFS' | 'INDEXEDDB_BLOB';

export type ImportErrorCode =
  | 'UNSUPPORTED_FILE_TYPE'
  | 'FILE_TOO_LARGE'
  | 'TOO_MANY_PAGES'
  | 'IMAGE_TOO_LARGE'
  | 'EMPTY_FILE'
  | 'CORRUPTED_IMAGE'
  | 'CORRUPTED_PDF'
  | 'PASSWORD_PROTECTED_PDF'
  | 'PDF_WORKER_FAILED'
  | 'IMAGE_DECODE_FAILED'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'OPFS_UNAVAILABLE'
  | 'PREPROCESSING_FAILED'
  | 'DETECTION_FAILED'
  | 'JOB_CANCELLED'
  | 'INVALID_REGION'
  | 'REVIEW_INCOMPLETE';

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageDimensions {
  width: number;
  height: number;
}

export interface PageTransform {
  rotation: 0 | 90 | 180 | 270;
  crop: NormalizedRect;
  perspectiveCorners: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint];
  deskewDegrees: number;
  brightness: number;
  contrast: number;
  threshold: number | null;
}

export interface ImportSource {
  id: ImportSourceId;
  projectId: ImportProjectId;
  type: ImportSourceType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageBackend: ImportStorageBackend;
  storageKey: string;
  createdAt: number;
}

export interface ImportProject {
  id: ImportProjectId;
  title: string;
  sourceId: ImportSourceId;
  sourceType: ImportSourceType;
  status: ImportProjectStatus;
  pageCount: number;
  currentPageId: ImportPageId | null;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  lastError?: ImportError;
}

export interface ImportPage {
  id: ImportPageId;
  projectId: ImportProjectId;
  sourceId: ImportSourceId;
  pageIndex: number;
  originalDimensions: PageDimensions;
  rasterDimensions: PageDimensions;
  rasterStorageKey: string | null;
  thumbnailDataUrl?: string;
  status: ImportPageStatus;
  transform: PageTransform;
  warnings: ImportWarning[];
  updatedAt: number;
}

export interface ImportWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  regionId?: ImportRegionId;
}

export interface ImportError {
  code: ImportErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface ImportRegion {
  id: ImportRegionId;
  type: ImportRegionType;
  pageId: ImportPageId;
  parentId: ImportRegionId | null;
  rect: NormalizedRect;
  orderIndex: number;
  confidence: number;
  source: 'DETECTED' | 'USER';
}

export interface ImportDetectionSnapshot {
  id: string;
  projectId: ImportProjectId;
  pageId: ImportPageId;
  detectorVersion: string;
  createdAt: number;
  regions: ImportRegion[];
  warnings: ImportWarning[];
  preprocessing: PageTransform;
}

export interface ImportCorrection {
  id: string;
  projectId: ImportProjectId;
  pageId: ImportPageId;
  createdAt: number;
  operation: ImportCorrectionOperation;
}

export type ImportCorrectionOperation =
  | { type: 'ADD'; region: ImportRegion }
  | { type: 'UPDATE'; regionId: ImportRegionId; patch: Partial<Pick<ImportRegion, 'rect' | 'parentId' | 'orderIndex'>> }
  | { type: 'DELETE'; regionId: ImportRegionId }
  | { type: 'SPLIT'; regionId: ImportRegionId; axis: 'horizontal' | 'vertical'; ratio: number; firstId: ImportRegionId; secondId: ImportRegionId }
  | { type: 'MERGE'; regionIds: ImportRegionId[]; mergedId: ImportRegionId }
  | { type: 'REORDER'; orderedRegionIds: ImportRegionId[] }
  | { type: 'RESET' };

export interface ImportPreferences {
  projectId: ImportProjectId;
  currentPageId: ImportPageId | null;
  zoom: number;
  pan: NormalizedPoint;
  interactionMode: ImportInteractionMode;
  updatedAt: number;
}

export interface OmrPreparationManifest {
  schemaVersion: 1;
  project: ImportProject;
  source: Omit<ImportSource, 'storageKey'> & { storageKeyRef: string };
  pages: Array<{
    page: ImportPage;
    detectionSnapshot: ImportDetectionSnapshot | null;
    effectiveRegions: ImportRegion[];
    corrections: ImportCorrection[];
    reviewComplete: boolean;
  }>;
}

export interface ImportValidationIssue {
  code: ImportErrorCode | 'REGION_OUT_OF_BOUNDS' | 'PARENT_NOT_FOUND' | 'INVALID_ORDER' | 'EMPTY_DETECTION';
  message: string;
  severity: 'warning' | 'error';
  pageId?: ImportPageId;
  regionId?: ImportRegionId;
  blocking: boolean;
}

export const DEFAULT_PAGE_TRANSFORM: PageTransform = {
  rotation: 0,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  perspectiveCorners: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 }
  ],
  deskewDegrees: 0,
  brightness: 1,
  contrast: 1,
  threshold: null
};
