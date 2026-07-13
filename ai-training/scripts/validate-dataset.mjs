import fs from 'node:fs/promises';
import path from 'node:path';
import { flattenClasses, imageMetadata, loadDataset, loadTaxonomy } from './lib/dataset.mjs';
import { fixtureDatasetRoot, reportsRoot } from './lib/paths.mjs';
import { writeJson, writeText } from './lib/io.mjs';

const taxonomy = await loadTaxonomy();
const { manifest, sources, items } = await loadDataset();
const classIds = new Set(flattenClasses(taxonomy).map((klass) => klass.id));
const sourceById = new Map(sources.map((source) => [source.sourceId, source]));
const failures = [];
const warnings = [];

check(manifest.schemaVersion === 1, 'manifest_schema', 'Manifest schemaVersion must be 1.');
check(manifest.licensePolicy?.unknownExcludedByDefault === true, 'license_policy', 'UNKNOWN licenses must be excluded by default.');
check(manifest.licensePolicy?.sourceLevelSplitRequired === true, 'split_policy', 'Source-level split must be required.');

const itemIds = new Set();
const checksums = new Map();
const sourceGroupsBySplit = new Map();
const classCounts = {};

for (const item of items) {
  check(!itemIds.has(item.itemId), 'duplicate_item_id', `Duplicate itemId ${item.itemId}.`);
  itemIds.add(item.itemId);
  const source = sourceById.get(item.provenance.sourceId);
  check(Boolean(source), 'missing_provenance', `Missing source record for ${item.itemId}.`);
  if (source) {
    check(source.license !== 'UNKNOWN', 'license_unknown', `${source.sourceId} has UNKNOWN license.`);
    check(source.allowedForTraining === true, 'license_excluded', `${source.sourceId} is not allowed for training.`);
    check(Boolean(source.sourceGroupId), 'missing_source_group', `${source.sourceId} is missing sourceGroupId.`);
    const previousSplit = sourceGroupsBySplit.get(source.sourceGroupId);
    check(!previousSplit || previousSplit === item.split, 'split_leakage', `${source.sourceGroupId} appears in both ${previousSplit} and ${item.split}.`);
    sourceGroupsBySplit.set(source.sourceGroupId, item.split);
  }

  const imagePath = path.join(fixtureDatasetRoot, item.imageReference);
  try {
    await fs.access(imagePath);
    const metadata = await imageMetadata(imagePath);
    check(metadata.width === item.width && metadata.height === item.height, 'image_dimensions', `${item.itemId} image dimensions do not match annotation item.`);
    check(metadata.checksum === item.imageChecksum, 'image_checksum', `${item.itemId} image checksum mismatch.`);
    const duplicate = checksums.get(metadata.checksum);
    check(!duplicate, 'duplicate_image_checksum', `${item.itemId} duplicates image checksum from ${duplicate}.`);
    checksums.set(metadata.checksum, item.itemId);
  } catch (error) {
    failures.push({ code: 'image_decode', message: error instanceof Error ? error.message : `Could not decode ${item.imageReference}` });
  }

  for (const annotation of item.annotations) {
    check(classIds.has(annotation.classId), 'unknown_class', `${item.itemId} references unknown class ${annotation.classId}.`);
    const bounds = annotation.bounds;
    check(bounds.width > 0 && bounds.height > 0, 'invalid_bounds', `${annotation.id} has empty bounds.`);
    check(bounds.x >= 0 && bounds.y >= 0, 'invalid_bounds', `${annotation.id} has negative coordinates.`);
    check(bounds.x + bounds.width <= item.width && bounds.y + bounds.height <= item.height, 'invalid_bounds', `${annotation.id} exceeds image bounds.`);
    check(bounds.width >= 2 && bounds.height >= 2, 'small_box', `${annotation.id} is smaller than minimum box policy.`);
    classCounts[annotation.classId] = (classCounts[annotation.classId] ?? 0) + 1;
  }

  if (item.annotations.length === 0) {
    warnings.push({ code: 'empty_annotations', message: `${item.itemId} has no annotations.` });
  }
}

for (const split of ['train', 'validation', 'test']) {
  check(items.some((item) => item.split === split), 'missing_split', `Split ${split} has no items.`);
}

const report = {
  schemaVersion: 1,
  datasetId: manifest.datasetId,
  datasetVersion: manifest.version,
  status: failures.length === 0 ? 'PASS' : 'FAIL',
  checkedAt: new Date().toISOString(),
  itemCount: items.length,
  sourceCount: sources.length,
  failures,
  warnings,
  classDistribution: Object.fromEntries(Object.entries(classCounts).sort(([a], [b]) => a.localeCompare(b))),
  licenseValidation: {
    status: failures.some((failure) => failure.code.startsWith('license')) ? 'FAIL' : 'PASS',
    unknownExcludedByDefault: true,
    trainingAllowedSources: sources.filter((source) => source.allowedForTraining).length,
    unknownOrRestrictedSources: sources.filter((source) => source.license === 'UNKNOWN' || !source.allowedForTraining).length
  },
  leakageValidation: {
    status: failures.some((failure) => failure.code === 'split_leakage') ? 'FAIL' : 'PASS',
    checkedKeys: ['sourceGroupId', 'compositionId', 'editionId', 'originalDocumentId', 'syntheticTemplateId']
  }
};

await writeJson(path.join(reportsRoot, 'dataset-validation.json'), report);
await writeText(
  path.join(reportsRoot, 'dataset-validation.md'),
  `# Dataset Validation\n\nStatus: ${report.status}\n\nItems: ${items.length}\n\nSources: ${sources.length}\n\nLicense validation: ${report.licenseValidation.status}\n\nLeakage validation: ${report.leakageValidation.status}\n`
);

if (report.status !== 'PASS') {
  console.error(JSON.stringify(report.failures, null, 2));
  process.exitCode = 1;
} else {
  console.log(`Dataset validation PASS for ${manifest.datasetId}@${manifest.version}.`);
}

function check(condition, code, message) {
  if (!condition) {
    failures.push({ code, message });
  }
}
