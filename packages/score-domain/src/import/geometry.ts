import type { NormalizedPoint, NormalizedRect, PageDimensions } from './model';

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function normalizeRect(rect: NormalizedRect): NormalizedRect {
  const x1 = clampUnit(Math.min(rect.x, rect.x + rect.width));
  const y1 = clampUnit(Math.min(rect.y, rect.y + rect.height));
  const x2 = clampUnit(Math.max(rect.x, rect.x + rect.width));
  const y2 = clampUnit(Math.max(rect.y, rect.y + rect.height));

  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1)
  };
}

export function rectArea(rect: NormalizedRect): number {
  const normalized = normalizeRect(rect);
  return normalized.width * normalized.height;
}

export function rectContains(parent: NormalizedRect, child: NormalizedRect, tolerance = 0.002): boolean {
  const p = normalizeRect(parent);
  const c = normalizeRect(child);
  return (
    c.x >= p.x - tolerance &&
    c.y >= p.y - tolerance &&
    c.x + c.width <= p.x + p.width + tolerance &&
    c.y + c.height <= p.y + p.height + tolerance
  );
}

export function unionRects(rects: NormalizedRect[]): NormalizedRect {
  if (rects.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const normalized = rects.map(normalizeRect);
  const left = Math.min(...normalized.map((rect) => rect.x));
  const top = Math.min(...normalized.map((rect) => rect.y));
  const right = Math.max(...normalized.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...normalized.map((rect) => rect.y + rect.height));
  return normalizeRect({ x: left, y: top, width: right - left, height: bottom - top });
}

export function splitRect(rect: NormalizedRect, axis: 'horizontal' | 'vertical', ratio: number): [NormalizedRect, NormalizedRect] {
  const normalized = normalizeRect(rect);
  const safeRatio = Math.min(0.95, Math.max(0.05, ratio));

  if (axis === 'horizontal') {
    const firstHeight = normalized.height * safeRatio;
    return [
      normalizeRect({ ...normalized, height: firstHeight }),
      normalizeRect({ x: normalized.x, y: normalized.y + firstHeight, width: normalized.width, height: normalized.height - firstHeight })
    ];
  }

  const firstWidth = normalized.width * safeRatio;
  return [
    normalizeRect({ ...normalized, width: firstWidth }),
    normalizeRect({ x: normalized.x + firstWidth, y: normalized.y, width: normalized.width - firstWidth, height: normalized.height })
  ];
}

export function pixelRectToNormalized(rect: { x: number; y: number; width: number; height: number }, dimensions: PageDimensions): NormalizedRect {
  if (dimensions.width <= 0 || dimensions.height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  return normalizeRect({
    x: rect.x / dimensions.width,
    y: rect.y / dimensions.height,
    width: rect.width / dimensions.width,
    height: rect.height / dimensions.height
  });
}

export function normalizedRectToPixel(rect: NormalizedRect, dimensions: PageDimensions): { x: number; y: number; width: number; height: number } {
  const normalized = normalizeRect(rect);
  return {
    x: normalized.x * dimensions.width,
    y: normalized.y * dimensions.height,
    width: normalized.width * dimensions.width,
    height: normalized.height * dimensions.height
  };
}

export function pointInRect(point: NormalizedPoint, rect: NormalizedRect): boolean {
  const normalized = normalizeRect(rect);
  return point.x >= normalized.x && point.y >= normalized.y && point.x <= normalized.x + normalized.width && point.y <= normalized.y + normalized.height;
}
