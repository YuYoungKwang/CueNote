import type { Annotation, AnnotationScope } from './model';

export interface AnnotationLayerFilterState {
  privateVisible: boolean;
  partVisible: boolean;
  ensembleVisible: boolean;
}

export interface AnnotationVisibilityContext {
  filters: AnnotationLayerFilterState;
  currentPartId?: string | null;
  currentPerformanceMeasureId?: string | null;
}

export function filterVisibleAnnotations(annotations: Annotation[], context: AnnotationVisibilityContext): Annotation[] {
  return annotations.filter((annotation) => isAnnotationVisible(annotation, context));
}

export function isAnnotationVisible(annotation: Annotation, context: AnnotationVisibilityContext): boolean {
  if (annotation.deletedAt != null) {
    return false;
  }

  if (!isScopeVisible(annotation.scope, context.filters)) {
    return false;
  }

  if (annotation.scope === 'PART' && annotation.partId !== context.currentPartId) {
    return false;
  }

  if (annotation.anchor.type === 'PERFORMANCE_MEASURE') {
    return annotation.anchor.performanceMeasureId === context.currentPerformanceMeasureId;
  }

  return true;
}

function isScopeVisible(scope: AnnotationScope, filters: AnnotationLayerFilterState): boolean {
  switch (scope) {
    case 'PRIVATE':
      return filters.privateVisible;
    case 'PART':
      return filters.partVisible;
    case 'ENSEMBLE':
      return filters.ensembleVisible;
  }
}
