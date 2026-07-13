import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJson } from './lib/io.mjs';

const artifactPath = process.argv[2];
if (!artifactPath) {
  console.error('Usage: node ai-training/scripts/validate-model-artifact.mjs <artifact-dir-or-zip>');
  process.exit(1);
}

const cleanup = [];
const root = await resolveArtifactRoot(artifactPath);
const failures = [];
const required = ['manifest.json', 'evaluation.json', 'taxonomy.json', 'config.json', 'checksums.json'];
for (const file of required) {
  await exists(path.join(root, file), 'missing_file', `${file} missing`);
}

const manifest = await safeJson(path.join(root, 'manifest.json'));
const checksums = await safeJson(path.join(root, 'checksums.json'));
if (manifest) {
  check(['EXPERIMENTAL', 'CANDIDATE', 'PRODUCT'].includes(manifest.status), 'invalid_status', 'Manifest status must be EXPERIMENTAL/CANDIDATE/PRODUCT.');
  check(manifest.file && !path.isAbsolute(manifest.file), 'invalid_model_file', 'Manifest file must be relative.');
  check(manifest.modelId && manifest.version && manifest.task, 'manifest_identity', 'Manifest must include modelId, version, task.');
  check(manifest.modelId && !manifest.modelId.endsWith('-smoke') || manifest.status === 'EXPERIMENTAL', 'smoke_promotion', 'Smoke model cannot be promoted.');
  if (manifest.file) {
    const modelPath = path.join(root, manifest.file);
    await exists(modelPath, 'missing_model', `${manifest.file} missing`);
    if (await fileExists(modelPath)) {
      const digest = await sha256File(modelPath);
      check(manifest.sha256 === digest, 'manifest_hash', 'Manifest sha256 does not match model file.');
      check(manifest.sizeBytes === (await fs.stat(modelPath)).size, 'manifest_size', 'Manifest sizeBytes does not match model file.');
      if (checksums?.onnx?.sha256) {
        check(checksums.onnx.sha256 === digest, 'checksum_hash', 'checksums.json ONNX sha256 mismatch.');
      }
    }
  }
}

for (const dir of cleanup) {
  await fs.rm(dir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log('Model artifact validation PASS.');

async function resolveArtifactRoot(input) {
  const stat = await fs.stat(input);
  if (stat.isDirectory()) return path.resolve(input);
  const temp = path.join(os.tmpdir(), `cuenote-artifact-${Date.now()}`);
  await fs.mkdir(temp, { recursive: true });
  cleanup.push(temp);
  const expanded = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${path.resolve(input).replaceAll("'", "''")}' -DestinationPath '${temp.replaceAll("'", "''")}' -Force`], { encoding: 'utf8' });
  if (expanded.status !== 0) {
    throw new Error(`Could not expand zip artifact: ${expanded.stderr || expanded.stdout}`);
  }
  return temp;
}

async function safeJson(file) {
  try {
    return await readJson(file);
  } catch (error) {
    failures.push({ code: 'invalid_json', message: `${file}: ${error instanceof Error ? error.message : String(error)}` });
    return null;
  }
}

async function exists(file, code, message) {
  if (!(await fileExists(file))) {
    failures.push({ code, message });
  }
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(await fs.readFile(file));
  return hash.digest('hex');
}

function check(condition, code, message) {
  if (!condition) {
    failures.push({ code, message });
  }
}
