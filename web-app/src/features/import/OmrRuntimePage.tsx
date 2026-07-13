import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  applyImportCorrections,
  createOmrPreparationManifest,
  type ImportRegion,
  type OmrDetectionResult,
  type OmrModelInputManifest,
  type OmrModelManifest
} from '@cuenote/score-domain';
import { createOmrWorkerClient, isLatestOmrJob } from '../../core/omr/omrWorkerClient';
import type { OmrWorkerResponse } from '../../core/omr/workerProtocol';
import { createImportProjectRepository, type ImportProjectBundle } from '../../core/storage/importProjectRepository';
import { createOmrRepository, type OmrAnalysisJobRecord } from '../../core/storage/omrRepository';

const MODEL_OPTIONS = [
  { id: 'TEST_RUNTIME_MODEL', label: 'TEST_RUNTIME_MODEL', url: '/models/omr/test-runtime-manifest.json' },
  { id: 'LAYOUT_SMOKE_MODEL', label: 'LAYOUT_SMOKE_MODEL', url: '/models/omr/layout-smoke-manifest.json' },
  { id: 'SYMBOL_SMOKE_MODEL', label: 'SYMBOL_SMOKE_MODEL', url: '/models/omr/symbol-smoke-manifest.json' }
] as const;

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
  const [selectedModelId, setSelectedModelId] = useState<(typeof MODEL_OPTIONS)[number]['id']>('TEST_RUNTIME_MODEL');
  const [status, setStatus] = useState('Load a model to verify browser OMR infrastructure.');

  const selectedModel = MODEL_OPTIONS.find((option) => option.id === selectedModelId) ?? MODEL_OPTIONS[0];

  useEffect(() => {
    void importRepository.loadProject(projectId).then(setBundle);
    void omrRepository.loadResults(projectId).then(setStoredResults);
  }, [importRepository, omrRepository, projectId]);

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
              setSelectedModelId(event.target.value as (typeof MODEL_OPTIONS)[number]['id']);
              setModelState({ kind: 'idle' });
              setRunState({ kind: 'idle' });
            }}
            data-testid="omr-model-select"
          >
            {MODEL_OPTIONS.map((option) => (
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

        <div className="import-page-stage" data-testid="omr-detection-overlay">
          {firstPage?.page.thumbnailDataUrl ? <img src={firstPage.page.thumbnailDataUrl} alt="" className="import-page-image" /> : <div className="import-page-placeholder">No reviewed page</div>}
          <div className="import-region-overlay">
            {systemRegion ? <div className="import-region import-region--system is-selected" style={regionStyle(systemRegion)}>SYSTEM crop</div> : null}
            {runState.kind === 'ready'
              ? runState.result.detections.map((detection) => (
                  <div
                    key={detection.id}
                    className="import-region import-region--omr-detection"
                    style={rectStyle(detection.boundsInPage)}
                    data-testid="omr-detection-box"
                    title={`${detection.classId} ${Math.round(detection.confidence * 100)}%`}
                  >
                    {detection.classId}
                  </div>
                ))
              : null}
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
        <ul className="measure-list" data-testid="omr-detection-list">
          {runState.kind !== 'ready' || runState.result.detections.length === 0 ? <li>No detections from the current run.</li> : null}
          {runState.kind === 'ready'
            ? runState.result.detections.map((detection) => (
                <li key={detection.id}>
                  {detection.classId} {Math.round(detection.confidence * 100)}%
                </li>
              ))
            : null}
        </ul>
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
