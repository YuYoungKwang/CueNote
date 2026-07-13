import { pixelRectToNormalized } from '@cuenote/score-domain';
import type { ImportRegion, ImportWarning } from '@cuenote/score-domain';

export const BASELINE_LAYOUT_DETECTOR_VERSION = 'baseline-layout-0.1.0';

interface RunDetectorInput {
  pageId: string;
  imageData: ImageData;
}

export interface LayoutDetectionResult {
  regions: ImportRegion[];
  warnings: ImportWarning[];
}

export function detectBaselineLayout(input: RunDetectorInput): LayoutDetectionResult {
  const { imageData, pageId } = input;
  const width = imageData.width;
  const height = imageData.height;
  const rowInk = new Float32Array(height);
  const columnInk = new Float32Array(width);
  const data = imageData.data;

  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const luminance = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
      if (luminance < 190) {
        row += 1;
        columnInk[x] += 1;
      }
    }
    rowInk[y] = row / width;
  }

  const staffBands = findBands(rowInk, 0.05, Math.max(2, Math.floor(height * 0.006)));
  const warnings: ImportWarning[] = [];
  if (staffBands.length === 0) {
    warnings.push({ code: 'NO_STAFF_FOUND', message: 'No staff-like dark row bands were found; fallback regions were created for manual review.', severity: 'warning' });
    const fallback = createFallbackLayout(pageId);
    return { regions: fallback.regions, warnings: [...warnings, ...fallback.warnings] };
  }

  const systems = groupBandsIntoSystems(staffBands, height);
  const measureCuts = findMeasureCuts(columnInk, width);
  const regions: ImportRegion[] = [];

  systems.forEach((system, systemIndex) => {
    const systemId = `${pageId}:system:${systemIndex + 1}`;
    const systemTop = Math.max(0, system.top - height * 0.035);
    const systemBottom = Math.min(height, system.bottom + height * 0.035);
    regions.push({
      id: systemId,
      type: 'SYSTEM',
      pageId,
      parentId: null,
      rect: pixelRectToNormalized({ x: width * 0.04, y: systemTop, width: width * 0.92, height: systemBottom - systemTop }, { width, height }),
      orderIndex: systemIndex,
      confidence: 0.62,
      source: 'DETECTED'
    });

    system.bands.forEach((band, staffIndex) => {
      const staffId = `${systemId}:staff:${staffIndex + 1}`;
      regions.push({
        id: staffId,
        type: 'STAFF',
        pageId,
        parentId: systemId,
        rect: pixelRectToNormalized({ x: width * 0.05, y: band.top - height * 0.01, width: width * 0.9, height: band.bottom - band.top + height * 0.02 }, { width, height }),
        orderIndex: staffIndex,
        confidence: 0.58,
        source: 'DETECTED'
      });
    });

    const cuts = measureCuts.length > 1 ? measureCuts : [Math.floor(width * 0.05), Math.floor(width * 0.36), Math.floor(width * 0.68), Math.floor(width * 0.95)];
    for (let index = 0; index < cuts.length - 1; index += 1) {
      const left = cuts[index];
      const right = cuts[index + 1];
      if (right - left < width * 0.06) {
        continue;
      }
      regions.push({
        id: `${systemId}:measure:${index + 1}`,
        type: 'MEASURE',
        pageId,
        parentId: systemId,
        rect: pixelRectToNormalized({ x: left, y: systemTop, width: right - left, height: systemBottom - systemTop }, { width, height }),
        orderIndex: index,
        confidence: 0.5,
        source: 'DETECTED'
      });
    }
  });

  if (regions.filter((region) => region.type === 'MEASURE').length === 0) {
    warnings.push({ code: 'NO_MEASURE_FOUND', message: 'Measure cuts were uncertain; manually add or split measure regions.', severity: 'warning' });
  }

  return { regions, warnings };
}

function findBands(values: Float32Array, threshold: number, minHeight: number): Array<{ top: number; bottom: number }> {
  const bands: Array<{ top: number; bottom: number }> = [];
  let start: number | null = null;

  for (let index = 0; index < values.length; index += 1) {
    if (values[index] >= threshold && start === null) {
      start = index;
    } else if ((values[index] < threshold || index === values.length - 1) && start !== null) {
      const end = index;
      if (end - start >= minHeight) {
        bands.push({ top: start, bottom: end });
      }
      start = null;
    }
  }

  return bands;
}

function groupBandsIntoSystems(bands: Array<{ top: number; bottom: number }>, height: number): Array<{ top: number; bottom: number; bands: Array<{ top: number; bottom: number }> }> {
  const systems: Array<{ top: number; bottom: number; bands: Array<{ top: number; bottom: number }> }> = [];
  const maxGap = height * 0.1;

  for (const band of bands) {
    const current = systems[systems.length - 1];
    if (!current || band.top - current.bottom > maxGap) {
      systems.push({ top: band.top, bottom: band.bottom, bands: [band] });
    } else {
      current.bottom = band.bottom;
      current.bands.push(band);
    }
  }

  return systems;
}

function findMeasureCuts(columnInk: Float32Array, width: number): number[] {
  const cuts = [Math.floor(width * 0.05)];
  const threshold = 0.18;
  let lastCut = cuts[0];

  for (let x = Math.floor(width * 0.08); x < width * 0.96; x += 1) {
    if (columnInk[x] / Math.max(1, Math.max(...columnInk)) > threshold && x - lastCut > width * 0.18) {
      cuts.push(x);
      lastCut = x;
    }
  }
  cuts.push(Math.floor(width * 0.95));

  return Array.from(new Set(cuts)).sort((left, right) => left - right);
}

function createFallbackLayout(pageId: string): LayoutDetectionResult {
  const systemId = `${pageId}:system:1`;
  return {
    regions: [
      {
        id: systemId,
        type: 'SYSTEM',
        pageId,
        parentId: null,
        rect: { x: 0.08, y: 0.2, width: 0.84, height: 0.24 },
        orderIndex: 0,
        confidence: 0.2,
        source: 'DETECTED'
      },
      {
        id: `${systemId}:staff:1`,
        type: 'STAFF',
        pageId,
        parentId: systemId,
        rect: { x: 0.1, y: 0.28, width: 0.8, height: 0.08 },
        orderIndex: 0,
        confidence: 0.2,
        source: 'DETECTED'
      },
      {
        id: `${systemId}:measure:1`,
        type: 'MEASURE',
        pageId,
        parentId: systemId,
        rect: { x: 0.1, y: 0.2, width: 0.27, height: 0.24 },
        orderIndex: 0,
        confidence: 0.2,
        source: 'DETECTED'
      },
      {
        id: `${systemId}:measure:2`,
        type: 'MEASURE',
        pageId,
        parentId: systemId,
        rect: { x: 0.37, y: 0.2, width: 0.27, height: 0.24 },
        orderIndex: 1,
        confidence: 0.2,
        source: 'DETECTED'
      },
      {
        id: `${systemId}:measure:3`,
        type: 'MEASURE',
        pageId,
        parentId: systemId,
        rect: { x: 0.64, y: 0.2, width: 0.26, height: 0.24 },
        orderIndex: 2,
        confidence: 0.2,
        source: 'DETECTED'
      }
    ],
    warnings: [{ code: 'FALLBACK_LAYOUT', message: 'Fallback layout regions were created for manual review.', severity: 'warning' }]
  };
}
