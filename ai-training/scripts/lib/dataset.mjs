import fs from 'node:fs/promises';
import path from 'node:path';
import { fixtureDatasetRoot, taxonomyPath } from './paths.mjs';
import { readJson, sha256File } from './io.mjs';

export const DATASET_ID = 'cuenote-fixture-omr';
export const DATASET_VERSION = 'phase9-smoke-1';
export const GENERATOR_VERSION = 'phase9-node-fixture-v1';

export function flattenClasses(taxonomy) {
  return Object.entries(taxonomy.tasks).flatMap(([task, classes]) =>
    classes.map((klass) => ({ ...klass, task }))
  );
}

export async function loadTaxonomy() {
  return readJson(taxonomyPath);
}

export async function loadDataset() {
  const manifest = await readJson(path.join(fixtureDatasetRoot, 'manifest.json'));
  const sources = await readJson(path.join(fixtureDatasetRoot, 'sources.json'));
  const items = [];
  for (const item of manifest.items) {
    const annotationPath = path.join(fixtureDatasetRoot, item.annotationFile);
    const rows = (await fs.readFile(annotationPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
    const match = rows.map((row) => JSON.parse(row)).find((row) => row.itemId === item.itemId);
    if (!match) {
      throw new Error(`Missing annotation item ${item.itemId}`);
    }
    items.push(match);
  }
  return { manifest, sources, items };
}

export function splitGroups() {
  return [
    { id: 'fixture-train-alpha', split: 'train', compositionId: 'fixture-minuet', template: 'single-system' },
    { id: 'fixture-train-beta', split: 'train', compositionId: 'fixture-hymn', template: 'grand-staff' },
    { id: 'fixture-train-gamma', split: 'train', compositionId: 'fixture-repeat', template: 'repeat-end' },
    { id: 'fixture-validation-delta', split: 'validation', compositionId: 'fixture-coda', template: 'navigation' },
    { id: 'fixture-test-epsilon', split: 'test', compositionId: 'fixture-scale', template: 'scale' },
    { id: 'fixture-test-zeta', split: 'test', compositionId: 'fixture-rests', template: 'rests' }
  ];
}

export function classIndexForTask(taxonomy, task) {
  return taxonomy.tasks[task].map((klass, index) => ({
    ...klass,
    index,
    blockingReview: task === 'LAYOUT_DETECTION'
  }));
}

export function normalizeBox(bounds, width, height) {
  return {
    x: round(bounds.x / width),
    y: round(bounds.y / height),
    width: round(bounds.width / width),
    height: round(bounds.height / height)
  };
}

export function iou(a, b) {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const intersection = iw * ih;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union <= 0 ? 0 : intersection / union;
}

export async function imageMetadata(imagePath) {
  const text = await fs.readFile(imagePath, 'utf8');
  const match = /^P[36]\s+(\d+)\s+(\d+)\s+255\s/.exec(text);
  if (!match) {
    throw new Error(`Unsupported fixture image format ${imagePath}`);
  }
  return {
    width: Number(match[1]),
    height: Number(match[2]),
    checksum: await sha256File(imagePath)
  };
}

export function round(value, digits = 6) {
  return Number(value.toFixed(digits));
}
