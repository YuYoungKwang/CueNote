import type { OmrDetectionResult, OmrInferenceWarning, OmrModelInputManifest, OmrModelManifest } from '@cuenote/score-domain';
import type { RawOmrOutput } from './onnxRuntimeAdapter';

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
    detections: [],
    warnings,
    createdAt: Date.now()
  };
}
