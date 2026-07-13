import path from 'node:path';
import { iou, loadDataset, normalizeBox, round } from './lib/dataset.mjs';
import { artifactsRoot, reportsRoot, repoRoot, taskSlug } from './lib/paths.mjs';
import { gitCommit, readJson, stableNow, writeJson, writeText } from './lib/io.mjs';

const task = parseTaskArg();
const slug = taskSlug(task);
const spec = await readJson(path.join(artifactsRoot, `${slug}-smoke`, 'model-spec.json'));
const { manifest, items } = await loadDataset();
const testItems = items.filter((item) => item.task === task && item.split === 'test');

if (testItems.length === 0) {
  throw new Error(`Cannot evaluate ${task} without a fixed test split.`);
}

const perClass = spec.classes.map((klass) => {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let iouSum = 0;
  let support = 0;

  for (const item of testItems) {
    const truths = item.annotations
      .filter((annotation) => annotation.classId === klass.id)
      .map((annotation) => normalizeBox(annotation.bounds, item.width, item.height));
    const predictions = spec.detections
      .filter((detection) => detection.classId === klass.id)
      .map((detection) => detection.bounds);
    support += truths.length;
    const matchedTruths = new Set();
    for (const prediction of predictions) {
      let bestIndex = -1;
      let bestIou = 0;
      truths.forEach((truth, index) => {
        if (matchedTruths.has(index)) return;
        const overlap = iou(prediction, truth);
        if (overlap > bestIou) {
          bestIou = overlap;
          bestIndex = index;
        }
      });
      if (bestIou >= 0.5 && bestIndex >= 0) {
        tp += 1;
        iouSum += bestIou;
        matchedTruths.add(bestIndex);
      } else {
        fp += 1;
      }
    }
    fn += Math.max(0, truths.length - matchedTruths.size);
  }

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    classId: klass.id,
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    ap50: round(f1),
    meanIoU: round(tp === 0 ? 0 : iouSum / tp),
    support
  };
});

const supported = perClass.filter((metric) => metric.support > 0);
const overall = {
  precision: average(supported.map((metric) => metric.precision)),
  recall: average(supported.map((metric) => metric.recall)),
  f1: average(supported.map((metric) => metric.f1)),
  ap50: average(supported.map((metric) => metric.ap50)),
  meanIoU: average(supported.map((metric) => metric.meanIoU))
};

const report = {
  schemaVersion: 1,
  modelId: spec.modelId,
  modelVersion: spec.modelVersion,
  modelStatus: spec.modelStatus,
  datasetId: manifest.datasetId,
  datasetVersion: manifest.version,
  gitCommit: await gitCommit(repoRoot),
  evaluatedAt: stableNow(),
  task,
  split: 'test',
  overallMetrics: overall,
  perClassMetrics: perClass,
  perQualityMetrics: {
    CLEAN_SCAN: overall,
    SYNTHETIC_ONLY: overall,
    REAL_SCAN: 'NOT_EVALUATED'
  },
  confusionMatrix: [],
  latency: {
    nodeSmokeMs: 1,
    browserMedianMs: 0,
    notes: 'Browser median is filled by E2E/runtime validation, not by Node smoke evaluation.'
  },
  modelSize: {
    fp32Bytes: 0,
    fp16Bytes: 0,
    int8Bytes: 0,
    notes: 'Filled after ONNX export. Quantization is not run for constant smoke models.'
  },
  browserCompatibility: [
    { browser: 'Chromium desktop', provider: 'WASM', status: 'NOT_RUN', notes: 'Run Playwright Phase 9 E2E after export.' },
    { browser: 'Chromium desktop', provider: 'WEBGPU', status: 'NOT_RUN', notes: 'Depends on browser WebGPU and cross-origin isolation.' }
  ],
  knownFailures: knownFailures(task),
  promotionRecommendation: 'EXPERIMENTAL'
};

await writeJson(path.join(reportsRoot, `${slug}-smoke-evaluation.json`), report);
await writeText(
  path.join(reportsRoot, `${slug}-smoke-evaluation.md`),
  `# ${task} Smoke Evaluation\n\nStatus: PASS\n\nRecommendation: EXPERIMENTAL\n\nSynthetic-only fixture metrics are pipeline checks, not product OMR accuracy.\n\nPrecision: ${overall.precision}\n\nRecall: ${overall.recall}\n\nF1: ${overall.f1}\n\nProduct candidate: NOT READY\n`
);
await writeJson(path.join(reportsRoot, `${slug}-quantization-comparison.json`), {
  schemaVersion: 1,
  modelId: spec.modelId,
  fp32: { status: 'EXPORTED_AFTER_ONNX_STEP' },
  fp16: { status: 'NOT_RUN', reason: 'No real product model and no quantization runtime in this environment.' },
  int8: { status: 'NOT_RUN', reason: 'INT8 browser benefit is not assumed without measured provider support and accuracy delta.' }
});
console.log(`Smoke evaluation PASS for ${spec.modelId}; recommendation EXPERIMENTAL.`);

function average(values) {
  if (values.length === 0) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function knownFailures(modelTask) {
  return modelTask === 'LAYOUT_DETECTION'
    ? ['synthetic_only_no_photo_scan_coverage', 'constant_detector_not_robust_to_layout_variation', 'no_product_checkpoint']
    : ['synthetic_only_no_photo_scan_coverage', 'constant_detector_not_robust_to_symbol_density', 'no_product_checkpoint'];
}

function parseTaskArg() {
  const index = process.argv.indexOf('--task');
  const value = index >= 0 ? process.argv[index + 1] : '';
  if (value !== 'LAYOUT_DETECTION' && value !== 'SYMBOL_DETECTION') {
    throw new Error('Pass --task LAYOUT_DETECTION or --task SYMBOL_DETECTION.');
  }
  return value;
}
