import fs from 'node:fs/promises';
import path from 'node:path';
import { aiRoot } from './lib/paths.mjs';
import { readJson } from './lib/io.mjs';

const failures = [];

await mustRead('configs/colab/phase9_colab.json', (config) => {
  check(config.defaultRunMode === 'SMOKE', 'colab_default_mode', 'Colab default run mode must be SMOKE.');
  check(config.defaultDriveRoot.includes('/content/drive'), 'drive_root', 'Default Drive root must be under /content/drive.');
});

for (const file of ['configs/layout/yolo_layout_colab.json', 'configs/symbol/yolo_symbol_colab.json']) {
  await mustRead(file, (config) => {
    check(config.status === 'EXPERIMENTAL', 'config_status', `${file} must start as EXPERIMENTAL.`);
    check(config.framework === 'ultralytics-yolo', 'framework', `${file} must declare framework.`);
    check(Array.isArray(config.classes) && config.classes.length > 0, 'classes', `${file} must list classes.`);
    check(config.batchSize <= 8, 'batch_size', `${file} default batch is too large for free Colab.`);
  });
}

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
  for (const type of ['EXACT', 'APPROXIMATE', 'EXCLUDED']) {
    check(types.has(type), 'mapping_types', `Mapping must include ${type}.`);
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
