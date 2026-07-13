import { describe, expect, it } from 'vitest';
import type { Annotation } from '@cuenote/score-domain';
import { createAnnotationSyncQueue } from './annotationSyncQueue';
import { createAnnotationRepository } from './annotationRepository';
import { createAnnotationSyncService } from './annotationSyncService';
import type { ApiClient } from '../api/client';
import type { IndexedDbAdapter } from './indexedDbAdapter';

const annotation: Annotation = {
  id: 'annotation-a',
  schemaVersion: 1,
  scoreId: 'score-a',
  scoreVersionId: 'version-a',
  type: 'TEXT',
  scope: 'ENSEMBLE',
  anchor: { type: 'MEASURE', sourceMeasureId: 'score-a:p1:m1:xml-a' },
  payload: {
    text: 'cue',
    x: 0.2,
    y: 0.2,
    width: 0.4,
    height: 0.12,
    fontSizeRatio: 0.1
  },
  createdAt: 1,
  updatedAt: 1,
  serverRevision: 0,
  syncState: 'PENDING'
};

describe('annotation sync queue', () => {
  it('persists pending mutations and marks successful sync', async () => {
    const adapter = createMemoryAdapter();
    const queue = createAnnotationSyncQueue(adapter);

    await queue.enqueue({
      clientMutationId: 'mutation-a',
      scoreId: 'score-a',
      scoreVersionId: 'version-a',
      annotationId: annotation.id,
      action: 'UPSERT',
      baseRevision: 0,
      annotation
    });

    await expect(queue.listPending('score-a', 'version-a')).resolves.toHaveLength(1);
    await queue.markSynced('mutation-a');
    await expect(queue.listPending('score-a', 'version-a')).resolves.toHaveLength(0);
  });

  it('marks revision conflicts without discarding local annotation data', async () => {
    const adapter = createMemoryAdapter();
    const queue = createAnnotationSyncQueue(adapter);
    const repository = createAnnotationRepository(adapter);
    await repository.upsert(annotation);
    await queue.enqueue({
      clientMutationId: 'mutation-conflict',
      scoreId: 'score-a',
      scoreVersionId: 'version-a',
      annotationId: annotation.id,
      action: 'UPSERT',
      baseRevision: 0,
      annotation
    });

    const apiClient = createConflictApiClient();
    const service = createAnnotationSyncService(apiClient, repository, queue);

    await expect(service.syncPending('token', 'score-a', 'version-a')).resolves.toEqual({
      synced: 0,
      failed: 0,
      conflicts: 1
    });
    await expect(repository.getById(annotation.id)).resolves.toMatchObject({
      id: annotation.id,
      syncState: 'CONFLICT',
      syncError: 'Server revision conflict.',
      serverRevision: 2
    });
  });
});

function createConflictApiClient(): ApiClient {
  return {
    baseUrl: 'http://test',
    getHealth: async () => ({ data: { status: 'UP', version: 'test' }, meta: { requestId: 'req_test' } }),
    loginDev: async () => {
      throw new Error('not used');
    },
    refresh: async () => {
      throw new Error('not used');
    },
    getMe: async () => {
      throw new Error('not used');
    },
    listEnsembles: async () => {
      throw new Error('not used');
    },
    createEnsemble: async () => {
      throw new Error('not used');
    },
    listScores: async () => {
      throw new Error('not used');
    },
    createScore: async () => {
      throw new Error('not used');
    },
    getScore: async () => {
      throw new Error('not used');
    },
    getScoreVersionSource: async () => {
      throw new Error('not used');
    },
    listAnnotations: async () => [],
    syncAnnotations: async () => {
      const serverAnnotation: Annotation = { ...annotation, serverRevision: 2, syncState: 'SYNCED' };
      throw Object.assign(new Error('Annotation revision conflict'), {
        status: 409,
        details: {
          conflicts: [
            {
              clientMutationId: 'mutation-conflict',
              annotationId: annotation.id,
              serverRevision: 2,
              serverAnnotation
            }
          ]
        }
      });
    }
  };
}

function createMemoryAdapter(): IndexedDbAdapter {
  const records = new Map<string, unknown>();
  return {
    name: 'test',
    version: 3,
    open: async () => {
      throw new Error('not needed for this test');
    },
    get: async <T>(storeName, key) => records.get(`${storeName}:${String(key)}`) as T | undefined,
    getAll: async <T>(storeName) =>
      Array.from(records.entries())
        .filter(([key]) => key.startsWith(`${storeName}:`))
        .map(([, value]) => value as T),
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
