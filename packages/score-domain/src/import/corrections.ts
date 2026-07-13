import { normalizeRect, splitRect, unionRects } from './geometry';
import type { ImportCorrection, ImportDetectionSnapshot, ImportRegion, ImportRegionId } from './model';

export function applyImportCorrections(snapshot: ImportDetectionSnapshot | null, corrections: ImportCorrection[]): ImportRegion[] {
  const initialRegions = snapshot?.regions ?? [];
  let regions = initialRegions.map((region) => ({ ...region, rect: normalizeRect(region.rect) }));

  for (const correction of corrections.sort((left, right) => left.createdAt - right.createdAt)) {
    const operation = correction.operation;

    switch (operation.type) {
      case 'ADD':
        regions = upsertRegion(regions, { ...operation.region, source: 'USER', rect: normalizeRect(operation.region.rect) });
        break;
      case 'UPDATE':
        regions = regions.map((region) =>
          region.id === operation.regionId
            ? {
                ...region,
                ...operation.patch,
                rect: operation.patch.rect ? normalizeRect(operation.patch.rect) : region.rect,
                source: 'USER'
              }
            : region
        );
        break;
      case 'DELETE':
        regions = deleteRegionWithChildren(regions, operation.regionId);
        break;
      case 'SPLIT':
        regions = splitRegion(regions, operation.regionId, operation.axis, operation.ratio, operation.firstId, operation.secondId);
        break;
      case 'MERGE':
        regions = mergeRegions(regions, operation.regionIds, operation.mergedId);
        break;
      case 'REORDER':
        regions = reorderRegions(regions, operation.orderedRegionIds);
        break;
      case 'RESET':
        regions = initialRegions.map((region) => ({ ...region, rect: normalizeRect(region.rect) }));
        break;
    }
  }

  return sortRegions(regions);
}

export function sortRegions(regions: ImportRegion[]): ImportRegion[] {
  return [...regions].sort((left, right) => {
    if (left.type !== right.type) {
      return typeRank(left.type) - typeRank(right.type);
    }
    if (left.parentId !== right.parentId) {
      return String(left.parentId ?? '').localeCompare(String(right.parentId ?? ''));
    }
    if (left.orderIndex !== right.orderIndex) {
      return left.orderIndex - right.orderIndex;
    }
    if (Math.abs(left.rect.y - right.rect.y) > 0.01) {
      return left.rect.y - right.rect.y;
    }
    return left.rect.x - right.rect.x;
  });
}

function upsertRegion(regions: ImportRegion[], next: ImportRegion): ImportRegion[] {
  const exists = regions.some((region) => region.id === next.id);
  return exists ? regions.map((region) => (region.id === next.id ? next : region)) : [...regions, next];
}

function deleteRegionWithChildren(regions: ImportRegion[], regionId: ImportRegionId): ImportRegion[] {
  const children = new Set(regions.filter((region) => region.parentId === regionId).map((region) => region.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const region of regions) {
      if (region.parentId && children.has(region.parentId) && !children.has(region.id)) {
        children.add(region.id);
        changed = true;
      }
    }
  }
  return regions.filter((region) => region.id !== regionId && !children.has(region.id));
}

function splitRegion(
  regions: ImportRegion[],
  regionId: ImportRegionId,
  axis: 'horizontal' | 'vertical',
  ratio: number,
  firstId: ImportRegionId,
  secondId: ImportRegionId
): ImportRegion[] {
  const target = regions.find((region) => region.id === regionId);
  if (!target) {
    return regions;
  }

  const [firstRect, secondRect] = splitRect(target.rect, axis, ratio);
  const first: ImportRegion = { ...target, id: firstId, rect: firstRect, source: 'USER' };
  const second: ImportRegion = { ...target, id: secondId, rect: secondRect, orderIndex: target.orderIndex + 1, source: 'USER' };
  return regions.filter((region) => region.id !== regionId).concat(first, second);
}

function mergeRegions(regions: ImportRegion[], regionIds: ImportRegionId[], mergedId: ImportRegionId): ImportRegion[] {
  const selected = regions.filter((region) => regionIds.includes(region.id));
  if (selected.length === 0) {
    return regions;
  }

  const first = selected[0];
  const merged: ImportRegion = {
    ...first,
    id: mergedId,
    rect: unionRects(selected.map((region) => region.rect)),
    orderIndex: Math.min(...selected.map((region) => region.orderIndex)),
    confidence: Math.min(...selected.map((region) => region.confidence)),
    source: 'USER'
  };

  return regions.filter((region) => !regionIds.includes(region.id)).concat(merged);
}

function reorderRegions(regions: ImportRegion[], orderedRegionIds: ImportRegionId[]): ImportRegion[] {
  const order = new Map(orderedRegionIds.map((id, index) => [id, index]));
  return regions.map((region) => (order.has(region.id) ? { ...region, orderIndex: order.get(region.id) ?? region.orderIndex } : region));
}

function typeRank(type: ImportRegion['type']) {
  return type === 'SYSTEM' ? 0 : type === 'STAFF' ? 1 : 2;
}
