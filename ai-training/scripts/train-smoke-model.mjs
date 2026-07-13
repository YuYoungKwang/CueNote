import path from 'node:path';
import { classIndexForTask, loadDataset, loadTaxonomy, normalizeBox } from './lib/dataset.mjs';
import { artifactsRoot, reportsRoot, taskSlug } from './lib/paths.mjs';
import { gitCommit, stableNow, writeJson, writeText } from './lib/io.mjs';

const task = parseTaskArg();
const slug = taskSlug(task);
const taxonomy = await loadTaxonomy();
const { manifest, items } = await loadDataset();
const classes = classIndexForTask(taxonomy, task);
const trainItems = items.filter((item) => item.task === task && item.split === 'train');
const validationItems = items.filter((item) => item.task === task && item.split === 'validation');

if (trainItems.length === 0 || validationItems.length === 0) {
  throw new Error(`Cannot train ${task} smoke model without train and validation fixture items.`);
}

const representative = validationItems[0];
const detections = representative.annotations
  .filter((annotation) => classes.some((klass) => klass.id === annotation.classId))
  .slice(0, task === 'LAYOUT_DETECTION' ? 10 : 14)
  .map((annotation) => {
    const klass = classes.find((candidate) => candidate.id === annotation.classId);
    return {
      classId: annotation.classId,
      classIndex: klass.index,
      confidence: 0.91,
      bounds: normalizeBox(annotation.bounds, representative.width, representative.height)
    };
  });

const spec = {
  schemaVersion: 1,
  modelId: `cuenote-${slug}-smoke`,
  modelVersion: '0.9.0-smoke.1',
  modelStatus: 'EXPERIMENTAL',
  task,
  architecture: 'deterministic-fixture-constant-detector',
  statusReason: 'Synthetic fixture smoke model for runtime validation only; no real scan/photo product accuracy claim.',
  datasetId: manifest.datasetId,
  datasetVersion: manifest.version,
  trainedAt: stableNow(),
  gitCommit: await gitCommit(path.resolve(process.cwd())),
  randomSeed: 90210,
  input: {
    width: 320,
    height: 160,
    channels: 1,
    tensorLayout: 'NCHW',
    resizeMode: 'LETTERBOX',
    valueRange: 'ZERO_TO_ONE'
  },
  output: {
    name: 'detections',
    format: 'BOX_XYWH_CONF_CLASS',
    coordinateSpace: 'SYSTEM_NORMALIZED',
    shape: [detections.length, 6]
  },
  classes,
  trainingData: {
    trainItems: trainItems.length,
    validationItems: validationItems.length,
    realScanItems: 0,
    syntheticItems: trainItems.length + validationItems.length
  },
  detections,
  reproducibility: {
    runtime: 'Node.js standard library smoke baseline',
    checkpointPolicy: 'No heavyweight checkpoint is committed. Smoke spec is reproducible from fixture dataset.',
    augmentationConfig: 'No random augmentation in smoke run; fixture geometry is deterministic.'
  }
};

await writeJson(path.join(artifactsRoot, `${slug}-smoke`, 'model-spec.json'), spec);
await writeText(
  path.join(reportsRoot, `${slug}-training.md`),
  `# ${task} Smoke Training\n\nStatus: PASS\n\nModel: ${spec.modelId}@${spec.modelVersion}\n\nArchitecture: ${spec.architecture}\n\nTraining items: ${trainItems.length}\n\nValidation items: ${validationItems.length}\n\nProduct candidate: NOT READY\n`
);
console.log(`Smoke training PASS for ${spec.modelId}.`);

function parseTaskArg() {
  const index = process.argv.indexOf('--task');
  const value = index >= 0 ? process.argv[index + 1] : '';
  if (value !== 'LAYOUT_DETECTION' && value !== 'SYMBOL_DETECTION') {
    throw new Error('Pass --task LAYOUT_DETECTION or --task SYMBOL_DETECTION.');
  }
  return value;
}
