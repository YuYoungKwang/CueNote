import type {
  DurationValue,
  EditableEvent,
  EditableMeasure,
  EditableScoreDocument,
  EditCommand,
  EditHistoryState,
  IdGenerator
} from './model';
import { transposeChordSymbol, transposeKeySignature, transposePitch } from './transpose';
import { validateEditableScore } from './validation';

export function createEditHistory(document: EditableScoreDocument, maxHistory = 50): EditHistoryState {
  return {
    present: refreshValidation(document),
    past: [],
    future: [],
    maxHistory
  };
}

export function applyEditCommand(
  document: EditableScoreDocument,
  command: EditCommand,
  idGenerator: IdGenerator = defaultIdGenerator
): EditableScoreDocument {
  const next = cloneDocument(document);

  switch (command.type) {
    case 'CHANGE_PITCH':
      updateEvent(next, command.partId, command.measureId, command.eventId, (event) => {
        if (event.kind === 'NOTE') {
          event.pitch = command.pitch;
        }
      });
      break;
    case 'TRANSPOSE_EVENT':
      updateEvent(next, command.partId, command.measureId, command.eventId, (event) => {
        if (event.kind === 'NOTE') {
          event.pitch = transposePitch(event.pitch, command.semitones);
        }
      });
      break;
    case 'CHANGE_DURATION':
      updateEvent(next, command.partId, command.measureId, command.eventId, (event) => {
        event.duration = command.duration;
      });
      break;
    case 'CHANGE_CHORD':
      updateMeasure(next, command.partId, command.measureId, (measure) => {
        const index = measure.chordSymbols.findIndex((chord) => chord.id === command.chordId);
        if (index >= 0) {
          measure.chordSymbols[index] = { id: command.chordId, measureId: measure.id, ...command.chord };
        } else {
          measure.chordSymbols.push({ id: command.chordId, measureId: measure.id, ...command.chord });
        }
      });
      break;
    case 'CHANGE_LYRIC':
      updateMeasure(next, command.partId, command.measureId, (measure) => {
        let lyric = measure.lyrics.find((candidate) => candidate.id === command.lyricId);
        if (!lyric && command.eventId) {
          lyric = {
            id: command.lyricId,
            eventId: command.eventId,
            verse: '1',
            syllabic: command.syllabic ?? 'single',
            text: ''
          };
          measure.lyrics.push(lyric);
          const event = measure.events.find((candidate) => candidate.id === command.eventId);
          if (event?.kind === 'NOTE' && !event.lyricIds.includes(command.lyricId)) {
            event.lyricIds.push(command.lyricId);
          }
        }
        if (lyric) {
          lyric.text = command.text.trim().length === 0 ? '' : command.text;
          lyric.syllabic = command.syllabic ?? lyric.syllabic;
        }
      });
      break;
    case 'INSERT_MEASURE':
      insertMeasure(next, command.afterMeasureId, idGenerator);
      break;
    case 'DELETE_MEASURE':
      deleteMeasure(next, command.measureId);
      break;
    case 'DUPLICATE_MEASURE':
      duplicateMeasure(next, command.measureId, idGenerator);
      break;
    case 'TRANSPOSE_RANGE':
      transposeRange(next, command.semitones, command.partId, command.startMeasureId, command.endMeasureId);
      break;
  }

  return refreshValidation({ ...next, dirty: true, revision: next.revision + 1 });
}

export function dispatchEditCommand(
  history: EditHistoryState,
  command: EditCommand,
  idGenerator: IdGenerator = defaultIdGenerator
): EditHistoryState {
  const next = applyEditCommand(history.present, command, idGenerator);
  return {
    present: next,
    past: [...history.past, history.present].slice(-history.maxHistory),
    future: [],
    maxHistory: history.maxHistory
  };
}

export function undoEdit(history: EditHistoryState): EditHistoryState {
  const previous = history.past.at(-1);
  if (!previous) {
    return history;
  }
  return {
    present: previous,
    past: history.past.slice(0, -1),
    future: [history.present, ...history.future],
    maxHistory: history.maxHistory
  };
}

export function redoEdit(history: EditHistoryState): EditHistoryState {
  const next = history.future[0];
  if (!next) {
    return history;
  }
  return {
    present: next,
    past: [...history.past, history.present].slice(-history.maxHistory),
    future: history.future.slice(1),
    maxHistory: history.maxHistory
  };
}

export function refreshValidation(document: EditableScoreDocument): EditableScoreDocument {
  return { ...document, validationIssues: validateEditableScore(document) };
}

function insertMeasure(document: EditableScoreDocument, afterMeasureId: string | undefined, idGenerator: IdGenerator) {
  const insertIndex = findMeasureIndex(document, afterMeasureId);
  document.parts.forEach((part) => {
    const previous = part.measures[Math.max(0, insertIndex)];
    const attributes = previous?.attributes ?? { divisions: 1, timeSignature: { beats: 4, beatType: 4 } };
    const duration = expectedMeasureDuration(attributes.divisions, attributes.timeSignature);
    const measureId = `${document.scoreId}:${part.id}:edit-measure:${idGenerator('measure')}`;
    const measure: EditableMeasure = {
      id: measureId,
      sourceMeasureId: measureId,
      number: insertIndex + 2,
      attributes: clone(attributes),
      events: [
        {
          kind: 'REST',
          id: `${measureId}:event:${idGenerator('event')}`,
          duration: durationToValue(duration, attributes.divisions)
        }
      ],
      chordSymbols: [],
      lyrics: [],
      navigationMarks: []
    };
    part.measures.splice(insertIndex + 1, 0, measure);
    renumberMeasures(part.measures);
  });
}

