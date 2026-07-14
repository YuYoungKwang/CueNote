import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  applyOmrCorrections,
  applyImportCorrections,
  createOmrCorrectionId,
  createOmrPreparationManifest,
  normalizeRect,
  type ImportRegion,
  type OmrCorrection,
  type OmrDetection,
  type OmrDetectionResult,
  type OmrModelInputManifest,
  type OmrModelManifest
} from '@cuenote/score-domain';
import { systemRectToPageRect } from '../../core/omr/coordinateMapper';
import { createOmrWorkerClient, isLatestOmrJob } from '../../core/omr/omrWorkerClient';
import type { OmrWorkerResponse } from '../../core/omr/workerProtocol';
import { createImportProjectRepository, type ImportProjectBundle } from '../../core/storage/importProjectRepository';
import { createOmrRepository, type OmrAnalysisJobRecord } from '../../core/storage/omrRepository';

const BUILT_IN_MODEL_OPTIONS = [
  { id: 'TEST_RUNTIME_MODEL', label: 'TEST_RUNTIME_MODEL', url: '/models/omr/test-runtime-manifest.json' },
  { id: 'LAYOUT_SMOKE_MODEL', label: 'LAYOUT_SMOKE_MODEL', url: '/models/omr/layout-smoke-manifest.json' },
  { id: 'SYMBOL_SMOKE_MODEL', label: 'SYMBOL_SMOKE_MODEL', url: '/models/omr/symbol-smoke-manifest.json' }
] as const;

type ModelOption = { id: string; label: string; url: string };

type ModelState =
  | { kind: 'idle' }
  | { kind: 'loading'; progress: number }
  | { kind: 'ready'; manifest: OmrModelManifest; provider: string; cacheHit: boolean; fallbackReason?: string; productState: string }
  | { kind: 'error'; message: string };

type RunState = { kind: 'idle' } | { kind: 'running'; progress: number } | { kind: 'ready'; result: OmrDetectionResult; outputNames: string[] } | { kind: 'error'; message: string };

