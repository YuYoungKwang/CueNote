import fs from 'node:fs/promises';
import path from 'node:path';
import { DATASET_ID, DATASET_VERSION, GENERATOR_VERSION, flattenClasses, loadTaxonomy, splitGroups } from './lib/dataset.mjs';
import { ensureDir, sha256Buffer, sha256File, stableNow, writeJson, writeText } from './lib/io.mjs';
import { fixtureDatasetRoot } from './lib/paths.mjs';

const WIDTH = 512;
const HEIGHT = 256;

const taxonomy = await loadTaxonomy();
const groups = splitGroups();
const allClasses = flattenClasses(taxonomy);
const annotationRows = { LAYOUT_DETECTION: [], SYMBOL_DETECTION: [] };
const itemRefs = [];
const sources = [];

await fs.rm(fixtureDatasetRoot, { recursive: true, force: true });
await ensureDir(path.join(fixtureDatasetRoot, 'images'));
await ensureDir(path.join(fixtureDatasetRoot, 'annotations'));

for (const group of groups) {
  const source = createSource(group);
  sources.push(source);
  for (const task of ['LAYOUT_DETECTION', 'SYMBOL_DETECTION']) {
    const drawing = createDrawing(group, task);
    const imageReference = `images/${group.id}-${task === 'LAYOUT_DETECTION' ? 'layout' : 'symbol'}.ppm`;
    const imagePath = path.join(fixtureDatasetRoot, imageReference);
    await fs.writeFile(imagePath, drawing.ppm);
    const imageChecksum = await sha256File(imagePath);
    const item = {
      schemaVersion: 1,
      itemId: `${group.id}-${task === 'LAYOUT_DETECTION' ? 'layout' : 'symbol'}`,
      sourceGroupId: group.id,
      compositionId: group.compositionId,
      editionId: `${group.compositionId}-generated-edition`,
      originalDocumentId: `generated-${group.compositionId}`,
      syntheticTemplateId: group.template,
      split: group.split,
      imageReference,
      imageChecksum,
      width: WIDTH,
      height: HEIGHT,
      task,
      annotations: drawing.annotations,
      provenance: {
        sourceId: source.sourceId,
        sourceType: source.sourceType,
        license: source.license,
        generatedBy: GENERATOR_VERSION
      },
      quality: task === 'LAYOUT_DETECTION' ? ['CLEAN_SCAN', 'MULTI_STAFF'] : ['CLEAN_SCAN', 'DENSE_NOTATION'],
      preprocessing: {
        coordinateSpace: 'PIXEL_XYWH',
        augmentationSeed: seedFor(group.id, task),
        rotationDegrees: 0,
        contrast: 1,
        brightness: 1
      }
    };
    annotationRows[task].push(item);
    itemRefs.push({
      itemId: item.itemId,
      task,
      split: group.split,
      annotationFile: task === 'LAYOUT_DETECTION' ? 'annotations/layout.jsonl' : 'annotations/symbol.jsonl',
      imageReference
    });
  }
}

await writeText(
  path.join(fixtureDatasetRoot, 'annotations/layout.jsonl'),
  annotationRows.LAYOUT_DETECTION.map((item) => JSON.stringify(item)).join('\n') + '\n'
);
await writeText(
  path.join(fixtureDatasetRoot, 'annotations/symbol.jsonl'),
  annotationRows.SYMBOL_DETECTION.map((item) => JSON.stringify(item)).join('\n') + '\n'
);
await writeJson(path.join(fixtureDatasetRoot, 'sources.json'), sources);

