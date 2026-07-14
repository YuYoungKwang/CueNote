import fs from 'node:fs/promises';
import path from 'node:path';
import { aiRoot } from './lib/paths.mjs';

const notebookDir = path.join(aiRoot, 'notebooks');
const requiredPhrases = [
  'drive.mount',
  '14GB',
  '3GB',
  '/content/cuenote-phase9',
  'CUENOTE_RUN_MODE',
  'SYMBOL_OVERFIT',
  'SYMBOL_TILE_OVERFIT',
  'SYMBOL_TILE_TRAIN',
  'Runtime',
  'GPU',
  'phase9_colab_entry.py',
  'Run all',
  'checkpoint',
  'artifact'
];
const failures = [];
let notebooks = [];

try {
  notebooks = (await fs.readdir(notebookDir)).filter((name) => name.endsWith('.ipynb'));
} catch {
  failures.push({ code: 'missing_notebook_dir', message: 'ai-training/notebooks is missing.' });
}

for (const notebook of notebooks) {
  const fullPath = path.join(notebookDir, notebook);
  const value = JSON.parse(await fs.readFile(fullPath, 'utf8'));
  check(value.nbformat === 4, 'nbformat', `${notebook} must use nbformat 4.`);
  const joined = (value.cells ?? []).map((cell) => (cell.source ?? []).join('')).join('\n');
  for (const phrase of requiredPhrases) {
    check(joined.includes(phrase), 'required_cell_content', `${notebook} is missing ${phrase}.`);
  }
  const codeCellCount = (value.cells ?? []).filter((cell) => cell.cell_type === 'code').length;
  check(codeCellCount >= 4, 'code_cells', `${notebook} should have at least 4 code cells.`);
}

check(notebooks.includes('cuenote_phase9_colab.ipynb'), 'main_notebook', 'Main Phase 9 notebook is missing.');

if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log(`Notebook validation PASS (${notebooks.length} notebooks).`);

function check(condition, code, message) {
  if (!condition) {
    failures.push({ code, message });
  }
}
