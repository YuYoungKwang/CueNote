/// <reference lib="webworker" />

import type { OmrDetection, OmrInferenceWarning, OmrModelManifest } from '@cuenote/score-domain';
import { fetchOmrModelManifest } from '../core/omr/modelManifest';
import { createOmrModelRepository, type OmrModelCacheMetadata } from '../core/omr/modelRepository';
import { createOnnxRuntimeAdapter, type LoadedOmrModel, type RawOmrOutput } from '../core/omr/onnxRuntimeAdapter';
import { createOmrDetectionResult, createOmrDetectionResultFromDetections, decodeOmrDetections } from '../core/omr/postprocessing';
import { buildOmrTensorFromImageData } from '../core/omr/tensorBuilder';
import { createImageTiles, mergeTileDetections, resolveTilePolicy, stitchTileDetections } from '../core/omr/tileInference';
import type { OmrWorkerRequest, OmrWorkerResponse } from '../core/omr/workerProtocol';

const scope = self as DedicatedWorkerGlobalScope;
const repository = createOmrModelRepository();
const runtime = createOnnxRuntimeAdapter();
const cancelledJobs = new Set<string>();

let loadedManifest: OmrModelManifest | null = null;
let loadedMetadata: OmrModelCacheMetadata | null = null;
let loadedModel: LoadedOmrModel | null = null;
let loadedManifestUrl: string | null = null;

scope.addEventListener('message', (event: MessageEvent<OmrWorkerRequest>) => {
  void handleRequest(event.data);
});

