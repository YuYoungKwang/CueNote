import { describe, expect, it } from 'vitest';
import type { OmrModelInputManifest, OmrModelManifest } from '@cuenote/score-domain';
import { createOmrDetectionResult } from './postprocessing';

describe('OMR postprocessing', () => {
  it('decodes manifest-driven BOX_XYWH_CONF_CLASS detections', () => {
    const manifest: OmrModelManifest = {
      schemaVersion: 1,
      modelId: 'test-layout',
      version: '0.1',
      task: 'LAYOUT_DETECTION',
      status: 'EXPERIMENTAL',
      file: 'layout.onnx',
      sha256: 'a'.repeat(64),
      sizeBytes: 1,
      input: {
        width: 320,
        height: 160,
        channels: 1,
        tensorLayout: 'NCHW',
        resizeMode: 'LETTERBOX',
        valueRange: 'ZERO_TO_ONE'
      },
      outputs: [{ name: 'detections', format: 'BOX_XYWH_CONF_CLASS', coordinateSpace: 'SYSTEM_NORMALIZED', shape: [1, 6] }],
      executionProviders: ['WASM'],
      classes: [{ id: 'measure.region', index: 0, label: 'Measure' }],
      postprocessing: { confidenceThreshold: 0.4, nmsThreshold: 0.5 },
      minimumAppVersion: '0.9.0'
    };
    const input: OmrModelInputManifest = {
      schemaVersion: 1,
      projectId: 'project-1',
      pageId: 'page-1',
      systemId: 'system-1',
      image: {
        reference: 'image',
        sourceChecksum: 'checksum',
        width: 100,
        height: 50,
        channels: 1,
        colorSpace: 'GRAYSCALE'
      },
      crop: { pageBounds: { x: 0.1, y: 0.2, width: 0.8, height: 0.5 }, paddingRatio: 0 },
      preprocessing: {
        rotationDegrees: 0,
        deskewDegrees: 0,
        grayscale: true,
        thresholdMode: 'NONE',
        inverted: false,
        normalizationVersion: 'test'
      },
      expectedModelInput: manifest.input
    };

    const result = createOmrDetectionResult(
      'project-1',
      input,
      manifest,
      {
        provider: 'WASM',
        inferenceTimeMs: 2,
        outputs: { detections: { dims: [1, 6], data: new Float32Array([0.25, 0.2, 0.5, 0.4, 0.91, 0]) } }
      },
      { data: new Float32Array(1), dims: [1, 1, 160, 320], layout: 'NCHW' }
    );

    expect(result.detections).toHaveLength(1);
    expect(result.detections[0].classId).toBe('measure.region');
    expect(result.detections[0].boundsInPage.x).toBeCloseTo(0.3);
    expect(result.detections[0].boundsInPage.y).toBeCloseTo(0.3);
    expect(result.warnings[0].code).toBe('PRODUCT_MODEL_NOT_INSTALLED');
  });
});