export function OmrRuntimePage({ mode = 'runtime' }: { mode?: 'runtime' | 'review' | 'draft' }) {
  const { projectId = '' } = useParams();
  const importRepository = useMemo(() => createImportProjectRepository(), []);
  const omrRepository = useMemo(() => createOmrRepository(), []);
  const workerClient = useMemo(() => createOmrWorkerClient(), []);
  const latestJobRef = useRef<string | null>(null);
  const [bundle, setBundle] = useState<ImportProjectBundle | null>(null);
  const [modelState, setModelState] = useState<ModelState>({ kind: 'idle' });
  const [runState, setRunState] = useState<RunState>({ kind: 'idle' });
  const [storedResults, setStoredResults] = useState<OmrDetectionResult[]>([]);
  const [corrections, setCorrections] = useState<OmrCorrection[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([...BUILT_IN_MODEL_OPTIONS]);
  const [selectedModelId, setSelectedModelId] = useState('TEST_RUNTIME_MODEL');
  const [selectedDetectionId, setSelectedDetectionId] = useState<string | null>(null);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0);
  const [classVisibility, setClassVisibility] = useState<Record<string, boolean>>({});
  const [selectedClassId, setSelectedClassId] = useState('');
  const [addMode, setAddMode] = useState(false);
  const [reviewJson, setReviewJson] = useState('');
  const [status, setStatus] = useState('Load a model to verify browser OMR infrastructure.');

  const selectedModel = modelOptions.find((option) => option.id === selectedModelId) ?? modelOptions[0] ?? BUILT_IN_MODEL_OPTIONS[0];
  const activeResult = runState.kind === 'ready' ? runState.result : storedResults.at(-1) ?? null;
  const modelClasses = modelState.kind === 'ready' ? modelState.manifest.classes : [];
  const correctedDetections = useMemo(
    () => (activeResult ? applyOmrCorrections(activeResult.detections, correctionsForResult(corrections, activeResult)) : []),
    [activeResult, corrections]
  );
  const visibleDetections = correctedDetections.filter((detection) => {
    if (detection.reviewDecision === 'REJECTED') {
      return false;
    }
    if (detection.confidence < confidenceThreshold) {
      return false;
    }
    return classVisibility[detection.classId] !== false;
  });
  const selectedDetection = correctedDetections.find((detection) => detection.id === selectedDetectionId) ?? null;

  useEffect(() => {
    void importRepository.loadProject(projectId).then(setBundle);
    void omrRepository.loadResults(projectId).then(setStoredResults);
    void omrRepository.loadCorrections(projectId).then(setCorrections);
    void loadModelCatalog().then(setModelOptions);
  }, [importRepository, omrRepository, projectId]);

  useEffect(() => {
    if (modelClasses.length && !selectedClassId) {
      setSelectedClassId(modelClasses[0]?.id ?? '');
    }
  }, [modelClasses, selectedClassId]);

  useEffect(() => {
    const unsubscribe = workerClient.subscribe((message) => {
      if (!isLatestOmrJob(message.jobId, latestJobRef.current)) {
        return;
      }
      void handleWorkerMessage(message);
    });
    return () => {
      unsubscribe();
      workerClient.terminate();
    };
  }, [workerClient]);

  const handleWorkerMessage = async (message: OmrWorkerResponse) => {
    if (message.type === 'MODEL_LOADING') {
      setModelState({ kind: 'loading', progress: message.progress });
    } else if (message.type === 'PROVIDER_FALLBACK') {
      setStatus(`WebGPU fallback: ${message.reason}`);
    } else if (message.type === 'MODEL_READY') {
      await omrRepository.saveManifest(message.manifest);
      await omrRepository.saveModelMetadata(message.metadata);
      setModelState({
        kind: 'ready',
        manifest: message.manifest,
        provider: message.provider,
        fallbackReason: message.fallbackReason,
        cacheHit: message.cacheHit,
        productState: message.readiness.modelState
      });
      setStatus(
        message.manifest.status === 'PRODUCT'
          ? `${message.manifest.modelId} loaded.`
          : `${message.manifest.modelId} loaded as ${message.manifest.status ?? 'RUNTIME_SMOKE'}. Product OMR model is not installed.`
      );
    } else if (message.type === 'MODEL_FAILED') {
      setModelState({ kind: 'error', message: message.error });
    } else if (message.type === 'JOB_STARTED' || message.type === 'JOB_PROGRESS') {
      setRunState({ kind: 'running', progress: message.progress });
    } else if (message.type === 'JOB_COMPLETED') {
      await omrRepository.saveResult(message.result);
      const nextResults = await omrRepository.loadResults(projectId);
      setStoredResults(nextResults);
      setRunState({ kind: 'ready', result: message.result, outputNames: message.runtimeOutputNames });
      setStatus(`ONNX inference completed with ${message.result.detections.length} detections. Phase 10 MusicXML draft remains deferred.`);
    } else if (message.type === 'JOB_CANCELLED') {
      setRunState({ kind: 'idle' });
      setStatus('OMR runtime job cancelled.');
    } else if (message.type === 'JOB_FAILED') {
      setRunState({ kind: 'error', message: message.error });
    } else if (message.type === 'MODEL_CACHE_CLEARED') {
      setStatus('Model cache cleared.');
    }
  };

  const manifest = bundle?.source
    ? createOmrPreparationManifest({
        project: bundle.project,
        source: bundle.source,
        pages: bundle.pages,
        snapshots: bundle.snapshots,
        corrections: bundle.corrections
      })
    : null;

  const firstPage = manifest?.pages[0] ?? null;
  const systemRegion = firstPage?.effectiveRegions.find((region) => region.type === 'SYSTEM') ?? null;

  const loadModel = () => {
    const jobId = createJobId('load');
    latestJobRef.current = jobId;
    workerClient.post({ type: 'LOAD_MODEL', jobId, manifestUrl: selectedModel.url });
  };

  const runSystem = async () => {
    if (!bundle || !firstPage || !systemRegion || modelState.kind !== 'ready') {
      setStatus('A reviewed system region and loaded test model are required.');
      return;
    }

    const imageData = await imageDataForSystem(firstPage.page.thumbnailDataUrl, systemRegion);
    const inputManifest: OmrModelInputManifest = {
      schemaVersion: 1,
      projectId: bundle.project.id,
      pageId: firstPage.page.id,
      systemId: systemRegion.id,
      image: {
        reference: firstPage.page.rasterStorageKey ?? firstPage.page.id,
        sourceChecksum: bundle.source?.sha256 ?? 'unknown',
        width: imageData.width,
        height: imageData.height,
        channels: modelState.manifest.input.channels,
        colorSpace: modelState.manifest.input.channels === 1 ? 'GRAYSCALE' : 'RGB'
      },
      crop: { pageBounds: systemRegion.rect, paddingRatio: 0.02 },
      preprocessing: {
        rotationDegrees: firstPage.page.transform.rotation,
        deskewDegrees: firstPage.page.transform.deskewDegrees,
        grayscale: modelState.manifest.input.channels === 1,
        thresholdMode: firstPage.page.transform.threshold === null ? 'NONE' : 'GLOBAL',
        inverted: false,
        normalizationVersion: 'phase8-system-crop-v1'
      },
      expectedModelInput: modelState.manifest.input
    };
    const jobId = createJobId('run');
    latestJobRef.current = jobId;
    const job: OmrAnalysisJobRecord = {
      id: jobId,
      projectId: bundle.project.id,
      pageId: firstPage.page.id,
      systemId: systemRegion.id,
      status: 'RUNNING',
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await omrRepository.saveJob(job);
    await omrRepository.savePreferences({
      projectId: bundle.project.id,
      modelManifestUrl: selectedModel.url,
      selectedResultId: undefined,
      confidenceFilter: 'ALL',
      updatedAt: Date.now()
    });
    workerClient.post({ type: 'ANALYZE_SYSTEM', jobId, input: inputManifest, imageData });
  };

  const cancelJob = () => {
    if (latestJobRef.current) {
      workerClient.post({ type: 'CANCEL_JOB', jobId: latestJobRef.current });
    }
  };

  const saveReviewCorrection = async (correction: OmrCorrection) => {
    await omrRepository.saveCorrection(correction);
    const next = await omrRepository.loadCorrections(projectId);
    setCorrections(next);
    await persistReviewSnapshot(projectId, createReviewExport(projectId, activeResult, next));
    setStatus('Review correction saved to IndexedDB. OPFS snapshot is updated when available.');
  };

  const rejectSelectedDetection = async () => {
    if (!selectedDetection) {
      return;
    }
    await saveReviewCorrection({
      id: createOmrCorrectionId(projectId, selectedDetection.id),
      projectId,
      pageId: selectedDetection.pageId,
      detectionId: selectedDetection.id,
      createdAt: Date.now(),
      operation: { type: 'REJECT' }
    });
  };

  const changeSelectedClass = async () => {
    if (!selectedDetection || !selectedClassId) {
      return;
    }
    await saveReviewCorrection({
      id: createOmrCorrectionId(projectId, selectedDetection.id),
      projectId,
      pageId: selectedDetection.pageId,
      detectionId: selectedDetection.id,
      createdAt: Date.now(),
      operation: { type: 'CHANGE_CLASS', classId: selectedClassId, className: selectedClassId }
    });
  };

  const handleOverlayClick = async (event: MouseEvent<HTMLDivElement>) => {
    if (!addMode || !activeResult || !systemRegion || !selectedClassId) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const pageX = (event.clientX - rect.left) / rect.width;
    const pageY = (event.clientY - rect.top) / rect.height;
    const system = systemRegion.rect;
    if (pageX < system.x || pageY < system.y || pageX > system.x + system.width || pageY > system.y + system.height) {
      return;
    }
    const boundsInSystem = normalizeRect({
      x: (pageX - system.x) / system.width - 0.015,
      y: (pageY - system.y) / system.height - 0.015,
      width: 0.03,
      height: 0.03
    });
    const detection: OmrDetection = {
      id: `${projectId}:omr-user-detection:${Date.now()}`,
      classId: selectedClassId,
      className: selectedClassId,
      confidence: 1,
      systemId: activeResult.systemId,
      pageId: activeResult.pageId,
      boundsInSystem,
      boundsInPage: systemRectToPageRect(boundsInSystem, systemRegion.rect),
      source: 'USER',
      reviewDecision: 'CORRECTED',
      modelVersion: activeResult.modelVersion,
      attributes: { userAdded: true }
    };
    await saveReviewCorrection({
      id: createOmrCorrectionId(projectId, detection.id),
      projectId,
      pageId: detection.pageId,
      detectionId: detection.id,
      createdAt: Date.now(),
      operation: { type: 'ADD', detection }
    });
    setSelectedDetectionId(detection.id);
    setAddMode(false);
  };

  const exportReviewJson = () => {
    setReviewJson(JSON.stringify(createReviewExport(projectId, activeResult, correctionsForResult(corrections, activeResult)), null, 2));
  };

  const importReviewJson = async () => {
    const parsed = JSON.parse(reviewJson) as { corrections?: OmrCorrection[] };
    for (const correction of parsed.corrections ?? []) {
      await omrRepository.saveCorrection(correction);
    }
    const next = await omrRepository.loadCorrections(projectId);
    setCorrections(next);
    await persistReviewSnapshot(projectId, createReviewExport(projectId, activeResult, next));
    setStatus('Review JSON imported into the correction layer.');
  };

  if (mode === 'draft') {
    return (
      <main className="panel state-panel" data-testid="omr-draft-deferred">
        <h2>OMR MusicXML draft is Phase 10</h2>
        <p>Phase 8 verifies runtime infrastructure only. Structure assembly, MusicXML draft generation, and Phase 6 editor handoff are deferred to Phase 10.</p>
        <Link className="secondary-link" to={`/imports/${projectId}/omr`}>
          Back to OMR runtime
        </Link>
      </main>
    );
  }

  return (
    <main className="import-review-layout" data-testid="omr-runtime-page">
      <section className="panel import-review-main">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Phase 8</p>
            <h2>Browser OMR runtime infrastructure</h2>
            <p className="muted" data-testid="omr-runtime-status">
              {status}
            </p>
          </div>
          <div className="playback-button-row">
            <Link className="secondary-link" to={`/imports/${projectId}/review`}>
              Layout review
            </Link>
            <Link className="secondary-link" to={`/imports/${projectId}/omr/draft`}>
              Draft status
            </Link>
          </div>
        </div>

        <div className="viewer-summary">
          <div>
            <span className="summary-label">Runtime model</span>
            <strong data-testid="omr-model-kind">{selectedModel.id}</strong>
          </div>
          <div>
            <span className="summary-label">Model status</span>
            <strong data-testid="omr-model-status">{modelState.kind === 'ready' ? modelState.manifest.status ?? 'RUNTIME_SMOKE' : 'not loaded'}</strong>
          </div>
          <div>
            <span className="summary-label">Product model</span>
            <strong data-testid="omr-product-state">{modelState.kind === 'ready' ? modelState.productState : 'PRODUCT_MODEL_NOT_INSTALLED'}</strong>
          </div>
          <div>
            <span className="summary-label">Provider</span>
            <strong data-testid="omr-provider">{modelState.kind === 'ready' ? modelState.provider : 'not loaded'}</strong>
          </div>
          <div>
            <span className="summary-label">Cache</span>
            <strong data-testid="omr-cache-state">{modelState.kind === 'ready' ? (modelState.cacheHit ? 'hit' : 'downloaded') : 'unknown'}</strong>
          </div>
        </div>

        <div className="import-toolbar">
          <label className="field-label" htmlFor="omr-model-select">
            Model
          </label>
          <select
            id="omr-model-select"
            className="select-input"
            value={selectedModelId}
            onChange={(event) => {
              setSelectedModelId(event.target.value);
              setModelState({ kind: 'idle' });
              setRunState({ kind: 'idle' });
            }}
            data-testid="omr-model-select"
          >
            {modelOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <button type="button" className="primary-link" onClick={loadModel} data-testid="omr-load-model">
            Load model
          </button>
          <button type="button" className="primary-link" onClick={() => void runSystem()} disabled={modelState.kind !== 'ready' || !systemRegion} data-testid="omr-run-system">
            Run system crop
          </button>
          <button type="button" className="control-button" onClick={cancelJob} data-testid="omr-cancel-job">
            Cancel
          </button>
        </div>

        {modelState.kind === 'loading' ? <p data-testid="omr-model-loading">Loading {Math.round(modelState.progress * 100)}%</p> : null}
        {modelState.kind === 'error' ? <p data-testid="omr-model-error">{modelState.message}</p> : null}
        {modelState.kind === 'ready' && modelState.fallbackReason ? <p data-testid="omr-fallback-reason">Fallback reason: {modelState.fallbackReason}</p> : null}
        {runState.kind === 'running' ? <p data-testid="omr-job-progress">Running {Math.round(runState.progress * 100)}%</p> : null}
        {runState.kind === 'error' ? <p data-testid="omr-job-error">{runState.message}</p> : null}
        {runState.kind === 'ready' ? (
          <div data-testid="omr-runtime-result">
            Runtime output: {runState.outputNames.join(', ') || 'none'}; detections: {runState.result.detections.length}
          </div>
        ) : null}

        <div className="omr-review-toolbar" data-testid="omr-review-toolbar">
          <label className="field">
            <span>Confidence threshold</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={confidenceThreshold}
              onChange={(event) => setConfidenceThreshold(Number(event.target.value))}
              data-testid="omr-confidence-threshold"
            />
            <strong data-testid="omr-confidence-threshold-value">{confidenceThreshold.toFixed(2)}</strong>
          </label>
          <div className="omr-class-toggles" data-testid="omr-class-toggles">
            {modelClasses.map((klass) => (
              <label key={klass.id}>
                <input
                  type="checkbox"
                  checked={classVisibility[klass.id] !== false}
                  onChange={(event) => setClassVisibility((current) => ({ ...current, [klass.id]: event.target.checked }))}
                  data-testid={`omr-class-toggle-${testIdPart(klass.id)}`}
                />
                <span>{klass.id}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="import-page-stage" data-testid="omr-detection-overlay">
          {firstPage?.page.thumbnailDataUrl ? <img src={firstPage.page.thumbnailDataUrl} alt="" className="import-page-image" /> : <div className="import-page-placeholder">No reviewed page</div>}
          <div className={`import-region-overlay ${addMode ? 'is-adding' : ''}`} onClick={(event) => void handleOverlayClick(event)} data-testid="omr-overlay-hit-area">
            {systemRegion ? <div className="import-region import-region--system is-selected" style={regionStyle(systemRegion)}>SYSTEM crop</div> : null}
            {visibleDetections.map((detection) => (
              <button
                key={detection.id}
                type="button"
                className={`import-region import-region--omr-detection ${selectedDetectionId === detection.id ? 'is-selected' : ''}`}
                style={rectStyle(detection.boundsInPage)}
                data-testid="omr-detection-box"
                title={`${detection.classId} ${Math.round(detection.confidence * 100)}%`}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedDetectionId(detection.id);
                }}
              >
                {detection.classId}
              </button>
            ))}
          </div>
        </div>
      </section>

      <aside className="panel import-review-sidebar">
        <p className="eyebrow">Review foundation</p>
        <p data-testid="omr-review-foundation">Detection overlay and correction persistence are ready, but product detections require Phase 9 models.</p>
        <p className="eyebrow">Stored runtime results</p>
        <ul className="measure-list" data-testid="omr-result-list">
          {storedResults.length === 0 ? <li>No runtime result stored.</li> : null}
          {storedResults.map((result) => (
            <li key={result.id}>
              {result.modelId} {result.modelVersion} / {result.executionProvider} / {result.detections.length} detections
            </li>
          ))}
        </ul>
        <p className="eyebrow">Current detections</p>
        <ul className="measure-list omr-detection-review-list" data-testid="omr-detection-list">
          {visibleDetections.length === 0 ? <li>No visible detections.</li> : null}
          {visibleDetections.map((detection) => (
            <li key={detection.id}>
              <button
                type="button"
                className={`measure-item ${selectedDetectionId === detection.id ? 'is-active' : ''}`}
                onClick={() => setSelectedDetectionId(detection.id)}
                data-testid="omr-detection-list-item"
              >
                <span className="measure-item__number">{detection.classId}</span>
                <span className="measure-item__meta">
                  {Math.round(detection.confidence * 100)}% / {detection.source} / {detection.reviewDecision}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="omr-review-editor" data-testid="omr-review-editor">
          <p className="eyebrow">Correction layer</p>
          <p data-testid="omr-selected-detection">{selectedDetection ? selectedDetection.classId : 'No detection selected'}</p>
          <label className="field">
            <span>Symbol class</span>
            <select value={selectedClassId} onChange={(event) => setSelectedClassId(event.target.value)} data-testid="omr-symbol-class-select">
              {modelClasses.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.id}
                </option>
              ))}
            </select>
          </label>
          <div className="playback-button-row">
            <button type="button" className="control-button" onClick={() => void changeSelectedClass()} disabled={!selectedDetection} data-testid="omr-change-class">
              Change class
            </button>
            <button type="button" className="control-button" onClick={() => void rejectSelectedDetection()} disabled={!selectedDetection} data-testid="omr-delete-detection">
              Delete
            </button>
            <button type="button" className={`control-button ${addMode ? 'is-active' : ''}`} onClick={() => setAddMode((current) => !current)} data-testid="omr-add-detection-mode">
              Add
            </button>
          </div>
          <div className="playback-button-row">
            <button type="button" className="secondary-link" onClick={exportReviewJson} data-testid="omr-export-review-json">
              Export JSON
            </button>
            <button type="button" className="secondary-link" onClick={() => void importReviewJson()} data-testid="omr-import-review-json">
              Import JSON
            </button>
          </div>
          <textarea
            className="omr-review-json"
            value={reviewJson}
            onChange={(event) => setReviewJson(event.target.value)}
            data-testid="omr-review-json"
          />
          <p data-testid="omr-correction-count">{correctionsForResult(corrections, activeResult).length} corrections saved</p>
        </div>
        <p className="eyebrow">Phase 10</p>
        <p>Structure assembly and MusicXML draft handoff are deferred.</p>
      </aside>
    </main>
  );
}

async function imageDataForSystem(thumbnailDataUrl: string | undefined, region: ImportRegion): Promise<ImageData> {
  if (!thumbnailDataUrl) {
    return new ImageData(64, 64);
  }
  const image = await loadImage(thumbnailDataUrl);
  const canvas = document.createElement('canvas');
  const width = Math.max(1, Math.round(region.rect.width * image.naturalWidth));
  const height = Math.max(1, Math.round(region.rect.height * image.naturalHeight));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('TENSOR_BUILD_FAILED');
  }
  context.drawImage(
    image,
    region.rect.x * image.naturalWidth,
    region.rect.y * image.naturalHeight,
    width,
    height,
    0,
    0,
    width,
    height
  );
  return context.getImageData(0, 0, width, height);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'));
    image.src = src;
  });
}