async function handleRequest(request: OmrWorkerRequest) {
  if (request.type === 'CANCEL_JOB') {
    cancelledJobs.add(request.jobId);
    post({ type: 'JOB_CANCELLED', jobId: request.jobId });
    return;
  }

  try {
    if (request.type === 'LOAD_MODEL') {
      await loadModel(request.jobId, request.manifestUrl);
    } else if (request.type === 'ANALYZE_SYSTEM') {
      await analyzeSystem(request);
    } else if (request.type === 'DISPOSE_MODEL') {
      await loadedModel?.dispose();
      loadedModel = null;
      loadedManifest = null;
      loadedMetadata = null;
    } else if (request.type === 'CLEAR_MODEL_CACHE') {
      if (loadedManifest) {
        await repository.clearModel(loadedManifest);
      }
      post({ type: 'MODEL_CACHE_CLEARED', jobId: request.jobId });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OMR worker request failed.';
    post(request.type === 'LOAD_MODEL' ? { type: 'MODEL_FAILED', jobId: request.jobId, error: message } : { type: 'JOB_FAILED', jobId: request.jobId, error: message });
  }
}

async function loadModel(jobId: string, manifestUrl: string) {
  cancelledJobs.delete(jobId);
  post({ type: 'MODEL_LOADING', jobId, progress: 0.1 });
  const parsed = await fetchOmrModelManifest(manifestUrl);
  if (isCancelled(jobId)) return;

  const { bytes, cacheHit, metadata } = await repository.getModelBytes(parsed.manifest, manifestUrl);
  loadedMetadata = metadata;
  post({ type: 'MODEL_LOADING', jobId, progress: cacheHit ? 0.55 : 0.45 });
  if (isCancelled(jobId)) return;

  await loadedModel?.dispose();
  const { model, fallbackReason } = await runtime.loadModel(parsed.manifest, bytes);
  if (fallbackReason) {
    post({ type: 'PROVIDER_FALLBACK', jobId, provider: 'WASM', reason: fallbackReason });
  }
  loadedModel = model;
  loadedManifest = parsed.manifest;
  loadedManifestUrl = manifestUrl;

  post({
    type: 'MODEL_READY',
    jobId,
    manifest: parsed.manifest,
    provider: model.provider,
    fallbackReason,
    cacheHit,
    metadata,
    readiness: {
      id: `${parsed.manifest.modelId}:${parsed.manifest.version}`,
      projectId: 'runtime',
      modelState: parsed.manifest.status === 'PRODUCT' ? 'PRODUCT_MODEL_READY' : 'PRODUCT_MODEL_NOT_INSTALLED',
      testRuntimeModelExecuted: false,
      lastProvider: model.provider,
      warnings: parsed.manifest.status === 'PRODUCT'
        ? []
        : [{ code: 'PRODUCT_MODEL_NOT_INSTALLED', message: `${parsed.manifest.modelId} is not a PRODUCT OMR model.`, severity: 'warning' }],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  });
}

async function analyzeSystem(request: Extract<OmrWorkerRequest, { type: 'ANALYZE_SYSTEM' }>) {
  cancelledJobs.delete(request.jobId);
  if (!loadedModel || !loadedManifest) {
    throw new Error('MODEL_SESSION_FAILED');
  }
  post({ type: 'JOB_STARTED', jobId: request.jobId, progress: 0.05 });
  const tilePolicy = resolveTilePolicy(loadedManifest);
  if (tilePolicy) {
    await analyzeSystemWithTiles(request, tilePolicy);
    return;
  }
  const tensor = buildOmrTensorFromImageData(request.imageData, loadedManifest.input);
  post({ type: 'JOB_PROGRESS', jobId: request.jobId, progress: 0.45 });
  if (isCancelled(request.jobId)) return;

  const raw = await runtime.run(loadedModel, tensor);
  post({ type: 'JOB_PROGRESS', jobId: request.jobId, progress: 0.85 });
  if (isCancelled(request.jobId)) return;

  const result = createOmrDetectionResult(request.input.projectId, request.input, loadedManifest, raw, tensor);
  loadedMetadata = loadedMetadata ?? {
    id: `${loadedManifest.modelId}:${loadedManifest.version}`,
    modelId: loadedManifest.modelId,
    version: loadedManifest.version,
    sha256: loadedManifest.sha256,
    sizeBytes: loadedManifest.sizeBytes,
    cachedAt: Date.now(),
    verifiedAt: Date.now(),
    sourceUrl: loadedManifestUrl ?? loadedManifest.file,
    status: 'VERIFIED'
  };
  post({ type: 'JOB_COMPLETED', jobId: request.jobId, result, runtimeOutputNames: loadedModel.outputNames });
}

async function analyzeSystemWithTiles(request: Extract<OmrWorkerRequest, { type: 'ANALYZE_SYSTEM' }>, tilePolicy: NonNullable<ReturnType<typeof resolveTilePolicy>>) {
  if (!loadedModel || !loadedManifest) {
    throw new Error('MODEL_SESSION_FAILED');
  }
  const tiles = createImageTiles(request.imageData, tilePolicy);
  const stitchedDetections: OmrDetection[] = [];
  const warnings: OmrInferenceWarning[] = [];
  let inferenceTimeMs = 0;
  let lastRaw: RawOmrOutput | null = null;

  for (const tile of tiles) {
    if (isCancelled(request.jobId)) return;
    const tensor = buildOmrTensorFromImageData(tile.imageData, loadedManifest.input);
    const raw = await runtime.run(loadedModel, tensor);
    lastRaw = raw;
    inferenceTimeMs += raw.inferenceTimeMs;
    const tileWarnings: OmrInferenceWarning[] = [];
    const tileDetections = decodeOmrDetections(request.input, loadedManifest, raw, tensor, tileWarnings);
    warnings.push(...tileWarnings);
    stitchedDetections.push(...stitchTileDetections(tileDetections, tile, request.input.crop.pageBounds, loadedManifest.postprocessing.nmsThreshold));
    post({ type: 'JOB_PROGRESS', jobId: request.jobId, progress: 0.1 + 0.75 * ((tile.index + 1) / tiles.length) });
  }

  const merged = mergeTileDetections(stitchedDetections, loadedManifest.postprocessing.nmsThreshold).slice(0, 300);
  warnings.push({
    code: 'TILE_INFERENCE_ORCHESTRATED',
    message: `Symbol tile inference ran ${tiles.length} tile(s) with ${Math.round(tilePolicy.overlap * 100)}% overlap and NMS stitching.`,
    severity: 'info',
    systemId: request.input.systemId
  });
  const raw = lastRaw ?? { provider: loadedModel.provider, outputs: {}, inferenceTimeMs };
  const result = createOmrDetectionResultFromDetections(
    request.input.projectId,
    request.input,
    loadedManifest,
    { ...raw, inferenceTimeMs },
    merged,
    warnings
  );
  loadedMetadata = loadedMetadata ?? {
    id: `${loadedManifest.modelId}:${loadedManifest.version}`,
    modelId: loadedManifest.modelId,
    version: loadedManifest.version,
    sha256: loadedManifest.sha256,
    sizeBytes: loadedManifest.sizeBytes,
    cachedAt: Date.now(),
    verifiedAt: Date.now(),
    sourceUrl: loadedManifestUrl ?? loadedManifest.file,
    status: 'VERIFIED'
  };
  post({ type: 'JOB_PROGRESS', jobId: request.jobId, progress: 0.9 });
  post({ type: 'JOB_COMPLETED', jobId: request.jobId, result, runtimeOutputNames: loadedModel.outputNames });
}

function isCancelled(jobId: string): boolean {
  if (!cancelledJobs.has(jobId)) {
    return false;
  }
  post({ type: 'JOB_CANCELLED', jobId });
  return true;
}

function post(message: OmrWorkerResponse) {
  scope.postMessage(message);
}

export {};