const splitSummary = Object.fromEntries(['train', 'validation', 'test'].map((split) => {
  const splitItems = itemRefs.filter((item) => item.split === split);
  return [
    split,
    {
      itemCount: splitItems.length,
      sourceGroupIds: [...new Set(splitItems.map((item) => item.itemId.replace(/-(layout|symbol)$/, '')))].sort()
    }
  ];
}));
const byType = sources.reduce((acc, source) => {
  acc[source.sourceType] = (acc[source.sourceType] ?? 0) + 1;
  return acc;
}, {});
const byLicense = sources.reduce((acc, source) => {
  acc[source.license] = (acc[source.license] ?? 0) + 1;
  return acc;
}, {});
const manifestBodyForChecksum = JSON.stringify({ itemRefs, sources, allClasses });
const manifest = {
  schemaVersion: 1,
  datasetId: DATASET_ID,
  version: DATASET_VERSION,
  createdAt: stableNow(),
  itemCount: itemRefs.length,
  tasks: ['LAYOUT_DETECTION', 'SYMBOL_DETECTION'],
  classes: allClasses,
  splits: splitSummary,
  sourceSummary: {
    byType,
    sourceGroups: sources.length
  },
  licenseSummary: {
    trainingAllowed: sources.filter((source) => source.allowedForTraining).length,
    trainingExcluded: sources.filter((source) => !source.allowedForTraining).length,
    unknownOrRestricted: sources.filter((source) => source.license === 'UNKNOWN' || !source.allowedForTraining).length,
    byLicense
  },
  licensePolicy: {
    unknownExcludedByDefault: true,
    sourceLevelSplitRequired: true,
    allowedSourceTypes: ['SYNTHETIC', 'GENERATED_AUGMENTATION']
  },
  checksum: sha256Buffer(Buffer.from(manifestBodyForChecksum, 'utf8')),
  generatorVersion: GENERATOR_VERSION,
  validationResult: {
    status: 'NOT_RUN',
    report: 'reports/dataset-validation.json'
  },
  items: itemRefs,
  sources: ['sources.json']
};

await writeJson(path.join(fixtureDatasetRoot, 'manifest.json'), manifest);
console.log(`Built fixture dataset ${DATASET_ID}@${DATASET_VERSION} with ${itemRefs.length} items.`);

function createSource(group) {
  return {
    schemaVersion: 1,
    sourceId: `source-${group.id}`,
    sourceGroupId: group.id,
    sourceType: 'SYNTHETIC',
    sourceName: `CueNote generated ${group.compositionId}`,
    sourceUri: `internal://ai-training/${group.id}`,
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    copyrightHolder: 'CueNote generated fixture',
    allowedForTraining: true,
    allowedForRedistribution: true,
    allowedForDerivativeDataset: true,
    attributionRequired: false,
    collectedAt: stableNow(),
    notes: 'Generated from code-owned geometric score fixtures; no third-party score material.'
  };
}

function createDrawing(group, task) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const annotations = [];
  const staffTop = group.template === 'grand-staff' ? 56 : 78;
  const staffGap = 10;
  const left = 42;
  const right = 470;
  const barlines = [left, 164, 286, right];

  drawStaff(canvas, left, right, staffTop, staffGap);
  if (group.template === 'grand-staff') {
    drawStaff(canvas, left, right, staffTop + 82, staffGap);
  }
  for (const x of barlines) {
    drawLine(canvas, x, staffTop - 6, x, staffTop + staffGap * 4 + 6, [0, 0, 0]);
  }
  drawGroupMarker(canvas, group.id);

  if (task === 'LAYOUT_DETECTION') {
    annotations.push(label('system.region', 30, staffTop - 24, 456, group.template === 'grand-staff' ? 154 : 92));
    annotations.push(label('staff.region', left, staffTop - 3, right - left, staffGap * 4 + 6));
    if (group.template === 'grand-staff') {
      annotations.push(label('staff.region', left, staffTop + 79, right - left, staffGap * 4 + 6));
    }
    annotations.push(label('measure.region', left, staffTop - 12, 122, staffGap * 4 + 24));
    annotations.push(label('measure.region', 164, staffTop - 12, 122, staffGap * 4 + 24));
    annotations.push(label('measure.region', 286, staffTop - 12, 184, staffGap * 4 + 24));
    annotations.push(label('barline.single', left - 1, staffTop - 6, 3, staffGap * 4 + 12));
    annotations.push(label(group.template === 'repeat-end' ? 'barline.repeat_end' : 'barline.single', 163, staffTop - 6, 4, staffGap * 4 + 12));
    annotations.push(label(group.template === 'navigation' ? 'barline.double' : 'barline.single', 285, staffTop - 6, 4, staffGap * 4 + 12));
    annotations.push(label(group.template === 'repeat-end' ? 'barline.repeat_start' : 'barline.double', right - 2, staffTop - 6, 5, staffGap * 4 + 12));
  } else {
    drawSymbolFixture(canvas, annotations, staffTop, group.template);
  }

  return { ppm: canvasToPpm(canvas), annotations };
}

