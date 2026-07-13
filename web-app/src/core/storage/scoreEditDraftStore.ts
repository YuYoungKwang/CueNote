import type { EditableScoreDocument, EditCommand } from '@cuenote/score-domain';
import { createCueNoteDbAdapter, SCORE_EDIT_DRAFTS_STORE, SCORE_EDIT_PREFERENCES_STORE } from './cuenoteDb';
import type { IndexedDbAdapter } from './indexedDbAdapter';

export interface ScoreEditDraftRecord {
  id: string;
  scoreId: string;
  baseScoreVersionId: string;
  editableDocument: EditableScoreDocument;
  commandHistory: EditCommand[];
  historyCursor: number;
  validationIssues: EditableScoreDocument['validationIssues'];
  createdAt: number;
  updatedAt: number;
  lastAutosavedAt: number;
}

export interface ScoreEditPreferenceRecord {
  id: string;
  scoreId: string;
  baseScoreVersionId: string;
  selectedPartId?: string;
  selectedMeasureId?: string;
  selectedEventId?: string;
  zoom: number;
}

export interface ScoreEditDraftStore {
  load(scoreId: string, baseScoreVersionId: string): Promise<ScoreEditDraftRecord | undefined>;
  save(record: ScoreEditDraftRecord): Promise<void>;
  delete(scoreId: string, baseScoreVersionId: string): Promise<void>;
  loadPreferences(scoreId: string, baseScoreVersionId: string): Promise<ScoreEditPreferenceRecord | undefined>;
  savePreferences(record: ScoreEditPreferenceRecord): Promise<void>;
}

export function createScoreEditDraftStore(adapter: IndexedDbAdapter = createCueNoteDbAdapter()): ScoreEditDraftStore {
  return {
    load(scoreId, baseScoreVersionId) {
      return adapter.get<ScoreEditDraftRecord>(SCORE_EDIT_DRAFTS_STORE, draftKey(scoreId, baseScoreVersionId));
    },
    save(record) {
      return adapter.set(SCORE_EDIT_DRAFTS_STORE, record.id, record);
    },
    delete(scoreId, baseScoreVersionId) {
      return adapter.delete(SCORE_EDIT_DRAFTS_STORE, draftKey(scoreId, baseScoreVersionId));
    },
    loadPreferences(scoreId, baseScoreVersionId) {
      return adapter.get<ScoreEditPreferenceRecord>(SCORE_EDIT_PREFERENCES_STORE, draftKey(scoreId, baseScoreVersionId));
    },
    savePreferences(record) {
      return adapter.set(SCORE_EDIT_PREFERENCES_STORE, record.id, record);
    }
  };
}

export function draftKey(scoreId: string, baseScoreVersionId: string): string {
  return `${scoreId}:${baseScoreVersionId}`;
}
