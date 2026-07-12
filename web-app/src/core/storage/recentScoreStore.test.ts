import { describe, expect, it } from 'vitest';
import { createRecentScoreStore } from './recentScoreStore';
import type { IndexedDbAdapter } from './indexedDbAdapter';

describe('createRecentScoreStore', () => {
  it('saves and restores recent score records', async () => {
    const records = new Map<string, unknown>();
    const adapter: IndexedDbAdapter = {
      name: 'test',
      version: 1,
      open: async () => {
        throw new Error('not needed for this test');
      },
      get: async <T>(storeName, key) => {
        return records.get(`${storeName}:${String(key)}`) as T | undefined;
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

    const store = createRecentScoreStore(adapter);

    await store.save({
      scoreId: 'simple-duet',
      title: 'Simple Duet',
      lastOpenedAt: 1700000000000,
      currentMeasureId: 'simple-duet:p1:m2:sd-m2',
      zoom: 1.2
    });

    await expect(store.load('simple-duet')).resolves.toEqual({
      scoreId: 'simple-duet',
      title: 'Simple Duet',
      lastOpenedAt: 1700000000000,
      currentMeasureId: 'simple-duet:p1:m2:sd-m2',
      zoom: 1.2
    });
  });
});
