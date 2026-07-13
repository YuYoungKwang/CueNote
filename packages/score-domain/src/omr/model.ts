import type { ImportPageId, ImportProjectId, ImportRegionId, NormalizedRect } from '../import/model';

export type OmrExecutionProvider = 'WEBGPU' | 'WASM';
export type OmrModelTask = 'LAYOUT_DETECTION' | 'SYMBOL_DETECTION' | 'RUNTIME_SMOKE';
export type OmrModelStatus = 'EXPERIMENTAL' | 'CANDIDATE' | 'PRODUCT';
export type OmrTensorLayout = 'NCHW' | 'NHWC';
export type OmrResizeMode = 'LETTERBOX' | 'STRETCH';
export type OmrValueRange = 'ZERO_TO_ONE' | 'MINUS_ONE_TO_ONE' | 'ZERO_TO_255';
export type OmrReviewDecision = 'UNREVIEWED' | 'ACCEPTED' | 'CORRECTED' | 'REJECTED';
export type OmrDetectionSource = 'BASELINE' | 'MODEL' | 'USER' | 'CORRECTED' | 'FIXTURE';
export type OmrProductModelState = 'PRODUCT_MODEL_NOT_INSTALLED' | 'PRODUCT_MODEL_READY';

export type OmrErrorCode =
  | 'MODEL_MANIFEST_INVALID'
  | 'MODEL_VERSION_UNSUPPORTED'
  | 'MODEL_DOWNLOAD_FAILED'
  | 'MODEL_HASH_MISMATCH'
  | 'MODEL_CACHE_FAILED'
  | 'MODEL_SESSION_FAILED'
  | 'WEBGPU_UNAVAILABLE'
  | 'WEBGPU_OPERATOR_UNSUPPORTED'
  | 'WEBGPU_DEVICE_LOST'
  | 'WASM_INITIALIZATION_FAILED'
  | 'INFERENCE_FAILED'
  | 'INVALID_MODEL_OUTPUT'
  | 'INVALID_CLASS_INDEX'
  | 'INVALID_COORDINATES'
  | 'TENSOR_BUILD_FAILED'
  | 'POSTPROCESSING_FAILED'
  | 'STRUCTURE_ASSEMBLY_FAILED'
  | 'UNKNOWN_PITCH'
  | 'UNKNOWN_DURATION'
  | 'REVIEW_INCOMPLETE'
  | 'JOB_CANCELLED';

export interface OmrModelClass {
  id: string;
  index: number;
  label?: string;
  blockingReview?: boolean;
}

export interface OmrModelOutput {
  name: string;
  format: 'BOX_XYWH_CONF_CLASS' | 'YOLO_V8_RAW' | 'RUNTIME_SMOKE_VECTOR';
  coordinateSpace: 'SYSTEM_NORMALIZED' | 'TENSOR_NORMALIZED';
  shape: number[];
}

export interface OmrModelManifest {
  schemaVersion: 1;
  modelId: string;
  version: string;
  task: OmrModelTask;
  status?: OmrModelStatus;
  file: string;
  sha256: string;
  sizeBytes: number;
  input: {
    width: number;
    height: number;
    channels: 1 | 3;
    tensorLayout: OmrTensorLayout;
    resizeMode: OmrResizeMode;
    valueRange: OmrValueRange;
  };
  outputs?: OmrModelOutput[];
  executionProviders: OmrExecutionProvider[];
  classes: OmrModelClass[];
  postprocessing: {
    confidenceThreshold: number;
    nmsThreshold: number;
    autoAcceptThreshold?: number;
    lowConfidenceThreshold?: number;
  };
  datasetVersion?: string;
  taxonomyVersion?: string;
  evaluationReport?: string;
  minimumAppVersion: string;
  createdAt?: string;
  fixtureDetector?: boolean;
}

export interface OmrModelInputManifest {
  schemaVersion: 1;
  projectId: ImportProjectId;
  pageId: ImportPageId;
  systemId: ImportRegionId;
  image: {
    reference: string;
    sourceChecksum: string;
    width: number;
    height: number;
    channels: 1 | 3;
    colorSpace: 'GRAYSCALE' | 'RGB';
  };
  crop: {
    pageBounds: NormalizedRect;
    paddingRatio: number;
  };
  preprocessing: {
    rotationDegrees: number;
    deskewDegrees: number;
    grayscale: boolean;
    thresholdMode: 'NONE' | 'GLOBAL' | 'ADAPTIVE';
    inverted: boolean;
    normalizationVersion: string;
  };
  expectedModelInput: OmrModelManifest['input'];
}

export interface OmrInferenceWarning {
  code: OmrErrorCode | string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  detectionId?: string;
  systemId?: ImportRegionId;
}

export interface OmrDetection {
  id: string;
  classId: string;
  className: string;
  confidence: number;
  systemId: ImportRegionId;
  pageId: ImportPageId;
  boundsInSystem: NormalizedRect;
  boundsInPage: NormalizedRect;
  source: OmrDetectionSource;
  reviewDecision: OmrReviewDecision;
  staffId?: ImportRegionId;
  measureId?: ImportRegionId;
  modelVersion?: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface OmrDetectionResult {
  id: string;
  projectId: ImportProjectId;
  pageId: ImportPageId;
  systemId: ImportRegionId;
  modelId: string;
  modelVersion: string;
  executionProvider: OmrExecutionProvider;
  inputManifestVersion: number;
  inferenceTimeMs: number;
  detections: OmrDetection[];
  warnings: OmrInferenceWarning[];
  createdAt: number;
}

export type OmrSymbolDetection = OmrDetection;

export interface OmrCorrection {
  id: string;
  projectId: ImportProjectId;
  pageId: ImportPageId;
  detectionId: string;
  createdAt: number;
  operation:
    | { type: 'ACCEPT' }
    | { type: 'REJECT' }
    | { type: 'CHANGE_CLASS'; classId: string; className: string }
    | { type: 'MOVE_RESIZE'; boundsInSystem: NormalizedRect; boundsInPage: NormalizedRect }
    | { type: 'ADD'; detection: OmrDetection };
}

export interface OmrSystemAnalysis {
  projectId: ImportProjectId;
  pageId: ImportPageId;
  systemId: ImportRegionId;
  result: OmrDetectionResult;
  corrections: OmrCorrection[];
}

export interface OmrPageAnalysis {
  projectId: ImportProjectId;
  pageId: ImportPageId;
  systems: OmrSystemAnalysis[];
}

export interface OmrProjectAnalysis {
  projectId: ImportProjectId;
  pages: OmrPageAnalysis[];
}

export interface OmrRuntimeReadiness {
  id: string;
  projectId: ImportProjectId;
  modelState: OmrProductModelState;
  testRuntimeModelExecuted: boolean;
  lastProvider?: OmrExecutionProvider;
  warnings: OmrInferenceWarning[];
  createdAt: number;
  updatedAt: number;
}
