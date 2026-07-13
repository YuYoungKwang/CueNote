import fs from 'node:fs/promises';
import path from 'node:path';
import { createConstantDetectionOnnx } from './lib/onnx-protobuf.mjs';
import { artifactsRoot, reportsRoot, taskSlug, webModelRoot } from './lib/paths.mjs';
import { readJson, sha256File, stableNow, writeJson, writeText } from './lib/io.mjs';

const task = parseTaskArg();
const slug = taskSlug(task);
const spec = await readJson(path.join(artifactsRoot, `${slug}-smoke`, 'model-spec.json'));
const onnxBytes = createConstantDetectionOnnx({
  inputName: 'system_crop',
  outputName: spec.output.name,
  detections: spec.detections
});

await fs.mkdir(webModelRoot, { recursive: true });
const onnxName = `${slug}-smoke.onnx`;
const onnxPath = path.join(webModelRoot, onnxName);
await fs.writeFile(onnxPath, onnxBytes);
const sha256 = await sha256File(onnxPath);
const sizeBytes = (await fs.stat(onnxPath)).size;
const manifest = {
  schemaVersion: 1,
  modelId: spec.modelId,
  version: spec.modelVersion,
  task,
  status: 'EXPERIMENTAL',
  file: onnxName,
  sha256,
  sizeBytes,
  input: spec.input,
  outputs: [
    {
      name: spec.output.name,
      format: spec.output.format,
      coordinateSpace: spec.output.coordinateSpace,
      shape: spec.output.shape
    }
  ],
  executionProviders: ['WEBGPU', 'WASM'],
  classes: spec.classes.map(({ id, index, displayName, blockingReview }) => ({
    id,
    index,
    label: displayName,
    blockingReview
  })),
  postprocessing: {
    confidenceThreshold: 0.4,
    nmsThreshold: 0.5,
    autoAcceptThreshold: 0.92,
    lowConfidenceThreshold: 0.55
  },
  datasetVersion: spec.datasetVersion,
  evaluationReport: `/ai-training/reports/${slug}-smoke-evaluation.json`,
  minimumAppVersion: '0.9.0',
  createdAt: stableNow(),
  fixtureDetector: true
};
const manifestPath = path.join(webModelRoot, `${slug}-smoke-manifest.json`);
await writeJson(manifestPath, manifest);

const evaluationPath = path.join(reportsRoot, `${slug}-smoke-evaluation.json`);
const evaluation = await readJson(evaluationPath);
evaluation.modelSize.fp32Bytes = sizeBytes;
evaluation.modelSize.fp16Bytes = 0;
evaluation.modelSize.int8Bytes = 0;
await writeJson(evaluationPath, evaluation);
await writeText(
  path.join(reportsRoot, `${slug}-onnx-export.md`),
  `# ${task} ONNX Export\n\nStatus: PASS\n\nModel file: web-app/public/models/omr/${onnxName}\n\nSize: ${sizeBytes} bytes\n\nSHA-256: ${sha256}\n\nManifest status: EXPERIMENTAL\n`
);
console.log(`Exported ${manifest.modelId} to ${onnxName} (${sizeBytes} bytes).`);

function parseTaskArg() {
  const index = process.argv.indexOf('--task');
  const value = index >= 0 ? process.argv[index + 1] : '';
  if (value !== 'LAYOUT_DETECTION' && value !== 'SYMBOL_DETECTION') {
    throw new Error('Pass --task LAYOUT_DETECTION or --task SYMBOL_DETECTION.');
  }
  return value;
}
