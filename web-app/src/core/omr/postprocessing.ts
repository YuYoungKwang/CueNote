import {
  classForIndex,
  createOmrClassIndexMap,
  normalizeRect,
  type OmrDetection,
  type OmrDetectionResult,
  type OmrInferenceWarning,
  type OmrModelInputManifest,
  type OmrModelManifest
} from '@cuenote/score-domain';
import { systemRectToPageRect, tensorRectToSystemRect } from './coordinateMapper';
import type { RawOmrOutput } from './onnxRuntimeAdapter';
import type { OmrTensorInput } from './tensorBuilder';

export function createOmrDetectionResult(
  projectId: string,
  input: OmrModelInputManifest,
  manifest: OmrModelManifest,
  raw: RawOmrOutput,
  tensor?: OmrTensorInput
): OmrDetectionResult {
  if (manifest.task === 'RUNTIME_SMOKE') {
    return createRuntimeSmokeDetectionResult(projectId, input, manifest, raw);
  }
  return createDetectionModelResult(projectId, input, manifest, raw, tensor);
}

export function createOmrDetectionResultFromDetections(
  projectId: string,
  input: OmrModelInputManifest,
  manifest: OmrModelManifest,
  raw: RawOmrOutput,
  detections: OmrDetection[],
  warnings: OmrInferenceWarning[]
): OmrDetectionResult {
  appendNonProductWarning(manifest, input, warnings);
  return baseResult(projectId, input, manifest, raw, detections, warnings);
}

export function decodeOmrDetections(
  input: OmrModelInputManifest,
  manifest: OmrModelManifest,
  raw: RawOmrOutput,
  tensor?: OmrTensorInput,
  warnings: OmrInferenceWarning[] = []
): OmrDetection[] {
  const outputSpec = manifest.outputs?.find((output) => output.format === 'BOX_XYWH_CONF_CLASS' || output.format === 'YOLO_V8_RAW');
  if (!outputSpec) {
    warnings.push({ code: 'INVALID_MODEL_OUTPUT', message: 'Detection model did not declare a supported detection output.', severity: 'error', systemId: input.systemId });
    return [];
  }
  const output = raw.outputs[outputSpec.name] ?? Object.values(raw.outputs)[0];
  if (!output || !(output.data instanceof Float32Array)) {
    warnings.push({ code: 'INVALID_MODEL_OUTPUT', message: 'Detection model output was missing or not float32.', severity: 'error', systemId: input.systemId });
    return [];
  }
  if (outputSpec.format === 'YOLO_V8_RAW') {
    return decodeYoloV8Detections(output.data, output.dims, input, manifest, tensor, warnings);
  }
  return decodeBoxXywhDetections(output.data, outputSpec, input, manifest, tensor, warnings);
}

export function createRuntimeSmokeDetectionResult(
  projectId: string,
  input: OmrModelInputManifest,
  manifest: OmrModelManifest,
  raw: RawOmrOutput
): OmrDetectionResult {
  const warnings: OmrInferenceWarning[] = [
    {
      code: 'PRODUCT_MODEL_NOT_INSTALLED',
      message: 'The ONNX runtime test model executed successfully, but no production OMR layout or symbol model is installed.',
      severity: 'warning',
      systemId: input.systemId
    }
  ];

  return baseResult(projectId, input, manifest, raw, [], warnings);
}

function createDetectionModelResult(
  projectId: string,
  input: OmrModelInputManifest,
  manifest: OmrModelManifest,
  raw: RawOmrOutput,
  tensor?: OmrTensorInput
): OmrDetectionResult {
  const warnings: OmrInferenceWarning[] = [];
  const detections = decodeOmrDetections(input, manifest, raw, tensor, warnings);
  appendNonProductWarning(manifest, input, warnings);
  return baseResult(projectId, input, manifest, raw, detections, warnings);
}

function decodeBoxXywhDetections(
  data: Float32Array,
  outputSpec: NonNullable<OmrModelManifest['outputs']>[number],
  input: OmrModelInputManifest,
  manifest: OmrModelManifest,
  tensor: OmrTensorInput | undefined,
  warnings: OmrInferenceWarning[]
): OmrDetection[] {
  const valuesPerDetection = 6;
  if (data.length % valuesPerDetection !== 0) {
    warnings.push({ code: 'INVALID_MODEL_OUTPUT', message: 'Detection output length must be divisible by 6.', severity: 'error', systemId: input.systemId });
    return [];
  }

  const classIndex = createOmrClassIndexMap(manifest);
  const detections: OmrDetection[] = [];
  for (let offset = 0; offset < data.length; offset += valuesPerDetection) {
    const [x, y, width, height, confidence, classIndexValue] = data.slice(offset, offset + valuesPerDetection);
    if (confidence < manifest.postprocessing.confidenceThreshold) {
      continue;
    }
    let klass;
    try {
      klass = classForIndex(classIndex, Math.round(classIndexValue));
    } catch (error) {
      warnings.push({
        code: 'INVALID_CLASS_INDEX',
        message: error instanceof Error ? error.message : 'Invalid model class index.',
        severity: 'error',
        systemId: input.systemId
      });
      continue;
    }

    const rawBounds = normalizeRect({ x, y, width, height });
    const boundsInSystem = outputSpec.coordinateSpace === 'TENSOR_NORMALIZED' && tensor?.transform ? tensorRectToSystemRect(rawBounds, tensor.transform) : rawBounds;
    const boundsInPage = systemRectToPageRect(boundsInSystem, input.crop.pageBounds);
    detections.push({
      id: `${input.systemId}:${manifest.modelId}:${offset / valuesPerDetection}:${klass.id}`,
      classId: klass.id,
      className: klass.label ?? klass.id,
      confidence: Number(confidence.toFixed(4)),
      systemId: input.systemId,
      pageId: input.pageId,
      boundsInSystem,
      boundsInPage,
      source: manifest.fixtureDetector ? 'FIXTURE' : 'MODEL',
      reviewDecision: 'UNREVIEWED',
      modelVersion: manifest.version,
      attributes: {
        modelStatus: manifest.status ?? 'EXPERIMENTAL',
        outputFormat: outputSpec.format
      }
    });
  }

  return detections;
}

