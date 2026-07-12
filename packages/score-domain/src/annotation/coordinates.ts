import type { RelativePoint } from './model';

export interface RelativeBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ClientPoint {
  x: number;
  y: number;
}

export const DEFAULT_POINTER_PRESSURE = 0.5;

export function normalizePointerPressure(value: number | null | undefined, fallback = DEFAULT_POINTER_PRESSURE): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value) || value <= 0) {
    return clampPressure(fallback);
  }

  return clampPressure(value);
}

export function toRelativePoint(
  bounds: RelativeBounds,
  clientPoint: ClientPoint,
  pressure?: number | null,
  timeOffsetMs?: number
): RelativePoint {
  const width = Math.max(bounds.width, 1);
  const height = Math.max(bounds.height, 1);

  return {
    x: (clientPoint.x - bounds.left) / width,
    y: (clientPoint.y - bounds.top) / height,
    pressure: normalizePointerPressure(pressure),
    ...(timeOffsetMs == null ? {} : { timeOffsetMs })
  };
}

export function toClientPoint(bounds: RelativeBounds, point: RelativePoint): ClientPoint {
  return {
    x: bounds.left + bounds.width * point.x,
    y: bounds.top + bounds.height * point.y
  };
}

export function toRelativeRatio(value: number, total: number): number {
  const safeTotal = Math.max(total, 1);
  return value / safeTotal;
}

export function fromRelativeRatio(ratio: number, total: number): number {
  return ratio * total;
}

function clampPressure(value: number): number {
  return Math.max(0, Math.min(1, value));
}
