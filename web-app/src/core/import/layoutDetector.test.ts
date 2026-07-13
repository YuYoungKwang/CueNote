import { describe, expect, it } from 'vitest';
import { detectBaselineLayout } from './layoutDetector';

describe('detectBaselineLayout', () => {
  it('detects reviewable system, staff, and measure regions from a synthetic staff image', () => {
    const imageData = createSyntheticStaffImage();
    const result = detectBaselineLayout({ pageId: 'page-1', imageData });

    expect(result.regions.some((region) => region.type === 'SYSTEM')).toBe(true);
    expect(result.regions.some((region) => region.type === 'STAFF')).toBe(true);
    expect(result.regions.some((region) => region.type === 'MEASURE')).toBe(true);
    expect(result.regions.every((region) => region.rect.x >= 0 && region.rect.y >= 0 && region.rect.x + region.rect.width <= 1 && region.rect.y + region.rect.height <= 1)).toBe(
      true
    );
  });

  it('falls back to manual review regions when no staff is visible', () => {
    const imageData = createBlankImageData(200, 160);
    imageData.data.fill(255);
    const result = detectBaselineLayout({ pageId: 'blank', imageData });

    expect(result.warnings.map((warning) => warning.code)).toContain('NO_STAFF_FOUND');
    expect(result.regions.filter((region) => region.type === 'MEASURE')).toHaveLength(3);
  });
});

function createSyntheticStaffImage(): ImageData {
  const width = 320;
  const height = 220;
  const imageData = createBlankImageData(width, height);

  const putBlack = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    imageData.data[index] = 0;
    imageData.data[index + 1] = 0;
    imageData.data[index + 2] = 0;
    imageData.data[index + 3] = 255;
  };

  for (const y of [70, 78, 86, 94, 102]) {
    for (let x = 30; x < 290; x += 1) {
      putBlack(x, y);
    }
  }
  for (const x of [30, 120, 210, 290]) {
    for (let y = 66; y < 106; y += 1) {
      putBlack(x, y);
    }
  }

  return imageData;
}

function createBlankImageData(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}
