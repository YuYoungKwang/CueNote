import type { Annotation } from '../annotation/model';
import type { AnnotationMigrationPolicy, EditableScoreDocument, ValidationIssue } from './model';

export interface AnnotationMigrationResult {
  migrated: Annotation[];
  skipped: Array<{ annotationId: string; reason: string }>;
  issues: ValidationIssue[];
}

export function migrateAnnotationsForEditedScoreVersion(
  annotations: Annotation[],
  source: EditableScoreDocument,
  targetScoreVersionId: string,
  policy: AnnotationMigrationPolicy
): AnnotationMigrationResult {
  if (policy === 'NONE') {
    return {
      migrated: [],
      skipped: annotations.map((annotation) => ({ annotationId: annotation.id, reason: 'Migration policy is NONE.' })),
      issues: []
    };
  }

  const measureIds = new Set(source.parts.flatMap((part) => part.measures.map((measure) => measure.sourceMeasureId)));
  const migrated: Annotation[] = [];
  const skipped: AnnotationMigrationResult['skipped'] = [];

  annotations.forEach((annotation) => {
    if (annotation.anchor.type !== 'MEASURE') {
      skipped.push({ annotationId: annotation.id, reason: 'Only MEASURE anchors are migrated in Phase 6.' });
      return;
    }

    if (!measureIds.has(annotation.anchor.sourceMeasureId)) {
      skipped.push({ annotationId: annotation.id, reason: 'Target measure no longer exists.' });
      return;
    }

    migrated.push({
      ...annotation,
      id: `${annotation.id}:migrated:${targetScoreVersionId}`,
      scoreVersionId: targetScoreVersionId,
      serverRevision: undefined,
      syncState: 'PENDING'
    });
  });

  return {
    migrated,
    skipped,
    issues: skipped.map((entry) => ({
      code: 'ANNOTATION_MIGRATION_SKIPPED',
      severity: 'WARNING',
      message: entry.reason,
      blocking: false
    }))
  };
}
