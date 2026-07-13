import { describe, expect, it } from 'vitest';
import {
  applyImportCorrections,
  createOmrPreparationManifest,
  normalizeRect,
  pixelRectToNormalized,
  validateImportRegions,
  validateOmrPreparationManifest,
  type ImportCorrection,
  type ImportDetectionSnapshot,
  type ImportPage,
  type ImportProject,
  type ImportSource
} from './index';

describe('import project domain', () => {
  it('normalizes pixel rectangles into canonical page coordinates', () => {
    expect(pixelRectToNormalized({ x: 50, y: 100, width: 250, height: 200 }, { width: 1000, height: 800 })).toEqual({
      x: 0.05,
      y: 0.125,
      width: 0.25,
      height: 0.25
    });
    const normalized = normalizeRect({ x: 0.8, y: 0.7, width: -0.2, height: -0.3 });
    expect(normalized.x).toBeCloseTo(0.6);
    expect(normalized.y).toBeCloseTo(0.4);
    expect(normalized.width).toBeCloseTo(0.2);
    expect(normalized.height).toBeCloseTo(0.3);
  });

  it('applies add, update, split, merge, reorder, delete, and reset corrections', () => {
    const snapshot = createSnapshot();
    const corrections: ImportCorrection[] = [
      {
        id: 'c1',
        projectId: 'project-1',
        pageId: 'page-1',
        createdAt: 1,
        operation: {
          type: 'ADD',
          region: {
            id: 'measure-2',
            type: 'MEASURE',
            pageId: 'page-1',
            parentId: 'system-1',
            rect: { x: 0.4, y: 0.2, width: 0.2, height: 0.2 },
            orderIndex: 1,
            confidence: 1,
            source: 'USER'
          }
        }
      },
      {
        id: 'c2',
        projectId: 'project-1',
        pageId: 'page-1',
        createdAt: 2,
        operation: { type: 'UPDATE', regionId: 'measure-2', patch: { rect: { x: 0.42, y: 0.2, width: 0.18, height: 0.2 } } }
      },
      {
        id: 'c3',
        projectId: 'project-1',
        pageId: 'page-1',
        createdAt: 3,
        operation: { type: 'SPLIT', regionId: 'measure-2', axis: 'vertical', ratio: 0.5, firstId: 'measure-2a', secondId: 'measure-2b' }
      },
      {
        id: 'c4',
        projectId: 'project-1',
        pageId: 'page-1',
        createdAt: 4,
        operation: { type: 'MERGE', regionIds: ['measure-2a', 'measure-2b'], mergedId: 'measure-2-merged' }
      },
      {
        id: 'c5',
        projectId: 'project-1',
        pageId: 'page-1',
        createdAt: 5,
        operation: { type: 'REORDER', orderedRegionIds: ['measure-2-merged', 'measure-1'] }
      }
    ];

    const corrected = applyImportCorrections(snapshot, corrections);
    expect(corrected.map((region) => region.id)).toContain('measure-2-merged');
    expect(corrected.find((region) => region.id === 'measure-2-merged')?.orderIndex).toBe(0);

    const deleted = applyImportCorrections(snapshot, [
      ...corrections,
      { id: 'c6', projectId: 'project-1', pageId: 'page-1', createdAt: 6, operation: { type: 'DELETE', regionId: 'measure-2-merged' } }
    ]);
    expect(deleted.map((region) => region.id)).not.toContain('measure-2-merged');

    const reset = applyImportCorrections(snapshot, [
      ...corrections,
      { id: 'c7', projectId: 'project-1', pageId: 'page-1', createdAt: 7, operation: { type: 'RESET' } }
    ]);
    expect(reset.map((region) => region.id)).toEqual(['system-1', 'staff-1', 'measure-1']);
  });

  it('blocks review completion when layout regions are missing', () => {
    const page = createPage();
    expect(validateImportRegions(page, []).filter((issue) => issue.blocking).map((issue) => issue.code)).toEqual(['EMPTY_DETECTION', 'EMPTY_DETECTION']);
    expect(validateImportRegions(page, createSnapshot().regions).filter((issue) => issue.blocking)).toEqual([]);
  });

  it('creates a manifest without embedding original binary source bytes', () => {
    const project: ImportProject = {
      id: 'project-1',
      title: 'Import',
      sourceId: 'source-1',
      sourceType: 'IMAGE',
      status: 'NEEDS_REVIEW',
      pageCount: 1,
      currentPageId: 'page-1',
      createdAt: 1,
      updatedAt: 1
    };
    const source: ImportSource = {
      id: 'source-1',
      projectId: 'project-1',
      type: 'IMAGE',
      fileName: 'fixture.png',
      mimeType: 'image/png',
      sizeBytes: 123,
      sha256: 'abc',
      storageBackend: 'INDEXEDDB_BLOB',
      storageKey: 'source-1-fixture.png',
      createdAt: 1
    };

    const manifest = createOmrPreparationManifest({
      project,
      source,
      pages: [createPage()],
      snapshots: [createSnapshot()],
      corrections: []
    });

    expect(manifest.source.storageKeyRef).toBe('source-1-fixture.png');
    expect('storageKey' in manifest.source).toBe(false);
    expect(validateOmrPreparationManifest(manifest)).toEqual([]);
  });
});

function createPage(): ImportPage {
  return {
    id: 'page-1',
    projectId: 'project-1',
    sourceId: 'source-1',
    pageIndex: 0,
    originalDimensions: { width: 1000, height: 1400 },
    rasterDimensions: { width: 500, height: 700 },
    rasterStorageKey: 'page-1-raster',
    status: 'NEEDS_REVIEW',
    transform: {
      rotation: 0,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      perspectiveCorners: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 }
      ],
      deskewDegrees: 0,
      brightness: 1,
      contrast: 1,
      threshold: null
    },
    warnings: [],
    updatedAt: 1
  };
}

function createSnapshot(): ImportDetectionSnapshot {
  return {
    id: 'snapshot-1',
    projectId: 'project-1',
    pageId: 'page-1',
    detectorVersion: 'test',
    createdAt: 1,
    preprocessing: createPage().transform,
    warnings: [],
    regions: [
      {
        id: 'system-1',
        type: 'SYSTEM',
        pageId: 'page-1',
        parentId: null,
        rect: { x: 0.1, y: 0.1, width: 0.8, height: 0.3 },
        orderIndex: 0,
        confidence: 0.8,
        source: 'DETECTED'
      },
      {
        id: 'staff-1',
        type: 'STAFF',
        pageId: 'page-1',
        parentId: 'system-1',
        rect: { x: 0.12, y: 0.18, width: 0.76, height: 0.08 },
        orderIndex: 0,
        confidence: 0.8,
        source: 'DETECTED'
      },
      {
        id: 'measure-1',
        type: 'MEASURE',
        pageId: 'page-1',
        parentId: 'system-1',
        rect: { x: 0.12, y: 0.1, width: 0.25, height: 0.3 },
        orderIndex: 0,
        confidence: 0.8,
        source: 'DETECTED'
      }
    ]
  };
}