function drawSymbolFixture(canvas, annotations, staffTop, template) {
  drawTextBox(canvas, 54, staffTop - 10, 18, 48);
  annotations.push(label(template === 'grand-staff' ? 'clef.bass' : 'clef.treble', 52, staffTop - 12, 24, 54));
  const noteXs = [112, 156, 212, 258];
  noteXs.forEach((x, index) => {
    const y = staffTop + 30 - index * 5;
    drawRect(canvas, x, y, 14, 10, [0, 0, 0]);
    annotations.push(label(index === 1 ? 'notehead.hollow' : 'notehead.filled', x, y, 14, 10));
    drawLine(canvas, x + 13, y + 4, x + 13, y - 42, [0, 0, 0]);
    annotations.push(label('stem.up', x + 12, y - 42, 3, 46));
  });
  drawLine(canvas, 302, staffTop + 20, 302, staffTop + 60, [0, 0, 0]);
  annotations.push(label('stem.down', 301, staffTop + 20, 3, 42));
  annotations.push(label('rest.quarter', 330, staffTop + 8, 14, 28));
  drawTextBox(canvas, 330, staffTop + 8, 14, 28);
  annotations.push(label(template === 'rests' ? 'rest.eighth' : 'rest.half', 360, staffTop + 16, 20, 10));
  drawRect(canvas, 360, staffTop + 16, 20, 10, [0, 0, 0]);
  annotations.push(label('accidental.sharp', 88, staffTop + 10, 14, 28));
  drawTextBox(canvas, 88, staffTop + 10, 14, 28);
  annotations.push(label(template === 'scale' ? 'accidental.natural' : 'accidental.flat', 188, staffTop + 2, 12, 30));
  drawTextBox(canvas, 188, staffTop + 2, 12, 30);
  annotations.push(label('dot.augmentation', 278, staffTop + 21, 5, 5));
  drawRect(canvas, 278, staffTop + 21, 5, 5, [0, 0, 0]);
  annotations.push(label('tie', 118, staffTop + 50, 92, 12));
  drawLine(canvas, 118, staffTop + 56, 210, staffTop + 56, [0, 0, 0]);
  annotations.push(label(template === 'navigation' ? 'navigation.coda' : 'navigation.segno', 410, staffTop - 34, 24, 24));
  drawTextBox(canvas, 410, staffTop - 34, 24, 24);
  drawRect(canvas, 112, staffTop - 38, 160, 6, [0, 0, 0]);
  annotations.push(label('beam', 112, staffTop - 38, 160, 6));
  drawLine(canvas, 100, staffTop - 12, 138, staffTop - 12, [0, 0, 0]);
  annotations.push(label('ledger.line', 100, staffTop - 13, 38, 3));
  annotations.push(label('notehead.whole', 392, staffTop + 24, 18, 10));
  drawTextBox(canvas, 392, staffTop + 24, 18, 10);
  annotations.push(label('flag.eighth.up', 124, staffTop - 48, 14, 18));
  drawTextBox(canvas, 124, staffTop - 48, 14, 18);
  annotations.push(label('flag.eighth.down', 304, staffTop + 56, 14, 18));
  drawTextBox(canvas, 304, staffTop + 56, 14, 18);
  annotations.push(label('rest.16th', 348, staffTop - 22, 14, 22));
  annotations.push(label('rest.32nd', 368, staffTop - 24, 14, 24));
  annotations.push(label('rest.64th', 388, staffTop - 26, 14, 26));
  drawTextBox(canvas, 348, staffTop - 22, 14, 22);
  drawTextBox(canvas, 368, staffTop - 24, 14, 24);
  drawTextBox(canvas, 388, staffTop - 26, 14, 26);
  annotations.push(label('dot.repeat', 166, staffTop + 5, 5, 18));
  drawRect(canvas, 166, staffTop + 5, 5, 5, [0, 0, 0]);
  drawRect(canvas, 166, staffTop + 18, 5, 5, [0, 0, 0]);
  annotations.push(label('time_signature.digit_4', 78, staffTop + 4, 12, 18));
  annotations.push(label('time_signature.common', 94, staffTop + 4, 14, 18));
  drawTextBox(canvas, 78, staffTop + 4, 12, 18);
  drawTextBox(canvas, 94, staffTop + 4, 14, 18);
}

