import type { RehearsalFollowMode } from '@cuenote/score-domain';
import { createCueNoteDbAdapter, REHEARSAL_PREFERENCES_STORE } from './cuenoteDb';
import type { IndexedDbAdapter } from './indexedDbAdapter';

export interface RehearsalPreferenceRecord {
  scoreId: string;
  scoreVersionId: string;
  recentSessionId?: string;
  followMode: RehearsalFollowMode;
  showLatency: boolean;
  updatedAt: number;
}

export interface RehearsalPreferenceStore {
  load(scoreId: string, scoreVersionId: string): Promise<RehearsalPreferenceRecord | null>;
  save(record: RehearsalPreferenceRecord): Promise<void>;
}

export function createRehearsalPreferenceStore(adapter: IndexedDbAdapter = createCueNoteDbAdapter()): RehearsalPreferenceStore {
  const key = (scoreId: string, scoreVersionId: string) => `${scoreId}:${scoreVersionId}`;
  return {
    async load(scoreId, scoreVersionId) {
      try {
        return (await adapter.get<RehearsalPreferenceRecord>(REHEARSAL_PREFERENCES_STORE, key(scoreId, scoreVersionId))) ?? null;
      } catch {
        return null;
      }
    },
    async save(record) {
      try {
        await adapter.set(REHEARSAL_PREFERENCES_STORE, key(record.scoreId, record.scoreVersionId), record);
      } catch {
        // Rehearsal UI preferences must not block the viewer.
      }
    }
  };
}
