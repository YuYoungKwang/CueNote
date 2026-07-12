import { describe, expect, it } from 'vitest';
import { createAnnotationPreferenceStore } from './annotationPreferenceStore';
import { createAnnotationRepository } from './annotationRepository';
import type { IndexedDbAdapter } from './indexedDbAdapter';

describe('annotation storage', () => {
  it('persists annotations by score and score version', async () => {
    const records = new Map<string, unknown>();
    const adapter = createMemoryAdapter(records);
    const repository = createAnnotationRepository(adapter);

    await repository.upsert({
      id: 'annotation-a',
      schemaVersion: 1,
      scoreId: 'score-a',
      scoreVersionId: 'version-a',
      type: 'STROKE',
      scope: 'PRIVATE',
      anchor: { type: 'MEASURE', sourceMeasureId: 'score-a:p1:m1:xml-a' },
      payload: {
        tool: 'PEN',
        points: [{ x: 0.1, y: 0.1, pressure: 0.5 }],
        widthRatio: 0.02,
        opacity: 1,
        color: '#111827'
      },
      createdAt: 1,
      updatedAt: 1
    });

    await repository.upsert({
      id: 'annotation-b',
      schemaVersion: 1,
      scoreId: 'score-a',
      scoreVersionId: 'version-b',
      type: 'TEXT',
      scope: 'ENSEMBLE',
      anchor: { type: 'MEASURE', sourceMeasureId: 'score-a:p1:m2:xml-b' },
      payload: {
        text: 'hello',
        x: 0.2,
        y: 0.2,
        width: 0.4,
        height: 0.12,
        fontSizeRatio: 0.08
      },
      createdAt: 2,
      updatedAt: 2
    });

    await expect(repository.listByScore('score-a', 'version-a')).resolves.toHaveLength(1);
    await expect(repository.getById('annotation-a')).resolves.toMatchObject({
      id: 'annotation-a',
      scoreVersionId: 'version-a'
    });

    await repository.deleteByScore('score-a', 'version-a');
    await expect(repository.listByScore('score-a', 'version-a')).resolves.toEqual([]);
    await expect(repository.listByScore('score-a', 'version-b')).resolves.toHaveLength(1);
  });

  it('persists annotation UI preferences independently from annotation data', async () => {
    const records = new Map<string, unknown>();
    const adapter = createMemoryAdapter(records);
    const store = createAnnotationPreferenceStore(adapter);

    await store.save({
      scoreId: 'score-a',
      scoreVersionId: 'version-a',
      currentPartId: 'part-1',
      activeScope: 'PART',
      activeAnchorType: 'MEASURE',
      filters: {
        privateVisible: true,
        partVisible: false,
        ensembleVisible: true
      }
    });

    await expect(store.load('score-a', 'version-a')).resolves.toEqual({
      scoreId: 'score-a',
      scoreVersionId: 'version-a',
      currentPartId: 'part-1',
      activeScope: 'PART',
      activeAnchorType: 'MEASURE',
      filters: {
        privateVisible: true,
        partVisible: false,
        ensembleVisible: true
      }
    });
  });
});

function createMemoryAdapter(records: Map<string, unknown>): IndexedDbAdapter {
  return {
    name: 'test',
    version: 2,
    open: async () => {
      throw new Error('not needed for this test');
    },
    get: async <T>(storeName, key) => {
      return records.get(`${storeName}:${String(key)}`) as T | undefined;
    },
    getAll: async <T>(storeName) => {
      return Array.from(records.entries())
        .filter(([key]) => key.startsWith(`${storeName}:`))
        .map(([, value]) => value as T);
    },
    set: async <T>(storeName, key, value) => {
      records.set(`${storeName}:${String(key)}`, value);
    },
    delete: async (storeName, key) => {
      records.delete(`${storeName}:${String(key)}`);
    },
    clear: async (storeName) => {
      for (const key of Array.from(records.keys())) {
        if (key.startsWith(`${storeName}:`)) {
          records.delete(key);
        }
      }
    }
  };
}
