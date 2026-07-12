import type { Annotation } from '@cuenote/score-domain';
import { createCueNoteDbAdapter, ANNOTATIONS_STORE } from './cuenoteDb';
import type { IndexedDbAdapter } from './indexedDbAdapter';

export interface AnnotationRepository {
  listByScore(scoreId: string, scoreVersionId: string): Promise<Annotation[]>;
  getById(id: string): Promise<Annotation | undefined>;
  upsert(annotation: Annotation): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByScore(scoreId: string, scoreVersionId: string): Promise<void>;
}

interface AnnotationRecord {
  key: string;
  annotation: Annotation;
  scoreId: string;
  scoreVersionId: string;
}

export function createAnnotationRepository(adapter: IndexedDbAdapter = createCueNoteDbAdapter()): AnnotationRepository {
  return {
    async listByScore(scoreId, scoreVersionId) {
      const records = await adapter.getAll<AnnotationRecord>(ANNOTATIONS_STORE);
      return records
        .filter((record) => record.scoreId === scoreId && record.scoreVersionId === scoreVersionId)
        .map((record) => record.annotation)
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
    },
    async getById(id) {
      const record = await adapter.get<AnnotationRecord>(ANNOTATIONS_STORE, id);
      return record?.annotation;
    },
    async upsert(annotation) {
      const record: AnnotationRecord = {
        key: annotation.id,
        annotation,
        scoreId: annotation.scoreId,
        scoreVersionId: annotation.scoreVersionId
      };
      await adapter.set(ANNOTATIONS_STORE, annotation.id, record);
    },
    async delete(id) {
      await adapter.delete(ANNOTATIONS_STORE, id);
    },
    async deleteByScore(scoreId, scoreVersionId) {
      const records = await adapter.getAll<AnnotationRecord>(ANNOTATIONS_STORE);
      const matchingKeys = records
        .filter((record) => record.scoreId === scoreId && record.scoreVersionId === scoreVersionId)
        .map((record) => record.key);

      await Promise.all(matchingKeys.map((key) => adapter.delete(ANNOTATIONS_STORE, key)));
    }
  };
}
