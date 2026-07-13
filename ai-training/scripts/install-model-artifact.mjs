import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot, webModelRoot } from './lib/paths.mjs';
import { readJson, writeJson } from './lib/io.mjs';

const artifactPath = process.argv[2];
if (!artifactPath) {
  console.error('Usage: node ai-training/scripts/install-model-artifact.mjs <artifact-dir-or-zip>');
  process.exit(1);
}

const cleanup = [];
const root = await resolveArtifactRoot(artifactPath);
await validateArtifact(artifactPath);

const manifest = await readJson(path.join(root, 'manifest.json'));
const modelSource = path.join(root, manifest.file);
const targetDir = path.join(webModelRoot, 'installed', manifest.modelId, manifest.version);
await fs.mkdir(targetDir, { recursive: true });
const modelTarget = path.join(targetDir, manifest.file);
await fs.copyFile(modelSource, modelTarget);
const webManifest = {
  ...manifest,
  file: manifest.file,
  evaluationReport: 'evaluation.json'
};
await writeJson(path.join(targetDir, 'manifest.json'), webManifest);
await fs.copyFile(path.join(root, 'evaluation.json'), path.join(targetDir, 'evaluation.json'));
await fs.copyFile(path.join(root, 'taxonomy.json'), path.join(targetDir, 'taxonomy.json'));
await fs.copyFile(path.join(root, 'config.json'), path.join(targetDir, 'config.json'));
await fs.copyFile(path.join(root, 'checksums.json'), path.join(targetDir, 'checksums.json'));

const catalogPath = path.join(webModelRoot, 'model-catalog.json');
const catalog = await readJson(catalogPath);
const entry = {
  id: manifest.modelId,
  label: `${manifest.modelId} (${manifest.status})`,
  url: `/models/omr/installed/${manifest.modelId}/${manifest.version}/manifest.json`,
  builtIn: false
};
catalog.models = [...(catalog.models ?? []).filter((model) => model.id !== entry.id), entry];
await writeJson(catalogPath, catalog);

for (const dir of cleanup) {
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`Installed ${manifest.modelId}@${manifest.version} into web-app/public/models/omr/installed.`);

async function validateArtifact(input) {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'ai-training/scripts/validate-model-artifact.mjs'), input], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'artifact validation failed');
  }
}

async function resolveArtifactRoot(input) {
  const stat = await fs.stat(input);
  if (stat.isDirectory()) return path.resolve(input);
  const temp = path.join(os.tmpdir(), `cuenote-install-${Date.now()}`);
  await fs.mkdir(temp, { recursive: true });
  cleanup.push(temp);
  const expanded = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${path.resolve(input).replaceAll("'", "''")}' -DestinationPath '${temp.replaceAll("'", "''")}' -Force`], { encoding: 'utf8' });
  if (expanded.status !== 0) {
    throw new Error(`Could not expand zip artifact: ${expanded.stderr || expanded.stdout}`);
  }
  return temp;
}