function regionStyle(region: ImportRegion) {
  return rectStyle(region.rect);
}

function rectStyle(rect: { x: number; y: number; width: number; height: number }) {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`
  };
}

function createJobId(prefix: string): string {
  return `omr-${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function correctionsForResult(corrections: OmrCorrection[], result: OmrDetectionResult | null): OmrCorrection[] {
  if (!result) {
    return [];
  }
  const detectionIds = new Set(result.detections.map((detection) => detection.id));
  return corrections.filter((correction) => {
    if (correction.pageId !== result.pageId) {
      return false;
    }
    if (correction.operation.type === 'ADD') {
      return correction.operation.detection.systemId === result.systemId;
    }
    return detectionIds.has(correction.detectionId);
  });
}

function createReviewExport(projectId: string, result: OmrDetectionResult | null, corrections: OmrCorrection[]) {
  return {
    schemaVersion: 1,
    kind: 'CUENOTE_OMR_REVIEW',
    projectId,
    result: result
      ? {
          id: result.id,
          pageId: result.pageId,
          systemId: result.systemId,
          modelId: result.modelId,
          modelVersion: result.modelVersion,
          detectionCount: result.detections.length
        }
      : null,
    corrections,
    exportedAt: new Date().toISOString()
  };
}

async function persistReviewSnapshot(projectId: string, payload: unknown): Promise<void> {
  const storageManager = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };
  if (!storageManager.getDirectory) {
    return;
  }
  try {
    const root = await storageManager.getDirectory();
    const file = await root.getFileHandle(`cuenote-omr-review-${projectId}.json`, { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
  } catch (error) {
    console.debug('OPFS review snapshot skipped; IndexedDB correction persistence remains active.', error);
  }
}

function testIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

async function loadModelCatalog(): Promise<ModelOption[]> {
  try {
    const response = await fetch('/models/omr/model-catalog.json', { cache: 'no-cache' });
    if (!response.ok) {
      return [...BUILT_IN_MODEL_OPTIONS];
    }
    const value = (await response.json()) as { models?: ModelOption[] };
    const models = value.models?.filter((model) => model.id && model.label && model.url) ?? [];
    return models.length ? models : [...BUILT_IN_MODEL_OPTIONS];
  } catch {
    return [...BUILT_IN_MODEL_OPTIONS];
  }
}
