import { describe, expect, it } from 'vitest';
import type { ImportPage, ImportProject, ImportSource } from '@cuenote/score-domain';
import { createImportProjectRepository } from './importProjectRepository';
import type { IndexedDbAdapter } from './indexedDbAdapter';

describe('createImportProjectRepository', () => {
  it('saves and restores import projects without mutating source bytes', async () => {
    const adapter = createMemoryAdapter();
    const repository = createImportProjectRepository(adapter);
    const project: ImportProject = {
      id: 'project-1',
      title: 'Local score',
      sourceId: 'source-1',
      sourceType: 'IMAGE',
      status: 'NEEDS_REVIEW',
      pageCount: 1,
      currentPageId: 'page-1',
      createdAt: 1,
      updatedAt: 2
    };
    const source: ImportSource = {
      id: 'source-1',
      projectId: 'project-1',
      type: 'IMAGE',
      fileName: 'score.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      sha256: 'hash',
      storageBackend: 'INDEXEDDB_BLOB',
      storageKey: 'source-1-score.png',
      createdAt: 1
    };
    const page: ImportPage = {
      id: 'page-1',
      projectId: 'project-1',
      sourceId: 'source-1',
      pageIndex: 0,
      originalDimensions: { width: 100, height: 200 },
      rasterDimensions: { width: 100, height: 200 },
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
      updatedAt: 2
    };

    await repository.saveProject(project);
    await repository.saveSource(source, new Blob(['test'], { type: 'image/png' }));
    await repository.savePage(page);

    await expect(repository.listProjects()).resolves.toEqual([project]);
    const bundle = await repository.loadProject(project.id);
    expect(bundle?.source?.storageKey).toBe('source-1-score.png');
    expect(bundle?.pages).toHaveLength(1);
    await expect(repository.readSourceBlob(source)).resolves.toMatchObject({ size: 4 });
  });
});

function createMemoryAdapter(): IndexedDbAdapter {
  const records = new Map<string, unknown>();
  return {
    name: 'test',
    version: 1,
    open: async () => {
      throw new Error('not needed');
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
