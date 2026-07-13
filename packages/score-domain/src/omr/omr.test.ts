import { describe, expect, it } from 'vitest';
import { applyOmrCorrections, createOmrClassIndexMap, requiresReview, validateOmrManifest, type OmrDetection, type OmrModelManifest } from './index';

const manifest: OmrModelManifest = {
  schemaVersion: 1,
  modelId: 'cuenote-test-runtime',
  version: '0.1.0',
  task: 'RUNTIME_SMOKE',
  file: 'test.onnx',
  sha256: 'a'.repeat(64),
  sizeBytes: 16,
  input: { width: 1, height: 1, channels: 1, tensorLayout: 'NCHW', resizeMode: 'STRETCH', valueRange: 'ZERO_TO_ONE' },
  executionProviders: ['WEBGPU', 'WASM'],
  classes: [{ id: 'runtime.identity', index: 0, blockingReview: true }],
  postprocessing: { confidenceThreshold: 0.5, nmsThreshold: 0.45 },
  minimumAppVersion: '0.8.0'
};

const detection: OmrDetection = {
  id: 'det_1',
  classId: 'runtime.identity',
  className: 'runtime.identity',
  confidence: 0.4,
  systemId: 'sys_1',
  pageId: 'page_1',
  boundsInSystem: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
  boundsInPage: { x: 0.2, y: 0.2, width: 0.1, height: 0.1 },
  source: 'MODEL',
  reviewDecision: 'UNREVIEWED'
};

describe('OMR phase 8 domain contracts', () => {
  it('maps class indexes from the manifest instead of hardcoding them', () => {
    const map = createOmrClassIndexMap(manifest);
    expect(map.byIndex.get(0)?.id).toBe('runtime.identity');
    expect(() => createOmrClassIndexMap({ classes: [...manifest.classes, { id: 'duplicate', index: 0 }] })).toThrow();
  });

  it('validates model manifests', () => {
    expect(validateOmrManifest(manifest)).toEqual([]);
    expect(validateOmrManifest({ ...manifest, sha256: 'bad' }).some((warning) => warning.severity === 'error')).toBe(true);
  });

  it('keeps low-confidence detections in review until accepted or corrected', () => {
    expect(requiresReview(detection, manifest)).toBe(true);
    const corrected = applyOmrCorrections([detection], [
      { id: 'corr_1', projectId: 'project_1', pageId: 'page_1', detectionId: 'det_1', createdAt: 1, operation: { type: 'ACCEPT' } }
    ]);
    expect(corrected[0]?.reviewDecision).toBe('ACCEPTED');
    expect(requiresReview(corrected[0]!, manifest)).toBe(false);
  });
});
