import type { AnnotationLayerFilterState } from '@cuenote/score-domain';
import { ANNOTATION_PREFERENCES_STORE, createCueNoteDbAdapter } from './cuenoteDb';
import type { IndexedDbAdapter } from './indexedDbAdapter';

export interface AnnotationPreferenceRecord {
  scoreId: string;
  scoreVersionId: string;
  currentPartId: string | null;
  activeScope: 'PRIVATE' | 'PART' | 'ENSEMBLE';
  activeAnchorType: 'MEASURE' | 'ELEMENT' | 'PERFORMANCE_MEASURE';
  filters: AnnotationLayerFilterState;
}

export interface AnnotationPreferenceStore {
  load(scoreId: string, scoreVersionId: string): Promise<AnnotationPreferenceRecord | null>;
  save(record: AnnotationPreferenceRecord): Promise<void>;
}

export function createAnnotationPreferenceStore(
  adapter: IndexedDbAdapter = createCueNoteDbAdapter()
): AnnotationPreferenceStore {
  return {
    async load(scoreId, scoreVersionId) {
      try {
        return (await adapter.get<AnnotationPreferenceRecord>(ANNOTATION_PREFERENCES_STORE, createPreferenceKey(scoreId, scoreVersionId))) ?? null;
      } catch {
        return null;
      }
    },
    async save(record) {
      await adapter.set(ANNOTATION_PREFERENCES_STORE, createPreferenceKey(record.scoreId, record.scoreVersionId), record);
    }
  };
}

function createPreferenceKey(scoreId: string, scoreVersionId: string): string {
  return `${scoreId}:${scoreVersionId}`;
}
