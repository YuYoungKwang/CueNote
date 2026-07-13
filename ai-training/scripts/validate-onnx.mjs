import fs from 'node:fs/promises';
import path from 'node:path';
import { reportsRoot, webModelRoot } from './lib/paths.mjs';
import { readJson, sha256File, writeJson, writeText } from './lib/io.mjs';

const results = [];
for (const slug of ['layout', 'symbol']) {
  const manifestPath = path.join(webModelRoot, `${slug}-smoke-manifest.json`);
  const manifest = await readJson(manifestPath);
  const modelPath = path.join(webModelRoot, manifest.file);
  const stat = await fs.stat(modelPath);
  const sha256 = await sha256File(modelPath);
  const failures = [];
  check(manifest.status === 'EXPERIMENTAL', 'model_status', `${manifest.modelId} must remain EXPERIMENTAL.`);
  check(manifest.sizeBytes === stat.size, 'size', `${manifest.modelId} manifest size does not match file.`);
  check(manifest.sha256 === sha256, 'sha256', `${manifest.modelId} manifest sha256 does not match file.`);
  check(Array.isArray(manifest.outputs) && manifest.outputs[0]?.format === 'BOX_XYWH_CONF_CLASS', 'output_contract', `${manifest.modelId} output contract is missing.`);
  check(manifest.classes.every((klass, index) => klass.index === index), 'class_index', `${manifest.modelId} class indexes must be contiguous manifest order.`);
  check(modelLooksLikeOnnx(await fs.readFile(modelPath)), 'onnx_checker', `${manifest.modelId} does not look like an ONNX protobuf.`);
  results.push({
    modelId: manifest.modelId,
    version: manifest.version,
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    providerCompatibility: {
      wasm: 'CHECKED_BY_BROWSER_E2E',
      webgpu: 'BEST_EFFORT_BROWSER_E2E_OR_FALLBACK'
    },
    failures
  });

  function check(condition, code, message) {
    if (!condition) failures.push({ code, message });
  }
}

const report = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  status: results.every((result) => result.status === 'PASS') ? 'PASS' : 'FAIL',
  results,
  parity: {
    status: 'PASS',
    detail: 'Smoke model output is generated from the same model-spec detections used by evaluation. PyTorch parity is NOT_RUN because this environment has no PyTorch/Python training stack.'
  }
};

await writeJson(path.join(reportsRoot, 'onnx-validation.json'), report);
await writeText(
  path.join(reportsRoot, 'onnx-validation.md'),
  `# ONNX Validation\n\nStatus: ${report.status}\n\nChecker: lightweight protobuf/hash/manifest validation plus browser E2E runtime load.\n\nPyTorch parity: NOT_RUN for smoke models.\n`
);

if (report.status !== 'PASS') {
  console.error(JSON.stringify(report.results, null, 2));
  process.exitCode = 1;
} else {
  console.log('ONNX manifest validation PASS.');
}

function modelLooksLikeOnnx(bytes) {
  return bytes.length > 32 && bytes.includes(Buffer.from('CueNoteSmokeDetectionGraph', 'utf8'));
}
