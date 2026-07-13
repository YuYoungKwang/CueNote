import { applyImportCorrections } from './corrections';
import type { ImportCorrection, ImportDetectionSnapshot, ImportPage, ImportProject, ImportSource, OmrPreparationManifest } from './model';
import { validateImportRegions } from './validation';

export function createOmrPreparationManifest(input: {
  project: ImportProject;
  source: ImportSource;
  pages: ImportPage[];
  snapshots: ImportDetectionSnapshot[];
  corrections: ImportCorrection[];
}): OmrPreparationManifest {
  const { storageKey, ...sourceWithoutStorageKey } = input.source;

  return {
    schemaVersion: 1,
    project: input.project,
    source: {
      ...sourceWithoutStorageKey,
      storageKeyRef: storageKey
    },
    pages: input.pages
      .slice()
      .sort((left, right) => left.pageIndex - right.pageIndex)
      .map((page) => {
        const detectionSnapshot = input.snapshots.find((snapshot) => snapshot.pageId === page.id) ?? null;
        const corrections = input.corrections.filter((correction) => correction.pageId === page.id);
        const effectiveRegions = applyImportCorrections(detectionSnapshot, corrections);
        return {
          page,
          detectionSnapshot,
          corrections,
          effectiveRegions,
          reviewComplete: validateImportRegions(page, effectiveRegions).filter((issue) => issue.blocking).length === 0
        };
      })
  };
}

export function validateOmrPreparationManifest(manifest: OmrPreparationManifest): string[] {
  const errors: string[] = [];

  if (manifest.schemaVersion !== 1) {
    errors.push('Unsupported OMR preparation manifest schema version.');
  }
  if (!manifest.project.id) {
    errors.push('Project id is required.');
  }
  if (manifest.pages.length !== manifest.project.pageCount) {
    errors.push('Project page count does not match manifest pages.');
  }

  for (const pageEntry of manifest.pages) {
    const blockingIssues = validateImportRegions(pageEntry.page, pageEntry.effectiveRegions).filter((issue) => issue.blocking);
    errors.push(...blockingIssues.map((issue) => issue.message));
  }

  return errors;
}
