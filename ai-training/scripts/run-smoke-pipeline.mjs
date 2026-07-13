import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const steps = [
  ['build fixture dataset', ['scripts/build-fixture-dataset.mjs']],
  ['validate dataset', ['scripts/validate-dataset.mjs']],
  ['train layout smoke model', ['scripts/train-smoke-model.mjs', '--task', 'LAYOUT_DETECTION']],
  ['evaluate layout smoke model', ['scripts/evaluate-smoke-model.mjs', '--task', 'LAYOUT_DETECTION']],
  ['export layout ONNX', ['scripts/export-onnx.mjs', '--task', 'LAYOUT_DETECTION']],
  ['train symbol smoke model', ['scripts/train-smoke-model.mjs', '--task', 'SYMBOL_DETECTION']],
  ['evaluate symbol smoke model', ['scripts/evaluate-smoke-model.mjs', '--task', 'SYMBOL_DETECTION']],
  ['export symbol ONNX', ['scripts/export-onnx.mjs', '--task', 'SYMBOL_DETECTION']],
  ['validate ONNX manifests', ['scripts/validate-onnx.mjs']]
];

for (const [label, args] of steps) {
  console.log(`\n> ${label}`);
  const result = spawnSync(process.execPath, args, {
    cwd: aiRoot,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('\nPhase 9 AI smoke pipeline PASS.');
