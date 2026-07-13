import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJson(file) {
  const text = await fs.readFile(file, 'utf8');
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

export async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeText(file, value) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, value, 'utf8');
}

export async function sha256File(file) {
  const bytes = await fs.readFile(file);
  return sha256Buffer(bytes);
}

export function sha256Buffer(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function stableNow() {
  return '2026-07-13T00:00:00.000Z';
}

export async function gitCommit(repoRoot) {
  try {
    const { execFile } = await import('node:child_process');
    return await new Promise((resolve) => {
      execFile('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot }, (error, stdout) => {
        resolve(error ? 'unknown' : stdout.trim());
      });
    });
  } catch {
    return 'unknown';
  }
}
