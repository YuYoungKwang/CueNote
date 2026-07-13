import { rectArea, rectContains } from './geometry';
import type { ImportDetectionSnapshot, ImportPage, ImportRegion, ImportValidationIssue } from './model';

export function validateImportRegions(page: ImportPage, regions: ImportRegion[]): ImportValidationIssue[] {
  const issues: ImportValidationIssue[] = [];
  const ids = new Set<string>();

  for (const region of regions) {
    if (ids.has(region.id)) {
      issues.push({
        code: 'INVALID_REGION',
        message: `Duplicate import region id: ${region.id}`,
        severity: 'error',
        pageId: page.id,
        regionId: region.id,
        blocking: true
      });
    }
    ids.add(region.id);

    if (rectArea(region.rect) <= 0) {
      issues.push({
        code: 'REGION_OUT_OF_BOUNDS',
        message: 'Region has no visible area.',
        severity: 'error',
        pageId: page.id,
        regionId: region.id,
        blocking: true
      });
    }

    if (region.rect.x < 0 || region.rect.y < 0 || region.rect.x + region.rect.width > 1 || region.rect.y + region.rect.height > 1) {
      issues.push({
        code: 'REGION_OUT_OF_BOUNDS',
        message: 'Region must stay in normalized page bounds.',
        severity: 'error',
        pageId: page.id,
        regionId: region.id,
        blocking: true
      });
    }

    if (region.parentId && !regions.some((candidate) => candidate.id === region.parentId)) {
      issues.push({
        code: 'PARENT_NOT_FOUND',
        message: `Parent region ${region.parentId} was not found.`,
        severity: 'error',
        pageId: page.id,
        regionId: region.id,
        blocking: true
      });
    }

    const parent = region.parentId ? regions.find((candidate) => candidate.id === region.parentId) : null;
    if (parent && !rectContains(parent.rect, region.rect)) {
      issues.push({
        code: 'INVALID_REGION',
        message: 'Child region must be inside its parent region.',
        severity: 'warning',
        pageId: page.id,
        regionId: region.id,
        blocking: false
      });
    }
  }

  if (!regions.some((region) => region.type === 'SYSTEM')) {
    issues.push({
      code: 'EMPTY_DETECTION',
      message: 'At least one system region is required before review can be completed.',
      severity: 'error',
      pageId: page.id,
      blocking: true
    });
  }

  if (!regions.some((region) => region.type === 'MEASURE')) {
    issues.push({
      code: 'EMPTY_DETECTION',
      message: 'At least one measure region is required before review can be completed.',
      severity: 'error',
      pageId: page.id,
      blocking: true
    });
  }

  return issues;
}

export function canCompleteImportReview(pages: ImportPage[], snapshotsByPageId: Map<string, ImportDetectionSnapshot | null>, effectiveRegionsByPageId: Map<string, ImportRegion[]>): ImportValidationIssue[] {
  const issues: ImportValidationIssue[] = [];

  for (const page of pages) {
    const snapshot = snapshotsByPageId.get(page.id) ?? null;
    const regions = effectiveRegionsByPageId.get(page.id) ?? [];
    if (!snapshot) {
      issues.push({
        code: 'REVIEW_INCOMPLETE',
        message: `Page ${page.pageIndex + 1} has not been detected yet.`,
        severity: 'error',
        pageId: page.id,
        blocking: true
      });
      continue;
    }
    issues.push(...validateImportRegions(page, regions));
  }

  return issues;
}
