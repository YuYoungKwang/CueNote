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
  const outputSpec = manifest.outputs?.find((output) => output.format === 'BOX_XYWH_CONF_CLASS');
  if (!outputSpec) {
    return baseResult(projectId, input, manifest, raw, [], [
      { code: 'INVALID_MODEL_OUTPUT', message: 'Detection model did not declare BOX_XYWH_CONF_CLASS output.', severity: 'error', systemId: input.systemId }
    ]);
  }

  const output = raw.outputs[outputSpec.name] ?? Object.values(raw.outputs)[0];
  if (!output || !(output.data instanceof Float32Array)) {
    return baseResult(projectId, input, manifest, raw, [], [
      { code: 'INVALID_MODEL_OUTPUT', message: 'Detection model output was missing or not float32.', severity: 'error', systemId: input.systemId }
    ]);
  }

  const valuesPerDetection = 6;
  if (output.data.length % valuesPerDetection !== 0) {
    return baseResult(projectId, input, manifest, raw, [], [
      { code: 'INVALID_MODEL_OUTPUT', message: 'Detection output length must be divisible by 6.', severity: 'error', systemId: input.systemId }
    ]);
  }

  const classIndex = createOmrClassIndexMap(manifest);
  const detections: OmrDetection[] = [];
  for (let offset = 0; offset < output.data.length; offset += valuesPerDetection) {
    const [x, y, width, height, confidence, classIndexValue] = output.data.slice(offset, offset + valuesPerDetection);
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

  if (manifest.status !== 'PRODUCT') {
    warnings.push({
      code: 'PRODUCT_MODEL_NOT_INSTALLED',
      message: `${manifest.modelId} is ${manifest.status ?? 'EXPERIMENTAL'} and must not be treated as a product OMR model.`,
      severity: 'warning',
      systemId: input.systemId
    });
  }

  return baseResult(projectId, input, manifest, raw, detections, warnings);
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
