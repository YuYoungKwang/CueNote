import type { Annotation } from '@cuenote/score-domain';
import type { ApiClient } from '../api/client';
import type { AnnotationRepository } from './annotationRepository';
import { createAnnotationSyncQueue, type AnnotationSyncQueue, type AnnotationSyncQueueRecord } from './annotationSyncQueue';

export interface AnnotationSyncService {
  syncPending(accessToken: string, scoreId: string, scoreVersionId: string): Promise<AnnotationSyncSummary>;
  retry(clientMutationId: string): Promise<void>;
}

export interface AnnotationSyncSummary {
  synced: number;
  failed: number;
  conflicts: number;
}

export function createAnnotationSyncService(
  apiClient: ApiClient,
  annotationRepository: AnnotationRepository,
  queue: AnnotationSyncQueue = createAnnotationSyncQueue()
): AnnotationSyncService {
  return {
    async syncPending(accessToken, scoreId, scoreVersionId) {
      const pending = await queue.listPending(scoreId, scoreVersionId);
      let synced = 0;
      let failed = 0;
      let conflicts = 0;

      for (const record of pending) {
        try {
          const result = await apiClient.syncAnnotations(accessToken, record.scoreId, record.scoreVersionId, [
            {
              clientMutationId: record.clientMutationId,
              baseRevision: record.baseRevision,
              action: record.action,
              annotation: record.annotation,
              annotationId: record.annotationId
            }
          ]);

          for (const applied of result.applied) {
            await queue.markSynced(applied.clientMutationId);
            if (applied.annotation) {
              await annotationRepository.upsert({
                ...applied.annotation,
                serverRevision: applied.revision,
                syncState: 'SYNCED',
                syncError: undefined
              });
            }
            synced += 1;
          }
        } catch (error) {
          const details = (error as { details?: unknown }).details;
          const conflict = findConflict(details, record.clientMutationId);
          if (conflict) {
            await queue.markConflict(record.clientMutationId, conflict.serverAnnotation, 'Server revision conflict.');
            await markLocalConflict(annotationRepository, record, conflict.serverAnnotation);
            conflicts += 1;
            continue;
          }

          await queue.markFailed(record.clientMutationId, error instanceof Error ? error.message : 'Annotation sync failed.');
          failed += 1;
        }
      }

      return { synced, failed, conflicts };
    },
    async retry(clientMutationId) {
      await queue.retry(clientMutationId);
    }
  };
}

async function markLocalConflict(
  annotationRepository: AnnotationRepository,
  record: AnnotationSyncQueueRecord,
  serverAnnotation: Annotation | undefined
) {
  if (record.action === 'DELETE') {
    return;
  }

  if (record.annotation) {
    await annotationRepository.upsert({
      ...record.annotation,
      syncState: 'CONFLICT',
      syncError: 'Server revision conflict.',
      serverRevision: serverAnnotation?.serverRevision ?? record.annotation.serverRevision
    });
  }
}

function findConflict(details: unknown, clientMutationId: string): { serverAnnotation?: Annotation } | null {
  if (!details || typeof details !== 'object' || !('conflicts' in details)) {
    return null;
  }

  const conflicts = (details as { conflicts?: unknown }).conflicts;
  if (!Array.isArray(conflicts)) {
    return null;
  }

  const match = conflicts.find((item) => {
    return Boolean(item && typeof item === 'object' && (item as { clientMutationId?: unknown }).clientMutationId === clientMutationId);
  });

  if (!match || typeof match !== 'object') {
    return null;
  }

  return {
    serverAnnotation: (match as { serverAnnotation?: Annotation }).serverAnnotation
  };
}
