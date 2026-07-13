import { describe, expect, it } from 'vitest';
import { createLetterboxTransform, systemRectToPageRect, tensorRectToSystemRect } from './coordinateMapper';

describe('OMR coordinate mapper', () => {
  it('removes letterbox padding before restoring system coordinates', () => {
    const transform = createLetterboxTransform(200, 100, 100, 100);
    const restored = tensorRectToSystemRect({ x: 0.25, y: 0.375, width: 0.5, height: 0.25 }, transform);
    expect(restored.x).toBeCloseTo(0.25);
    expect(restored.y).toBeCloseTo(0.25);
    expect(restored.width).toBeCloseTo(0.5);
    expect(restored.height).toBeCloseTo(0.5);
  });

  it('maps system coordinates back into canonical page coordinates', () => {
    const page = systemRectToPageRect({ x: 0.5, y: 0.25, width: 0.25, height: 0.5 }, { x: 0.1, y: 0.2, width: 0.8, height: 0.4 });
    expect(page.x).toBeCloseTo(0.5);
    expect(page.y).toBeCloseTo(0.3);
    expect(page.width).toBeCloseTo(0.2);
    expect(page.height).toBeCloseTo(0.2);
  });
});