function label(classId, x, y, width, height) {
  return {
    id: `${classId}-${Math.round(x)}-${Math.round(y)}-${Math.round(width)}-${Math.round(height)}`,
    classId,
    bounds: { x, y, width, height },
    attributes: {},
    occluded: false,
    truncated: false,
    ignored: false,
    annotator: 'fixture-generator',
    reviewedBy: 'fixture-generator',
    reviewStatus: 'AUTO_GENERATED'
  };
}

function createCanvas(width, height) {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => [255, 255, 255]));
}

function drawStaff(canvas, left, right, top, gap) {
  for (let i = 0; i < 5; i += 1) {
    drawLine(canvas, left, top + i * gap, right, top + i * gap, [0, 0, 0]);
  }
}

function drawLine(canvas, x1, y1, x2, y2, color) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x1 + (x2 - x1) * (step / steps));
    const y = Math.round(y1 + (y2 - y1) * (step / steps));
    setPixel(canvas, x, y, color);
  }
}

function drawRect(canvas, x, y, width, height, color) {
  for (let yy = Math.max(0, y); yy < Math.min(canvas.length, y + height); yy += 1) {
    for (let xx = Math.max(0, x); xx < Math.min(canvas[0].length, x + width); xx += 1) {
      setPixel(canvas, xx, yy, color);
    }
  }
}

function drawTextBox(canvas, x, y, width, height) {
  drawRect(canvas, x, y, width, height, [30, 30, 30]);
  drawRect(canvas, x + 3, y + 3, Math.max(1, width - 6), Math.max(1, height - 6), [255, 255, 255]);
  drawLine(canvas, x, y, x + width, y + height, [30, 30, 30]);
}

function drawGroupMarker(canvas, groupId) {
  const seed = seedFor(groupId, 'marker');
  for (let i = 0; i < 12; i += 1) {
    if ((seed >> (i % 8)) & 1) {
      drawRect(canvas, 18 + i * 5, 226, 3, 3, [120, 120, 120]);
    }
  }
}

function setPixel(canvas, x, y, color) {
  if (canvas[y]?.[x]) {
    canvas[y][x] = color;
  }
}

function canvasToPpm(canvas) {
  const header = Buffer.from(`P6\n${canvas[0].length} ${canvas.length}\n255\n`, 'ascii');
  const pixels = Buffer.alloc(canvas[0].length * canvas.length * 3);
  let offset = 0;
  for (const row of canvas) {
    for (const [r, g, b] of row) {
      pixels[offset++] = r;
      pixels[offset++] = g;
      pixels[offset++] = b;
    }
  }
  return Buffer.concat([header, pixels]);
}

function seedFor(groupId, task) {
  return [...`${groupId}:${task}`].reduce((acc, char) => acc + char.charCodeAt(0), 0);
}
