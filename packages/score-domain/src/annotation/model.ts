import type { PerformanceMeasureID, ScoreID, ScorePartID, ScoreVersionID, StableMeasureId } from '../model';

export type AnnotationID = string;
export type AnnotationSchemaVersion = 1;
export type AnnotationType = 'STROKE' | 'TEXT';
export type AnnotationScope = 'PRIVATE' | 'PART' | 'ENSEMBLE';
export type AnnotationTool = 'PEN' | 'HIGHLIGHTER';

export interface RelativePoint {
  x: number;
  y: number;
  pressure: number;
  timeOffsetMs?: number;
}

export interface MeasureAnchor {
  type: 'MEASURE';
  sourceMeasureId: StableMeasureId;
}

export interface ElementAnchor {
  type: 'ELEMENT';
  sourceMeasureId: StableMeasureId;
  sourceElementId: string;
}

export interface PerformanceMeasureAnchor {
  type: 'PERFORMANCE_MEASURE';
  performanceMeasureId: PerformanceMeasureID;
  sourceMeasureId: StableMeasureId;
}

export type AnnotationAnchor = MeasureAnchor | ElementAnchor | PerformanceMeasureAnchor;

export interface StrokePayload {
  tool: AnnotationTool;
  points: RelativePoint[];
  widthRatio: number;
  opacity: number;
  color: string;
}

export interface TextAnnotationPayload {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSizeRatio: number;
}

export interface BaseAnnotation {
  id: AnnotationID;
  schemaVersion: AnnotationSchemaVersion;
  scoreId: ScoreID;
  scoreVersionId: ScoreVersionID;
  type: AnnotationType;
  scope: AnnotationScope;
  anchor: AnnotationAnchor;
  createdAt: number;
  updatedAt: number;
  partId?: ScorePartID;
  localOwnerId?: string;
  deletedAt?: number;
  zIndex?: number;
}

export interface StrokeAnnotation extends BaseAnnotation {
  type: 'STROKE';
  payload: StrokePayload;
}

export interface TextAnnotation extends BaseAnnotation {
  type: 'TEXT';
  payload: TextAnnotationPayload;
}

export type Annotation = StrokeAnnotation | TextAnnotation;

export interface AnnotationValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateAnnotation(annotation: Annotation): AnnotationValidationResult {
  const errors: string[] = [];

  if (annotation.scope === 'PART' && !annotation.partId) {
    errors.push('PART scope annotations require partId.');
  }

  if (annotation.anchor.type === 'ELEMENT' && annotation.anchor.sourceElementId.trim().length === 0) {
    errors.push('ELEMENT anchors require sourceElementId.');
  }

  if (annotation.anchor.type === 'PERFORMANCE_MEASURE' && annotation.anchor.performanceMeasureId.trim().length === 0) {
    errors.push('PERFORMANCE_MEASURE anchors require performanceMeasureId.');
  }

  if (annotation.type === 'STROKE') {
    if (annotation.payload.points.length === 0) {
      errors.push('Stroke annotations require at least one point.');
    }

    if (!(annotation.payload.widthRatio > 0)) {
      errors.push('Stroke annotations require a positive widthRatio.');
    }
  }

  if (annotation.type === 'TEXT') {
    if (annotation.payload.text.trim().length === 0) {
      errors.push('Text annotations require non-empty text.');
    }

    if (!(annotation.payload.width > 0) || !(annotation.payload.height > 0)) {
      errors.push('Text annotations require positive width and height.');
    }

    if (!(annotation.payload.fontSizeRatio > 0)) {
      errors.push('Text annotations require a positive fontSizeRatio.');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
