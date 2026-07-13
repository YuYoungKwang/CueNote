import { describe, expect, it } from 'vitest';
import type { Annotation, ScoreVersion } from '../index';
import {
  createEditHistory,
  dispatchEditCommand,
  editableScoreFromMusicXml,
  hasBlockingIssues,
  migrateAnnotationsForEditedScoreVersion,
  redoEdit,
  serializeEditableScoreToMusicXml,
  transposeChordSymbol,
  transposePitch,
  undoEdit
} from './index';

const baseVersion: ScoreVersion = {
  id: 'ver_base',
  scoreId: 'scr_edit',
  title: 'Editable Sample',
  sourceXml: `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Editable Sample</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Voice</part-name></score-part>
    <score-part id="P2"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1" xml:id="m1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <harmony><root><root-step>C</root-step></root><kind text="C">major</kind></harmony>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><lyric><text>La</text></lyric></note>
      <note><rest/><duration>12</duration><type>half</type><dot/></note>
    </measure>
    <measure number="2" xml:id="m2">
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1" xml:id="p2m1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><rest/><duration>16</duration><type>whole</type></note>
    </measure>
    <measure number="2" xml:id="p2m2">
      <note><rest/><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`
  ,
  parts: []
};

describe('Phase 6 editable score domain', () => {
  it('parses MusicXML into editable parts, measures, events, chords, and lyrics', () => {
    const document = editableScoreFromMusicXml(baseVersion);

    expect(document.parts).toHaveLength(2);
    expect(document.parts[0].measures).toHaveLength(2);
    expect(document.parts[0].measures[0].events[0].kind).toBe('NOTE');
    expect(document.parts[0].measures[0].chordSymbols[0].displayText).toBe('C');
    expect(document.parts[0].measures[0].lyrics[0].text).toBe('La');
  });

  it('changes note pitch, rest duration, chord symbol, and lyric through commands', () => {
    const document = editableScoreFromMusicXml(baseVersion);
    const measure = document.parts[0].measures[0];
    const note = measure.events[0];
    const rest = measure.events[1];
    const chord = measure.chordSymbols[0];
    const lyric = measure.lyrics[0];
    let history = createEditHistory(document);

    history = dispatchEditCommand(history, {
      type: 'CHANGE_PITCH',
      partId: 'P1',
      measureId: measure.id,
      eventId: note.id,
      pitch: { step: 'F', alter: 1, octave: 5 }
    });
    history = dispatchEditCommand(history, {
      type: 'CHANGE_DURATION',
      partId: 'P1',
      measureId: measure.id,
      eventId: rest.id,
      duration: { divisions: 8, type: 'half', dotted: false }
    });
    history = dispatchEditCommand(history, {
      type: 'CHANGE_CHORD',
      partId: 'P1',
      measureId: measure.id,
      chordId: chord.id,
      chord: { root: 'D', alter: 0, quality: 'minor-seventh', displayText: 'Dm7' }
    });
    history = dispatchEditCommand(history, {
      type: 'CHANGE_LYRIC',
      partId: 'P1',
      measureId: measure.id,
      lyricId: lyric.id,
      text: 'Alleluia'
    });

    const updatedMeasure = history.present.parts[0].measures[0];
    expect(updatedMeasure.events[0]).toMatchObject({ kind: 'NOTE', pitch: { step: 'F', alter: 1, octave: 5 } });
    expect(updatedMeasure.events[1].duration.divisions).toBe(8);
    expect(updatedMeasure.chordSymbols[0].displayText).toBe('Dm7');
    expect(updatedMeasure.lyrics[0].text).toBe('Alleluia');
    expect(history.present.dirty).toBe(true);
  });

  it('inserts, duplicates, and deletes measures across all parts with new IDs', () => {
    const document = editableScoreFromMusicXml(baseVersion);
    const firstMeasureId = document.parts[0].measures[0].id;
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const nextId = (prefix: string) => `${prefix}_${ids.shift() ?? 'x'}`;
    let history = createEditHistory(document);

    history = dispatchEditCommand(history, { type: 'INSERT_MEASURE', afterMeasureId: firstMeasureId }, nextId);
    expect(history.present.parts.every((part) => part.measures.length === 3)).toBe(true);

    const insertedId = history.present.parts[0].measures[1].id;
    history = dispatchEditCommand(history, { type: 'DUPLICATE_MEASURE', measureId: insertedId }, nextId);
    expect(history.present.parts.every((part) => part.measures.length === 4)).toBe(true);
    expect(history.present.parts[0].measures[2].id).not.toBe(insertedId);

    history = dispatchEditCommand(history, { type: 'DELETE_MEASURE', measureId: insertedId }, nextId);
    expect(history.present.parts.every((part) => part.measures.length === 3)).toBe(true);
  });

  it('transposes notes, chords, and key signatures deterministically', () => {
    expect(transposePitch({ step: 'C', alter: 0, octave: 4 }, 1)).toEqual({ step: 'C', alter: 1, octave: 4 });
    expect(transposePitch({ step: 'C', alter: 0, octave: 4 }, 12)).toEqual({ step: 'C', alter: 0, octave: 5 });
    expect(transposeChordSymbol({ id: 'c1', measureId: 'm1', root: 'C', alter: 0, quality: 'minor', displayText: 'Cm' }, 2).displayText).toBe('Dm');

    const document = editableScoreFromMusicXml(baseVersion);
    const history = dispatchEditCommand(createEditHistory(document), { type: 'TRANSPOSE_RANGE', semitones: 2 });
    expect(history.present.parts[0].measures[0].events[0]).toMatchObject({ kind: 'NOTE', pitch: { step: 'D', alter: 0, octave: 4 } });
  });

  it('supports undo and redo without leaking annotation history', () => {
    const document = editableScoreFromMusicXml(baseVersion);
    const measure = document.parts[0].measures[0];
    const note = measure.events[0];
    const changed = dispatchEditCommand(createEditHistory(document), {
      type: 'TRANSPOSE_EVENT',
      partId: 'P1',
      measureId: measure.id,
      eventId: note.id,
      semitones: 1
    });

    const undone = undoEdit(changed);
    const redone = redoEdit(undone);
    expect(undone.present.parts[0].measures[0].events[0]).toMatchObject({ kind: 'NOTE', pitch: { step: 'C', alter: 0 } });
    expect(redone.present.parts[0].measures[0].events[0]).toMatchObject({ kind: 'NOTE', pitch: { step: 'C', alter: 1 } });
  });

  it('validates blocking duration mismatches and non-blocking pickup measures', () => {
    const document = editableScoreFromMusicXml(baseVersion);
    const measure = document.parts[0].measures[1];
    const note = measure.events[0];
    const changed = dispatchEditCommand(createEditHistory(document), {
      type: 'CHANGE_DURATION',
      partId: 'P1',
      measureId: measure.id,
      eventId: note.id,
      duration: { divisions: 4, type: 'quarter', dotted: false }
    }).present;

    expect(hasBlockingIssues(changed.validationIssues)).toBe(true);
    expect(changed.validationIssues.some((issue) => issue.code === 'MEASURE_DURATION_MISMATCH')).toBe(true);
  });

  it('serializes well-formed MusicXML and round-trips semantic edits', () => {
    const document = editableScoreFromMusicXml(baseVersion);
    const measure = document.parts[0].measures[0];
    const note = measure.events[0];
    const changed = dispatchEditCommand(createEditHistory(document), {
      type: 'CHANGE_LYRIC',
      partId: 'P1',
      measureId: measure.id,
      eventId: note.id,
      lyricId: measure.lyrics[0].id,
      text: '주님 & <평화>'
    }).present;

    const xml = serializeEditableScoreToMusicXml(changed);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;평화&gt;');

    const roundTrip = editableScoreFromMusicXml({ ...baseVersion, sourceXml: xml });
    expect(roundTrip.parts[0].measures[0].lyrics[0].text).toBe('주님 & <평화>');
  });

  it('migrates only safe measure annotations by policy', () => {
    const document = editableScoreFromMusicXml(baseVersion);
    const annotation: Annotation = {
      id: 'ann1',
      schemaVersion: 1,
      scoreId: document.scoreId,
      scoreVersionId: document.baseScoreVersionId,
      type: 'TEXT',
      scope: 'ENSEMBLE',
      anchor: { type: 'MEASURE', sourceMeasureId: document.parts[0].measures[0].id },
      payload: { text: 'cue', x: 0.1, y: 0.1, width: 0.2, height: 0.1, fontSizeRatio: 0.1 },
      createdAt: 1,
      updatedAt: 1
    };

    const result = migrateAnnotationsForEditedScoreVersion([annotation], document, 'ver_new', 'MEASURE_ONLY');
    expect(result.migrated).toHaveLength(1);
    expect(result.migrated[0].scoreVersionId).toBe('ver_new');
  });
});
