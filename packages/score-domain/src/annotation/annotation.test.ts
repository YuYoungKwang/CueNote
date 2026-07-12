import { describe, expect, it } from 'vitest';
import {
  filterVisibleAnnotations,
  normalizePointerPressure,
  toClientPoint,
  toRelativePoint,
  type Annotation
} from './index';

describe('annotation domain', () => {
  it('keeps out-of-range relative coordinates instead of clamping them', () => {
    const point = toRelativePoint({ left: 100, top: 50, width: 200, height: 100 }, { x: 80, y: 180 }, 0.8);

    expect(point).toEqual({
      x: -0.1,
      y: 1.3,
      pressure: 0.8
    });
  });

  it('round-trips relative points through current bounds', () => {
    const relative = toRelativePoint({ left: 10, top: 20, width: 300, height: 120 }, { x: 160, y: 80 }, 0.4, 12);
    const client = toClientPoint({ left: 10, top: 20, width: 300, height: 120 }, relative);

    expect(relative).toEqual({
      x: 0.5,
      y: 0.5,
      pressure: 0.4,
      timeOffsetMs: 12
    });
    expect(client).toEqual({ x: 160, y: 80 });
  });

  it('normalizes unsupported or invalid pressure values', () => {
    expect(normalizePointerPressure(undefined)).toBe(0.5);
    expect(normalizePointerPressure(0)).toBe(0.5);
    expect(normalizePointerPressure(Number.NaN)).toBe(0.5);
    expect(normalizePointerPressure(2)).toBe(1);
    expect(normalizePointerPressure(-1, 0.3)).toBe(0.3);
  });

  it('filters part and performance-measure annotations using layer state', () => {
    const annotations: Annotation[] = [
      {
        id: 'private-a',
        schemaVersion: 1,
        scoreId: 'score-a',
        scoreVersionId: 'version-a',
        type: 'TEXT',
        scope: 'PRIVATE',
        anchor: { type: 'MEASURE', sourceMeasureId: 'score-a:p1:m1:xml-a' },
        payload: {
          text: 'private',
          x: 0.2,
          y: 0.3,
          width: 0.25,
          height: 0.1,
          fontSizeRatio: 0.08
        },
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'part-a',
        schemaVersion: 1,
        scoreId: 'score-a',
        scoreVersionId: 'version-a',
        type: 'STROKE',
        scope: 'PART',
        partId: 'part-1',
        anchor: {
          type: 'PERFORMANCE_MEASURE',
          sourceMeasureId: 'score-a:p1:m1:xml-a',
          performanceMeasureId: 'score-a:p1:m1:xml-a::2'
        },
        payload: {
          tool: 'PEN',
          points: [{ x: 0.1, y: 0.2, pressure: 0.5 }],
          widthRatio: 0.03,
          opacity: 1,
          color: '#111827'
        },
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'ensemble-a',
        schemaVersion: 1,
        scoreId: 'score-a',
        scoreVersionId: 'version-a',
        type: 'TEXT',
        scope: 'ENSEMBLE',
        anchor: { type: 'MEASURE', sourceMeasureId: 'score-a:p1:m2:xml-b' },
        payload: {
          text: 'ensemble',
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.12,
          fontSizeRatio: 0.07
        },
        createdAt: 1,
        updatedAt: 1
      }
    ];

    const filtered = filterVisibleAnnotations(annotations, {
      filters: {
        privateVisible: true,
        partVisible: true,
        ensembleVisible: false
      },
      currentPartId: 'part-1',
      currentPerformanceMeasureId: 'score-a:p1:m1:xml-a::2'
    });

    expect(filtered.map((annotation) => annotation.id)).toEqual(['private-a', 'part-a']);

    const hiddenPerformance = filterVisibleAnnotations(annotations, {
      filters: {
        privateVisible: true,
        partVisible: true,
        ensembleVisible: true
      },
      currentPartId: 'part-1',
      currentPerformanceMeasureId: 'score-a:p1:m1:xml-a::1'
    });

    expect(hiddenPerformance.map((annotation) => annotation.id)).toEqual(['private-a', 'ensemble-a']);
  });
});
