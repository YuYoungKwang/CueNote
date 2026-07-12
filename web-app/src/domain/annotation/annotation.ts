export interface AnnotationStroke {
  id: string;
  pageId: string;
  points: Array<{ x: number; y: number }>;
  color: string;
}
