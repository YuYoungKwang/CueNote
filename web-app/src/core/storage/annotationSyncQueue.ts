import type { Annotation } from '@cuenote/score-domain';
import { createCueNoteDbAdapter, ANNOTATION_SYNC_QUEUE_STORE } from './cuenoteDb';
import type { IndexedDbAdapter } from './indexedDbAdapter';

export type AnnotationSyncQueueStatus = 'PENDING' | 'SYNCED' | 'CONFLICT' | 'FAILED';

export interface AnnotationSyncQueueRecord {
  clientMutationId: string;
  scoreId: string;
  scoreVersionId: string;
  annotationId: string;
  action: 'UPSERT' | 'DELETE';
  baseRevision: number;
  annotation?: Annotation;
  status: AnnotationSyncQueueStatus;
  attempts: number;
  lastError?: string;
  serverAnnotation?: Annotation;
  createdAt: number;
  updatedAt: number;
}

export interface AnnotationSyncQueue {
  enqueue(record: Omit<AnnotationSyncQueueRecord, 'status' | 'attempts' | 'createdAt' | 'updatedAt'>): Promise<AnnotationSyncQueueRecord>;
  listPending(scoreId?: string, scoreVersionId?: string): Promise<AnnotationSyncQueueRecord[]>;
  listByScore(scoreId: string, scoreVersionId: string): Promise<AnnotationSyncQueueRecord[]>;
  markSynced(clientMutationId: string): Promise<void>;
  markFailed(clientMutationId: string, error: string): Promise<void>;
  markConflict(clientMutationId: string, serverAnnotation: Annotation | undefined, error: string): Promise<void>;
  retry(clientMutationId: string): Promise<void>;
}

export function createAnnotationSyncQueue(adapter: IndexedDbAdapter = createCueNoteDbAdapter()): AnnotationSyncQueue {
  return {
    async enqueue(record) {
      const now = Date.now();
      const next: AnnotationSyncQueueRecord = {
        ...record,
        status: 'PENDING',
        attempts: 0,
        createdAt: now,
        updatedAt: now
      };
      await adapter.set(ANNOTATION_SYNC_QUEUE_STORE, record.clientMutationId, next);
      return next;
    },
    async listPending(scoreId, scoreVersionId) {
      const records = await adapter.getAll<AnnotationSyncQueueRecord>(ANNOTATION_SYNC_QUEUE_STORE);
      return records
        .filter((record) => record.status === 'PENDING' || record.status === 'FAILED')
        .filter((record) => !scoreId || record.scoreId === scoreId)
        .filter((record) => !scoreVersionId || record.scoreVersionId === scoreVersionId)
        .sort((left, right) => left.createdAt - right.createdAt);
    },
    async listByScore(scoreId, scoreVersionId) {
      const records = await adapter.getAll<AnnotationSyncQueueRecord>(ANNOTATION_SYNC_QUEUE_STORE);
      return records
        .filter((record) => record.scoreId === scoreId && record.scoreVersionId === scoreVersionId)
        .sort((left, right) => left.createdAt - right.createdAt);
    },
    async markSynced(clientMutationId) {
      const current = await adapter.get<AnnotationSyncQueueRecord>(ANNOTATION_SYNC_QUEUE_STORE, clientMutationId);
      if (current) {
        await adapter.set(ANNOTATION_SYNC_QUEUE_STORE, clientMutationId, { ...current, status: 'SYNCED', updatedAt: Date.now() });
      }
    },
    async markFailed(clientMutationId, error) {
      const current = await adapter.get<AnnotationSyncQueueRecord>(ANNOTATION_SYNC_QUEUE_STORE, clientMutationId);
      if (current) {
        await adapter.set(ANNOTATION_SYNC_QUEUE_STORE, clientMutationId, {
          ...current,
          attempts: current.attempts + 1,
          status: 'FAILED',
          lastError: error,
          updatedAt: Date.now()
        });
      }
    },
    async markConflict(clientMutationId, serverAnnotation, error) {
      const current = await adapter.get<AnnotationSyncQueueRecord>(ANNOTATION_SYNC_QUEUE_STORE, clientMutationId);
      if (current) {
        await adapter.set(ANNOTATION_SYNC_QUEUE_STORE, clientMutationId, {
          ...current,
          status: 'CONFLICT',
          lastError: error,
          serverAnnotation,
          updatedAt: Date.now()
        });
      }
    },
    async retry(clientMutationId) {
      const current = await adapter.get<AnnotationSyncQueueRecord>(ANNOTATION_SYNC_QUEUE_STORE, clientMutationId);
      if (current && (current.status === 'FAILED' || current.status === 'CONFLICT')) {
        await adapter.set(ANNOTATION_SYNC_QUEUE_STORE, clientMutationId, {
          ...current,
          status: 'PENDING',
          lastError: undefined,
          updatedAt: Date.now()
        });
      }
    }
  };
}