function deleteMeasure(document: EditableScoreDocument, measureId: string) {
  if ((document.parts[0]?.measures.length ?? 0) <= 1) {
    return;
  }
  const deleteIndex = findMeasureIndex(document, measureId);
  document.parts.forEach((part) => {
    if (deleteIndex >= 0 && deleteIndex < part.measures.length) {
      part.measures.splice(deleteIndex, 1);
      renumberMeasures(part.measures);
    }
  });
}

function duplicateMeasure(document: EditableScoreDocument, measureId: string, idGenerator: IdGenerator) {
  const sourceIndex = findMeasureIndex(document, measureId);
  document.parts.forEach((part) => {
    const source = part.measures[sourceIndex];
    if (!source) {
      return;
    }
    const nextId = `${document.scoreId}:${part.id}:edit-measure:${idGenerator('measure')}`;
    const duplicate: EditableMeasure = {
      ...clone(source),
      id: nextId,
      sourceMeasureId: nextId,
      navigationMarks: [],
      events: source.events.map((event) => cloneEventWithNewId(event, nextId, idGenerator)),
      chordSymbols: source.chordSymbols.map((chord) => ({
        ...clone(chord),
        id: `${nextId}:chord:${idGenerator('chord')}`,
        measureId: nextId
      })),
      lyrics: []
    };
    const eventIdMap = new Map(source.events.map((event, index) => [event.id, duplicate.events[index].id]));
    duplicate.lyrics = source.lyrics.map((lyric) => ({
      ...clone(lyric),
      id: `${nextId}:lyric:${idGenerator('lyric')}`,
      eventId: eventIdMap.get(lyric.eventId) ?? duplicate.events[0]?.id ?? lyric.eventId
    }));
    for (const event of duplicate.events) {
      if (event.kind === 'NOTE') {
        event.lyricIds = duplicate.lyrics.filter((lyric) => lyric.eventId === event.id).map((lyric) => lyric.id);
      }
    }
    part.measures.splice(sourceIndex + 1, 0, duplicate);
    renumberMeasures(part.measures);
  });
}

function transposeRange(
  document: EditableScoreDocument,
  semitones: number,
  partId: string | undefined,
  startMeasureId: string | undefined,
  endMeasureId: string | undefined
) {
  document.parts
    .filter((part) => !partId || part.id === partId)
    .forEach((part) => {
      const startIndex = startMeasureId ? part.measures.findIndex((measure) => measure.id === startMeasureId) : 0;
      const endIndex = endMeasureId ? part.measures.findIndex((measure) => measure.id === endMeasureId) : part.measures.length - 1;
      part.measures.forEach((measure, index) => {
        if (index < Math.max(0, startIndex) || index > Math.max(0, endIndex)) {
          return;
        }
        measure.events.forEach((event) => {
          if (event.kind === 'NOTE') {
            event.pitch = transposePitch(event.pitch, semitones);
          }
        });
        measure.chordSymbols = measure.chordSymbols.map((chord) => transposeChordSymbol(chord, semitones));
        if (measure.attributes.keySignature) {
          measure.attributes.keySignature = {
            ...measure.attributes.keySignature,
            fifths: transposeKeySignature(measure.attributes.keySignature.fifths, semitones)
          };
        }
      });
    });
}

function updateEvent(document: EditableScoreDocument, partId: string, measureId: string, eventId: string, updater: (event: EditableEvent) => void) {
  updateMeasure(document, partId, measureId, (measure) => {
    const event = measure.events.find((candidate) => candidate.id === eventId);
    if (event) {
      updater(event);
    }
  });
}

function updateMeasure(document: EditableScoreDocument, partId: string, measureId: string, updater: (measure: EditableMeasure) => void) {
  const measure = document.parts.find((part) => part.id === partId)?.measures.find((candidate) => candidate.id === measureId);
  if (measure) {
    updater(measure);
  }
}

function findMeasureIndex(document: EditableScoreDocument, measureId: string | undefined): number {
  if (!measureId) {
    return -1;
  }
  const index = document.parts[0]?.measures.findIndex((measure) => measure.id === measureId || measure.sourceMeasureId === measureId) ?? -1;
  return index >= 0 ? index : (document.parts[0]?.measures.length ?? 1) - 1;
}

function renumberMeasures(measures: EditableMeasure[]) {
  measures.forEach((measure, index) => {
    measure.number = index + 1;
  });
}

function expectedMeasureDuration(divisions: number, timeSignature: { beats: number; beatType: number } | undefined): number {
  if (!timeSignature) {
    return divisions * 4;
  }
  return Math.max(1, Math.round(divisions * timeSignature.beats * (4 / timeSignature.beatType)));
}

function durationToValue(divisions: number, baseDivisions: number): DurationValue {
  if (divisions >= baseDivisions * 4) {
    return { divisions, type: 'whole', dotted: false };
  }
  if (divisions >= baseDivisions * 2) {
    return { divisions, type: 'half', dotted: false };
  }
  if (divisions <= Math.max(1, Math.round(baseDivisions / 4))) {
    return { divisions, type: '16th', dotted: false };
  }
  if (divisions <= Math.max(1, Math.round(baseDivisions / 2))) {
    return { divisions, type: 'eighth', dotted: false };
  }
  return { divisions, type: 'quarter', dotted: false };
}

function cloneEventWithNewId(event: EditableEvent, measureId: string, idGenerator: IdGenerator): EditableEvent {
  const next = clone(event);
  next.id = `${measureId}:event:${idGenerator('event')}`;
  if (next.kind === 'NOTE') {
    next.lyricIds = [];
  }
  return next;
}

function cloneDocument(document: EditableScoreDocument): EditableScoreDocument {
  return clone(document);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function defaultIdGenerator(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
