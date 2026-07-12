import { createIndexedDbAdapter, type IndexedDbAdapter } from './indexedDbAdapter';

export interface RecentScoreRecord {
  scoreId: string;
  title: string;
  lastOpenedAt: number;
  currentMeasureId: string;
  zoom: number;
  currentPerformanceMeasureId?: string;
  bpm?: number;
  countInMeasures?: number;
  playbackStatus?: 'STOPPED' | 'PAUSED' | 'ENDED' | 'PLAYING' | 'COUNT_IN';
}

export interface RecentScoreStore {
  save(record: RecentScoreRecord): Promise<void>;
  load(scoreId: string): Promise<RecentScoreRecord | null>;
  list(): Promise<RecentScoreRecord[]>;
}

const STORE_NAME = 'recent_scores';

export function createRecentScoreStore(adapter: IndexedDbAdapter = createIndexedDbAdapter({ name: 'cuenote', version: 1, upgrade })) : RecentScoreStore {
  return {
    async save(record) {
      try {
        await adapter.set(STORE_NAME, record.scoreId, record);
      } catch {
        // Persistence should never block the viewer.
      }
    },
    async load(scoreId) {
      try {
        return (await adapter.get<RecentScoreRecord>(STORE_NAME, scoreId)) ?? null;
      } catch {
        return null;
      }
    },
    async list() {
      try {
        const db = await adapter.open();
        return await new Promise<RecentScoreRecord[]>((resolve, reject) => {
          const transaction = db.transaction(STORE_NAME, 'readonly');
          const request = transaction.objectStore(STORE_NAME).getAll();
          request.onsuccess = () => resolve(request.result as RecentScoreRecord[]);
          request.onerror = () => reject(request.error ?? new Error('IndexedDB list failed'));
          transaction.oncomplete = () => db.close();
          transaction.onerror = () => {
            db.close();
            reject(transaction.error ?? new Error('IndexedDB list transaction failed'));
          };
        });
      } catch {
        return [];
      }
    }
  };
}

function upgrade(database: IDBDatabase) {
  if (!database.objectStoreNames.contains(STORE_NAME)) {
    database.createObjectStore(STORE_NAME);
  }
}
