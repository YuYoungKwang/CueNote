import type { NormalizedRect, OmrCorrection, OmrDetectionResult, OmrModelManifest } from '@cuenote/score-domain';
import type { OmrModelCacheMetadata } from '../omr/modelRepository';
import {
  createCueNoteDbAdapter,
  OMR_ANALYSIS_JOBS_STORE,
  OMR_DETECTION_CORRECTIONS_STORE,
  OMR_DETECTION_RESULTS_STORE,
  OMR_EVALUATION_REPORTS_STORE,
  OMR_MODEL_CACHE_METADATA_STORE,
  OMR_MODEL_MANIFESTS_STORE,
  OMR_PREFERENCES_STORE,
  OMR_SYSTEM_CROPS_STORE
} from './cuenoteDb';
import type { IndexedDbAdapter } from './indexedDbAdapter';

export interface OmrAnalysisJobRecord {
  id: string;
  projectId: string;
  pageId?: string;
  systemId?: string;
  status: 'WAITING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OmrPreferenceRecord {
  projectId: string;
  modelManifestUrl: string;
  selectedResultId?: string;
  confidenceFilter: 'ALL' | 'LOW_CONFIDENCE' | 'REVIEW_REQUIRED';
  updatedAt: number;
}

export type OmrKnownFailureTag =
  | 'missed-notehead'
  | 'false-symbol'
  | 'wrong-class'
  | 'lyric-interference'
  | 'chord-symbol-interference'
  | 'low-contrast'
  | 'crop-stitch-duplicate'
  | 'missing-staff-context';

export interface OmrManualEvaluationReport {
  id: string;
  projectId: string;
  fixture: {
    id: string;
    title: string;
  } | null;
  modelId: string;
  modelVersion: string;
  detectionCount: number;
  classCounts: Record<string, number>;
  averageConfidence: number;
  correctionCount: number;
  deletedCount: number;
  modifiedCount: number;
  addedCount: number;
  reviewerNote: string;
  knownFailureTags: OmrKnownFailureTag[];
  createdAt: number;
  updatedAt: number;
}

export interface OmrSystemCropRecord {
  id: string;
  projectId: string;
  pageId: string;
  rect: NormalizedRect;
  orderIndex: number;
  source: 'DETECTED' | 'USER';
  createdAt: number;
  updatedAt: number;
}

export interface OmrRepository {
  saveManifest(manifest: OmrModelManifest): Promise<void>;
  loadManifest(modelId: string, version: string): Promise<OmrModelManifest | undefined>;
  saveModelMetadata(metadata: OmrModelCacheMetadata): Promise<void>;
  loadModelMetadata(modelId: string, version: string): Promise<OmrModelCacheMetadata | undefined>;
  saveJob(job: OmrAnalysisJobRecord): Promise<void>;
  loadJobs(projectId: string): Promise<OmrAnalysisJobRecord[]>;
  saveResult(result: OmrDetectionResult): Promise<void>;
  loadResults(projectId: string): Promise<OmrDetectionResult[]>;
  saveCorrection(correction: OmrCorrection): Promise<void>;
  loadCorrections(projectId: string): Promise<OmrCorrection[]>;
  saveEvaluationReport(report: OmrManualEvaluationReport): Promise<void>;
  loadEvaluationReports(projectId: string): Promise<OmrManualEvaluationReport[]>;
  saveSystemCrops(projectId: string, pageId: string, crops: OmrSystemCropRecord[]): Promise<void>;
  loadSystemCrops(projectId: string, pageId: string): Promise<OmrSystemCropRecord[]>;
  savePreferences(preferences: OmrPreferenceRecord): Promise<void>;
  loadPreferences(projectId: string): Promise<OmrPreferenceRecord | undefined>;
}

export function createOmrRepository(adapter: IndexedDbAdapter = createCueNoteDbAdapter()): OmrRepository {
  return {
    saveManifest(manifest) {
      return adapter.set(OMR_MODEL_MANIFESTS_STORE, manifestKey(manifest.modelId, manifest.version), manifest);
    },
    loadManifest(modelId, version) {
      return adapter.get<OmrModelManifest>(OMR_MODEL_MANIFESTS_STORE, manifestKey(modelId, version));
    },
    saveModelMetadata(metadata) {
      return adapter.set(OMR_MODEL_CACHE_METADATA_STORE, manifestKey(metadata.modelId, metadata.version), metadata);
    },
    loadModelMetadata(modelId, version) {
      return adapter.get<OmrModelCacheMetadata>(OMR_MODEL_CACHE_METADATA_STORE, manifestKey(modelId, version));
    },
    saveJob(job) {
      return adapter.set(OMR_ANALYSIS_JOBS_STORE, job.id, job);
    },
    async loadJobs(projectId) {
      return (await adapter.getAll<OmrAnalysisJobRecord>(OMR_ANALYSIS_JOBS_STORE)).filter((job) => job.projectId === projectId);
    },
    saveResult(result) {
      return adapter.set(OMR_DETECTION_RESULTS_STORE, result.id, result);
    },
    async loadResults(projectId) {
      return (await adapter.getAll<OmrDetectionResult>(OMR_DETECTION_RESULTS_STORE)).filter((result) => result.projectId === projectId);
    },
    saveCorrection(correction) {
      return adapter.set(OMR_DETECTION_CORRECTIONS_STORE, correction.id, correction);
    },
    async loadCorrections(projectId) {
      return (await adapter.getAll<OmrCorrection>(OMR_DETECTION_CORRECTIONS_STORE)).filter((correction) => correction.projectId === projectId);
    },
    saveEvaluationReport(report) {
      return adapter.set(OMR_EVALUATION_REPORTS_STORE, report.id, report);
    },
    async loadEvaluationReports(projectId) {
      return (await adapter.getAll<OmrManualEvaluationReport>(OMR_EVALUATION_REPORTS_STORE))
        .filter((report) => report.projectId === projectId)
        .sort((left, right) => left.createdAt - right.createdAt);
    },
    async saveSystemCrops(projectId, pageId, crops) {
      const existing = (await adapter.getAll<OmrSystemCropRecord>(OMR_SYSTEM_CROPS_STORE)).filter((crop) => crop.projectId === projectId && crop.pageId === pageId);
      await Promise.all(existing.map((crop) => adapter.delete(OMR_SYSTEM_CROPS_STORE, crop.id)));
      await Promise.all(crops.map((crop) => adapter.set(OMR_SYSTEM_CROPS_STORE, crop.id, crop)));
    },
    async loadSystemCrops(projectId, pageId) {
      return (await adapter.getAll<OmrSystemCropRecord>(OMR_SYSTEM_CROPS_STORE))
        .filter((crop) => crop.projectId === projectId && crop.pageId === pageId)
        .sort((left, right) => left.orderIndex - right.orderIndex);
    },
    savePreferences(preferences) {
      return adapter.set(OMR_PREFERENCES_STORE, preferences.projectId, preferences);
    },
    loadPreferences(projectId) {
      return adapter.get<OmrPreferenceRecord>(OMR_PREFERENCES_STORE, projectId);
    }
  };
}

function manifestKey(modelId: string, version: string): string {
  return `${modelId}:${version}`;
}
