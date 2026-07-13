import { describe, expect, it } from 'vitest';
import type { IndexedDbAdapter } from './indexedDbAdapter';
import { createScoreEditDraftStore, draftKey } from './scoreEditDraftStore';

describe('createScoreEditDraftStore', () => {
  it('saves, restores, and deletes edit drafts and preferences', async () => {
    const records = new Map<string, unknown>();
    const adapter: IndexedDbAdapter = {
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

    const store = createScoreEditDraftStore(adapter);
    const id = draftKey('scr_1', 'ver_1');
    const editableDocument = {
      scoreId: 'scr_1',
      baseScoreVersionId: 'ver_1',
      title: 'Draft',
      parts: [],
      revision: 1,
      dirty: true,
      validationIssues: []
    };

    await store.save({
      id,
      scoreId: 'scr_1',
      baseScoreVersionId: 'ver_1',
      editableDocument,
      commandHistory: [],
      historyCursor: 0,
      validationIssues: [],
      createdAt: 1,
      updatedAt: 2,
      lastAutosavedAt: 2
    });
    await store.savePreferences({
      id,
      scoreId: 'scr_1',
      baseScoreVersionId: 'ver_1',
      selectedPartId: 'P1',
      selectedMeasureId: 'm1',
      selectedEventId: 'e1',
      zoom: 1.2
    });

    await expect(store.load('scr_1', 'ver_1')).resolves.toMatchObject({ id, editableDocument });
    await expect(store.loadPreferences('scr_1', 'ver_1')).resolves.toMatchObject({ selectedEventId: 'e1', zoom: 1.2 });

    await store.delete('scr_1', 'ver_1');
    await expect(store.load('scr_1', 'ver_1')).resolves.toBeUndefined();
  });
});
