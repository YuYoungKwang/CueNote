import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { aiRoot, repoRoot } from './lib/paths.mjs';
import { readJson, sha256File, writeJson } from './lib/io.mjs';

const model = process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : 'layout';
if (!['layout', 'symbol'].includes(model)) {
  throw new Error('Use --model layout or --model symbol.');
}

const artifactRoot = path.join(aiRoot, 'artifacts', `${model}-smoke-artifact`);
await fs.rm(artifactRoot, { recursive: true, force: true });
await fs.mkdir(artifactRoot, { recursive: true });
const modelRoot = path.join(repoRoot, 'web-app/public/models/omr');
const manifest = await readJson(path.join(modelRoot, `${model}-smoke-manifest.json`));
const onnx = path.join(modelRoot, `${model}-smoke.onnx`);
await fs.copyFile(path.join(modelRoot, `${model}-smoke-manifest.json`), path.join(artifactRoot, 'manifest.json'));
await fs.copyFile(path.join(aiRoot, 'reports', `${model}-smoke-evaluation.json`), path.join(artifactRoot, 'evaluation.json'));
await fs.copyFile(path.join(aiRoot, 'taxonomy/classes.json'), path.join(artifactRoot, 'taxonomy.json'));
await fs.copyFile(path.join(aiRoot, 'artifacts', `${model}-smoke`, 'model-spec.json'), path.join(artifactRoot, 'config.json'));
await fs.copyFile(onnx, path.join(artifactRoot, manifest.file));
await writeJson(path.join(artifactRoot, 'checksums.json'), {
  onnx: { file: manifest.file, sha256: await sha256File(onnx), sizeBytes: (await fs.stat(onnx)).size },
  manifest: { file: 'manifest.json', sha256: await sha256File(path.join(artifactRoot, 'manifest.json')), sizeBytes: (await fs.stat(path.join(artifactRoot, 'manifest.json'))).size },
  evaluation: { file: 'evaluation.json', sha256: await sha256File(path.join(artifactRoot, 'evaluation.json')), sizeBytes: (await fs.stat(path.join(artifactRoot, 'evaluation.json'))).size }
});

const zipPath = path.join(aiRoot, 'artifacts', `${model}-smoke-artifact.zip`);
await fs.rm(zipPath, { force: true });
const compressed = spawnSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${artifactRoot.replaceAll("'", "''")}\\*' -DestinationPath '${zipPath.replaceAll("'", "''")}' -Force`], { encoding: 'utf8' });
if (compressed.status !== 0) {
  throw new Error(compressed.stderr || compressed.stdout || 'Compress-Archive failed');
}
console.log(zipPath);
