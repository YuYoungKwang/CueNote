import type { OmrInferenceWarning, OmrModelClass, OmrModelManifest } from './model';

export interface OmrClassIndexMap {
  byIndex: Map<number, OmrModelClass>;
  byId: Map<string, OmrModelClass>;
}

export function createOmrClassIndexMap(manifest: Pick<OmrModelManifest, 'classes'>): OmrClassIndexMap {
  const byIndex = new Map<number, OmrModelClass>();
  const byId = new Map<string, OmrModelClass>();

  manifest.classes.forEach((klass) => {
    if (byIndex.has(klass.index)) {
      throw new Error(`Duplicate OMR class index ${klass.index}.`);
    }
    if (byId.has(klass.id)) {
      throw new Error(`Duplicate OMR class id ${klass.id}.`);
    }
    byIndex.set(klass.index, klass);
    byId.set(klass.id, klass);
  });

  return { byIndex, byId };
}

export function classForIndex(map: OmrClassIndexMap, index: number): OmrModelClass {
  const klass = map.byIndex.get(index);
  if (!klass) {
    throw new Error(`OMR class index ${index} is not declared by the model manifest.`);
  }
  return klass;
}

export function validateOmrManifest(manifest: OmrModelManifest): OmrInferenceWarning[] {
  const warnings: OmrInferenceWarning[] = [];

  if (manifest.schemaVersion !== 1) {
    warnings.push({ code: 'MODEL_MANIFEST_INVALID', message: 'Unsupported OMR manifest schema version.', severity: 'error' });
  }
  if (!manifest.modelId || !manifest.version || !manifest.file) {
    warnings.push({ code: 'MODEL_MANIFEST_INVALID', message: 'OMR manifest must include modelId, version, and file.', severity: 'error' });
  }
  if (!/^[a-f0-9]{64}$/i.test(manifest.sha256)) {
    warnings.push({ code: 'MODEL_MANIFEST_INVALID', message: 'OMR manifest sha256 must be a 64-character hex digest.', severity: 'error' });
  }
  if (manifest.sizeBytes <= 0) {
    warnings.push({ code: 'MODEL_MANIFEST_INVALID', message: 'OMR manifest sizeBytes must be positive.', severity: 'error' });
  }
  if (manifest.input.width <= 0 || manifest.input.height <= 0) {
    warnings.push({ code: 'MODEL_MANIFEST_INVALID', message: 'OMR model input dimensions must be positive.', severity: 'error' });
  }
  if (manifest.classes.length === 0) {
    warnings.push({ code: 'MODEL_MANIFEST_INVALID', message: 'OMR manifest must declare class mapping, even for runtime smoke models.', severity: 'error' });
  }
  if (manifest.status && !['EXPERIMENTAL', 'CANDIDATE', 'PRODUCT'].includes(manifest.status)) {
    warnings.push({ code: 'MODEL_MANIFEST_INVALID', message: 'OMR model status must be EXPERIMENTAL, CANDIDATE, or PRODUCT.', severity: 'error' });
  }
  if (manifest.task !== 'RUNTIME_SMOKE') {
    const output = manifest.outputs?.[0];
    if (!output || !['BOX_XYWH_CONF_CLASS', 'YOLO_V8_RAW'].includes(output.format)) {
      warnings.push({ code: 'MODEL_MANIFEST_INVALID', message: 'Detection models must declare a supported detection output.', severity: 'error' });
    }
    if (manifest.status === 'PRODUCT' && (!manifest.datasetVersion || !manifest.evaluationReport)) {
      warnings.push({ code: 'MODEL_MANIFEST_INVALID', message: 'PRODUCT OMR models must include datasetVersion and evaluationReport.', severity: 'error' });
    }
  }

  try {
    createOmrClassIndexMap(manifest);
  } catch (error) {
    warnings.push({
      code: 'MODEL_MANIFEST_INVALID',
      message: error instanceof Error ? error.message : 'OMR class mapping is invalid.',
      severity: 'error'
    });
  }

  return warnings;
}
