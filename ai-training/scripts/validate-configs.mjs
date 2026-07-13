import fs from 'node:fs/promises';
import path from 'node:path';
import { aiRoot } from './lib/paths.mjs';
import { readJson } from './lib/io.mjs';

const failures = [];

await mustRead('configs/colab/phase9_colab.json', (config) => {
  check(config.defaultRunMode === 'SMOKE', 'colab_default_mode', 'Colab default run mode must be SMOKE.');
  check(config.runModes?.includes('SYMBOL_OVERFIT'), 'symbol_overfit_mode', 'Colab run modes must include SYMBOL_OVERFIT.');
  check(config.runModes?.includes('SYMBOL_TILE_OVERFIT'), 'symbol_tile_overfit_mode', 'Colab run modes must include SYMBOL_TILE_OVERFIT.');
  check(config.defaultDriveRoot.includes('/content/drive'), 'drive_root', 'Default Drive root must be under /content/drive.');
  check(config.assumedDriveCapacityGb === 14, 'drive_capacity', 'Colab policy must assume 14GB Google Drive capacity.');
  check(config.minimumFreeDriveGbBeforeTraining >= 3, 'drive_free_space', 'Training must require at least 3GB free Drive space.');
  check(config.scratchRoot?.startsWith('/content/'), 'scratch_root', 'Raw archives, cache, and runs must use Colab /content scratch storage.');
  check(!String(config.paths.raw).startsWith('datasets/'), 'raw_not_drive_dataset', 'Raw archives must not be stored under Drive datasets.');
  check(config.checkpointPolicy?.saveEveryEpoch === false, 'checkpoint_epoch_policy', 'Epoch checkpoints must not be saved without limit.');
  check(config.checkpointPolicy?.keepRecentCheckpointCount <= 1, 'checkpoint_recent_policy', 'Only the most recent epoch checkpoint may be retained.');
  check(config.datasetPolicy?.maxDenseImagesForColabSubset <= 500, 'dense_subset_size', 'Colab must start from a small DeepScoresV2 subset.');
  check(config.datasetPolicy?.maxDenseSourceGroupsForColabSubset <= 50, 'dense_source_group_subset', 'Colab must start from a small source-group subset.');
  check(config.overfitPolicy?.trainImageCount <= 2, 'overfit_tiny_subset', 'SYMBOL_OVERFIT must use at most two train images.');
  check(config.overfitPolicy?.batchSize === 1, 'overfit_batch', 'SYMBOL_OVERFIT batch size must be 1.');
  check(config.overfitPolicy?.epochs >= 100, 'overfit_epochs', 'SYMBOL_OVERFIT must run at least 100 epochs.');
  check(config.overfitPolicy?.earlyStoppingPatience === 0, 'overfit_patience', 'SYMBOL_OVERFIT must disable early stopping with patience 0.');
  check([512, 768, 1024].includes(config.tileOverfitPolicy?.cropSize), 'tile_crop_size', 'SYMBOL_TILE_OVERFIT crop size must be 512, 768, or 1024.');
  check(config.tileOverfitPolicy?.overlap >= 0.2 && config.tileOverfitPolicy?.overlap <= 0.3, 'tile_overlap', 'SYMBOL_TILE_OVERFIT overlap must be between 20% and 30%.');
  check(config.tileOverfitPolicy?.minCropCount >= 10 && config.tileOverfitPolicy?.maxCropCount <= 50, 'tile_crop_count', 'SYMBOL_TILE_OVERFIT must keep 10 to 50 crops.');
  check([2, 4].includes(config.tileOverfitPolicy?.batchSize), 'tile_batch', 'SYMBOL_TILE_OVERFIT batch size must be 2 or 4.');
  check(config.tileOverfitPolicy?.epochs >= 100, 'tile_epochs', 'SYMBOL_TILE_OVERFIT must run at least 100 epochs.');
  check(config.tileOverfitPolicy?.earlyStoppingPatience === 0, 'tile_patience', 'SYMBOL_TILE_OVERFIT must disable early stopping with patience 0.');
});

for (const file of ['configs/layout/yolo_layout_colab.json', 'configs/symbol/yolo_symbol_colab.json']) {
  await mustRead(file, (config) => {
    check(config.status === 'EXPERIMENTAL', 'config_status', `${file} must start as EXPERIMENTAL.`);
    check(config.framework === 'ultralytics-yolo', 'framework', `${file} must declare framework.`);
    check(Array.isArray(config.classes) && config.classes.length > 0, 'classes', `${file} must list classes.`);
    check(config.batchSize <= 8, 'batch_size', `${file} default batch is too large for free Colab.`);
    check(config.checkpointIntervalEpochs === -1, 'checkpoint_interval', `${file} must not save every epoch by default.`);
    check(config.savePeriodEpochs === -1 || config.keepRecentCheckpointCount <= 1, 'checkpoint_policy', `${file} must avoid unlimited epoch checkpoints.`);
  });
}

const taxonomy = await readJson(path.join(aiRoot, 'taxonomy/classes.json'));
const taxonomyClassIds = new Set(Object.values(taxonomy.tasks ?? {}).flat().map((klass) => klass.id));
await mustRead('configs/symbol/yolo_symbol_colab.json', (config) => {
  for (const classId of config.classes ?? []) {
    check(taxonomyClassIds.has(classId), 'symbol_class_taxonomy', `${classId} is not declared in taxonomy/classes.json.`);
  }
});

await mustRead('registry/dataset-sources.json', (registry) => {
  const sources = registry.sources ?? [];
  const deepscores = sources.find((source) => source.datasetId === 'deepscoresv2-dense');
  check(Boolean(deepscores), 'deepscores_source', 'DeepScoresV2 dense source is missing.');
  check(deepscores?.verificationStatus === 'VERIFIED', 'deepscores_verified', 'DeepScoresV2 dense must be VERIFIED.');
  check(deepscores?.licenseSpdx === 'CC-BY-4.0', 'deepscores_license', 'DeepScoresV2 dense license must be CC-BY-4.0.');
  for (const source of sources) {
    if (source.verificationStatus !== 'VERIFIED') {
      check(source.eligibility === 'EXCLUDED', 'unverified_excluded', `${source.datasetId} must be EXCLUDED while unverified.`);
    }
  }
});

await mustRead('mappings/deepscoresv2-to-cuenote.json', (mapping) => {
  const types = new Set((mapping.mappings ?? []).map((row) => row.mappingType));
  for (const type of ['EXACT', 'APPROXIMATE', 'MERGED', 'EXCLUDED']) {
    check(types.has(type), 'mapping_types', `Mapping must include ${type}.`);
  }
  for (const row of mapping.mappings ?? []) {
    if (row.targetClassId) {
      check(taxonomyClassIds.has(row.targetClassId), 'mapping_target_taxonomy', `${row.sourceClassId} maps to unknown taxonomy class ${row.targetClassId}.`);
    }
  }
});

if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log('Phase 9E-H configs/registry/mapping validation PASS.');

async function mustRead(relativePath, validate) {
  const fullPath = path.join(aiRoot, relativePath);
  try {
    validate(await readJson(fullPath));
  } catch (error) {
    failures.push({ code: 'read_failed', message: `${relativePath}: ${error instanceof Error ? error.message : String(error)}` });
  }
}

function check(condition, code, message) {
  if (!condition) {
    failures.push({ code, message });
  }
}
