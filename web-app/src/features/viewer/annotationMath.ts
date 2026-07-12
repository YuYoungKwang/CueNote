import type { Annotation, RelativeBounds, RelativePoint, StrokePayload, TextAnnotationPayload } from '@cuenote/score-domain';

export interface ClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ClientPointLike {
  x: number;
  y: number;
}

export function getStrokeWidthPx(anchorBounds: RelativeBounds, widthRatio: number): number {
  return Math.max(2, Math.min(anchorBounds.width, anchorBounds.height) * widthRatio);
}

export function getTextRect(anchorBounds: RelativeBounds, payload: TextAnnotationPayload): ClientRectLike {
  return {
    left: anchorBounds.left + anchorBounds.width * payload.x,
    top: anchorBounds.top + anchorBounds.height * payload.y,
    width: anchorBounds.width * payload.width,
    height: anchorBounds.height * payload.height
  };
}

export function getTextFontSizePx(anchorBounds: RelativeBounds, payload: TextAnnotationPayload): number {
  return Math.max(12, anchorBounds.height * payload.fontSizeRatio);
}

export function hitTestAnnotation(
  annotation: Annotation,
  anchorBounds: RelativeBounds,
  clientPoint: ClientPointLike
): boolean {
  if (annotation.type === 'TEXT') {
    const rect = getTextRect(anchorBounds, annotation.payload);
    return hitTestRect(clientPoint, rect);
  }

  return hitTestStroke(annotation.payload, anchorBounds, clientPoint);
}

export function hitTestRect(point: ClientPointLike, rect: ClientRectLike): boolean {
  return point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height;
}

export function hitTestStroke(payload: StrokePayload, anchorBounds: RelativeBounds, clientPoint: ClientPointLike): boolean {
  const lineWidth = getStrokeWidthPx(anchorBounds, payload.widthRatio);
  const clientPoints = payload.points.map((point) => toStrokeClientPoint(anchorBounds, point));

  if (clientPoints.length === 1) {
    return distance(clientPoints[0], clientPoint) <= lineWidth;
  }

  for (let index = 1; index < clientPoints.length; index += 1) {
    const previous = clientPoints[index - 1];
    const current = clientPoints[index];

    if (distanceToSegment(clientPoint, previous, current) <= lineWidth) {
      return true;
    }
  }

  return false;
}

export function toStrokeClientPoint(anchorBounds: RelativeBounds, point: RelativePoint): ClientPointLike {
  return {
    x: anchorBounds.left + anchorBounds.width * point.x,
    y: anchorBounds.top + anchorBounds.height * point.y
  };
}

function distance(left: ClientPointLike, right: ClientPointLike): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function distanceToSegment(point: ClientPointLike, start: ClientPointLike, end: ClientPointLike): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (dx === 0 && dy === 0) {
    return distance(point, start);
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  const projection = {
    x: start.x + t * dx,
    y: start.y + t * dy
  };

  return distance(point, projection);
}