function appendNonProductWarning(manifest: OmrModelManifest, input: OmrModelInputManifest, warnings: OmrInferenceWarning[]) {
  if (manifest.status !== 'PRODUCT') {
    warnings.push({
      code: 'PRODUCT_MODEL_NOT_INSTALLED',
      message: `${manifest.modelId} is ${manifest.status ?? 'EXPERIMENTAL'} and must not be treated as a product OMR model.`,
      severity: 'warning',
      systemId: input.systemId
    });
  }
}

function decodeYoloV8Detections(
  data: Float32Array,
  dims: readonly number[],
  input: OmrModelInputManifest,
  manifest: OmrModelManifest,
  tensor: OmrTensorInput | undefined,
  warnings: OmrInferenceWarning[]
): OmrDetection[] {
  const classIndex = createOmrClassIndexMap(manifest);
  const classCount = manifest.classes.length;
  const rows: number[][] = [];
  if (dims.length === 3 && dims[0] === 1 && dims[1] === classCount + 4) {
    const count = dims[2] ?? 0;
    for (let i = 0; i < count; i += 1) {
      rows.push(Array.from({ length: classCount + 4 }, (_, channel) => data[channel * count + i] ?? 0));
    }
  } else if (dims.length === 3 && dims[0] === 1 && dims[2] === classCount + 4) {
    const count = dims[1] ?? 0;
    for (let i = 0; i < count; i += 1) {
      const start = i * (classCount + 4);
      rows.push(Array.from(data.slice(start, start + classCount + 4)));
    }
  } else {
    warnings.push({ code: 'INVALID_MODEL_OUTPUT', message: `Unsupported YOLO output shape [${dims.join(', ')}].`, severity: 'error', systemId: input.systemId });
    return [];
  }

  const detections: OmrDetection[] = [];
  rows.forEach((row, index) => {
    const classScores = row.slice(4);
    const bestScore = Math.max(...classScores);
    const bestIndex = classScores.indexOf(bestScore);
    if (bestScore < manifest.postprocessing.confidenceThreshold || bestIndex < 0) {
      return;
    }
    let klass;
    try {
      klass = classForIndex(classIndex, bestIndex);
    } catch (error) {
      warnings.push({ code: 'INVALID_CLASS_INDEX', message: error instanceof Error ? error.message : 'Invalid YOLO class index.', severity: 'error', systemId: input.systemId });
      return;
    }
    const [centerX, centerY, width, height] = row;
    const inputWidth = manifest.input.width;
    const inputHeight = manifest.input.height;
    const normalized = normalizeRect({
      x: (centerX - width / 2) / inputWidth,
      y: (centerY - height / 2) / inputHeight,
      width: width / inputWidth,
      height: height / inputHeight
    });
    const boundsInSystem = tensor?.transform ? tensorRectToSystemRect(normalized, tensor.transform) : normalized;
    detections.push({
      id: `${input.systemId}:${manifest.modelId}:yolo:${index}:${klass.id}`,
      classId: klass.id,
      className: klass.label ?? klass.id,
      confidence: Number(bestScore.toFixed(4)),
      systemId: input.systemId,
      pageId: input.pageId,
      boundsInSystem,
      boundsInPage: systemRectToPageRect(boundsInSystem, input.crop.pageBounds),
      source: 'MODEL',
      reviewDecision: 'UNREVIEWED',
      modelVersion: manifest.version,
      attributes: { modelStatus: manifest.status ?? 'EXPERIMENTAL', outputFormat: 'YOLO_V8_RAW' }
    });
  });
  return nms(detections, manifest.postprocessing.nmsThreshold).slice(0, 300);
}

export function nms(detections: OmrDetection[], threshold: number): OmrDetection[] {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const kept: OmrDetection[] = [];
  for (const detection of sorted) {
    if (kept.every((candidate) => candidate.classId !== detection.classId || rectIou(candidate.boundsInSystem, detection.boundsInSystem) < threshold)) {
      kept.push(detection);
    }
  }
  return kept;
}

function rectIou(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const intersection = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function baseResult(
  projectId: string,
  input: OmrModelInputManifest,
  manifest: OmrModelManifest,
  raw: RawOmrOutput,
  detections: OmrDetection[],
  warnings: OmrInferenceWarning[]
): OmrDetectionResult {
  return {
    id: `${projectId}:${input.pageId}:${input.systemId}:${manifest.modelId}:${Date.now()}`,
    projectId,
    pageId: input.pageId,
    systemId: input.systemId,
    modelId: manifest.modelId,
    modelVersion: manifest.version,
    executionProvider: raw.provider,
    inputManifestVersion: input.schemaVersion,
    inferenceTimeMs: raw.inferenceTimeMs,
    detections,
    warnings,
    createdAt: Date.now()
  };
}
