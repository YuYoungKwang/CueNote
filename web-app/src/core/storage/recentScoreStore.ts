import { createCueNoteDbAdapter, RECENT_SCORES_STORE } from './cuenoteDb';
import type { IndexedDbAdapter } from './indexedDbAdapter';

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

export function createRecentScoreStore(adapter: IndexedDbAdapter = createCueNoteDbAdapter()): RecentScoreStore {
  return {
    async save(record) {
      try {
        await adapter.set(RECENT_SCORES_STORE, record.scoreId, record);
      } catch {
        // Persistence should never block the viewer.
      }
    },
    async load(scoreId) {
      try {
        return (await adapter.get<RecentScoreRecord>(RECENT_SCORES_STORE, scoreId)) ?? null;
      } catch {
        return null;
      }
    },
    async list() {
      try {
        return await adapter.getAll<RecentScoreRecord>(RECENT_SCORES_STORE);
      } catch {
        return [];
      }
    }
  };
}
