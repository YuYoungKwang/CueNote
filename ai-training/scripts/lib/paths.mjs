import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export const aiRoot = path.resolve(here, '../..');
export const repoRoot = path.resolve(aiRoot, '..');
export const generatedRoot = path.join(aiRoot, 'generated');
export const fixtureDatasetRoot = path.join(generatedRoot, 'fixture-dataset');
export const reportsRoot = path.join(aiRoot, 'reports');
export const artifactsRoot = path.join(aiRoot, 'artifacts');
export const webModelRoot = path.join(repoRoot, 'web-app/public/models/omr');
export const taxonomyPath = path.join(aiRoot, 'taxonomy/classes.json');

export function taskSlug(task) {
  if (task === 'LAYOUT_DETECTION') return 'layout';
  if (task === 'SYMBOL_DETECTION') return 'symbol';
  throw new Error(`Unsupported task ${task}`);
}

export function parseTaskArg(argv = process.argv) {
  const index = argv.indexOf('--task');
  if (index < 0 || !argv[index + 1]) {
    throw new Error('Pass --task LAYOUT_DETECTION or --task SYMBOL_DETECTION.');
  }
  const task = argv[index + 1];
  if (task !== 'LAYOUT_DETECTION' && task !== 'SYMBOL_DETECTION') {
    throw new Error(`Unsupported task ${task}.`);
  }
  return task;
}
