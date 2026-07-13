import path from 'node:path';
import { aiRoot } from './lib/paths.mjs';
import { readJson } from './lib/io.mjs';

const taxonomy = await readJson(path.join(aiRoot, 'taxonomy/classes.json'));
const mapping = await readJson(path.join(aiRoot, 'mappings/deepscoresv2-to-cuenote.json'));
const symbolConfig = await readJson(path.join(aiRoot, 'configs/symbol/yolo_symbol_colab.json'));

const taxonomySymbols = new Set((taxonomy.tasks?.SYMBOL_DETECTION ?? []).map((klass) => klass.id));
const allowedSymbols = new Set(symbolConfig.classes ?? []);
const byAlias = buildAliasMap(mapping);
const failures = [];

const expectedMapped = [
  ['beam', 'beam'],
  ['ledgerLine', 'ledger.line'],
  ['repeatDot', 'dot.repeat'],
  ['rest16th', 'rest.16th'],
  ['rest32nd', 'rest.32nd'],
  ['rest64th', 'rest.64th'],
  ['flag8thUp', 'flag.eighth.up'],
  ['flag8thDown', 'flag.eighth.down'],
  ['noteheadWholeOnLine', 'notehead.whole'],
  ['noteheadWholeInSpace', 'notehead.whole'],
  ['timeSig4', 'time_signature.digit_4'],
  ['timeSigCommon', 'time_signature.common']
];

const expectedExcluded = [
  ['time_signature', 'generic time-signature group needs structure parsing'],
  ['key_signature', 'key-signature group needs later structure/text handling'],
  ['flag8th', 'directionless flag classes must not be guessed as up or down']
];

for (const [sourceClass, targetClass] of expectedMapped) {
  const row = byAlias.get(normalizeKey(sourceClass));
  check(Boolean(row), 'missing_mapping', `${sourceClass} is not mapped.`);
  check(row?.targetClassId === targetClass, 'wrong_mapping_target', `${sourceClass} should map to ${targetClass}, got ${row?.targetClassId ?? 'none'}.`);
  check(row?.mappingType !== 'EXCLUDED', 'unexpected_exclusion', `${sourceClass} must not be excluded.`);
  check(taxonomySymbols.has(targetClass), 'missing_taxonomy_class', `${targetClass} is missing from SYMBOL_DETECTION taxonomy.`);
  check(allowedSymbols.has(targetClass), 'missing_symbol_config_class', `${targetClass} is missing from symbol YOLO config classes.`);
}

for (const [sourceClass, reason] of expectedExcluded) {
  const row = byAlias.get(normalizeKey(sourceClass));
  check(Boolean(row), 'missing_exclusion', `${sourceClass} exclusion row is missing.`);
  check(row?.mappingType === 'EXCLUDED' || !row?.targetClassId, 'unsafe_mapping', `${sourceClass} should remain excluded: ${reason}.`);
}

if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}

console.log(`Phase 9I symbol coverage validation PASS (${expectedMapped.length} previously-unmapped classes now mapped, ${expectedExcluded.length} aggregate classes still excluded).`);

function buildAliasMap(mappingDocument) {
  const result = new Map();
  for (const row of mappingDocument.mappings ?? []) {
    for (const key of [row.sourceClassId, row.sourceClassName, ...(row.aliases ?? [])]) {
      if (key) {
        result.set(normalizeKey(key), row);
      }
    }
  }
  return result;
}

function normalizeKey(value) {
  return String(value).trim().toLowerCase().replaceAll(' ', '_').replaceAll('-', '_');
}

function check(condition, code, message) {
  if (!condition) {
    failures.push({ code, message });
  }
}
