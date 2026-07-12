import { describe, expect, it } from 'vitest';
import { parseMusicXML } from './parser';
import { SAMPLE_SCORES } from '../../samples/sampleScores';

describe('parseMusicXML', () => {
  it('parses MusicXML into score domain objects', () => {
    const sample = SAMPLE_SCORES.find((entry) => entry.id === 'simple-duet');
    expect(sample).toBeDefined();

    const parsed = parseMusicXML(sample!.sourceXml, { scoreId: sample!.id, sample: true });

    expect(parsed.document.id).toBe(sample!.id);
    expect(parsed.document.title).toBe('Simple Duet');
    expect(parsed.document.composer).toBe('CueNote Team');
    expect(parsed.version.parts).toHaveLength(1);
    expect(parsed.version.parts[0].measures).toHaveLength(2);
    expect(parsed.version.parts[0].measures[0].id).toBe('simple-duet:p1:m1:sd-m1');
    expect(parsed.version.parts[0].measures[1].id).toBe('simple-duet:p1:m2:sd-m2');
  });

  it('keeps measure ids stable across repeated parses', () => {
    const sample = SAMPLE_SCORES.find((entry) => entry.id === 'lyrics-and-chords');
    expect(sample).toBeDefined();

    const first = parseMusicXML(sample!.sourceXml, { scoreId: sample!.id, sample: true });
    const second = parseMusicXML(sample!.sourceXml, { scoreId: sample!.id, sample: true });

    expect(second.version.parts[0].measures.map((measure) => measure.id)).toEqual(
      first.version.parts[0].measures.map((measure) => measure.id)
    );
  });

  it('extracts chords, lyrics, time signatures, key signatures, and durations', () => {
    const sample = SAMPLE_SCORES.find((entry) => entry.id === 'lyrics-and-chords');
    expect(sample).toBeDefined();

    const parsed = parseMusicXML(sample!.sourceXml, { scoreId: sample!.id, sample: true });
    const firstMeasure = parsed.version.parts[0].measures[0];

    expect(firstMeasure.timeSignature).toEqual({ beats: 4, beatType: 4 });
    expect(firstMeasure.keySignature).toEqual({ fifths: 2, mode: 'major' });
    expect(firstMeasure.divisions).toBeGreaterThan(0);
    expect(firstMeasure.durationDivisions).toBeGreaterThan(0);
    expect(firstMeasure.chordSymbols).toContain('C major');
    expect(firstMeasure.lyrics).toEqual(['Sing', 'with', 'me']);
  });

  it('parses repeat, ending, segno, coda, and fine navigation marks', () => {
    const repeatSample = SAMPLE_SCORES.find((entry) => entry.id === 'repeat-endings');
    const dsSample = SAMPLE_SCORES.find((entry) => entry.id === 'ds-al-coda');
    expect(repeatSample).toBeDefined();
    expect(dsSample).toBeDefined();

    const repeatParsed = parseMusicXML(repeatSample!.sourceXml, { scoreId: repeatSample!.id, sample: true });
    const dsParsed = parseMusicXML(dsSample!.sourceXml, { scoreId: dsSample!.id, sample: true });

    expect(repeatParsed.version.parts[0].measures[0].navigationMarks.map((mark) => mark.type)).toContain('REPEAT_START');
    expect(repeatParsed.version.parts[0].measures[1].navigationMarks.map((mark) => mark.type)).toEqual(
      expect.arrayContaining(['ENDING_START', 'ENDING_STOP', 'REPEAT_END'])
    );
    expect(repeatParsed.version.parts[0].measures[2].navigationMarks.map((mark) => mark.type)).toEqual(
      expect.arrayContaining(['ENDING_START', 'ENDING_STOP'])
    );

    expect(dsParsed.version.parts[0].measures[0].navigationMarks.map((mark) => mark.type)).toContain('SEGNO');
    expect(dsParsed.version.parts[0].measures[2].navigationMarks.map((mark) => mark.type)).toContain('TO_CODA');
    expect(dsParsed.version.parts[0].measures[3].navigationMarks.map((mark) => mark.type)).toContain('DAL_SEGNO_AL_CODA');
    expect(dsParsed.version.parts[0].measures[4].navigationMarks.map((mark) => mark.type)).toContain('CODA');
  });

  it('rejects invalid XML', () => {
    expect(() => parseMusicXML('<score-partwise>', { scoreId: 'broken' })).toThrowError(/Invalid MusicXML/);
  });

  it('rejects unsupported structure', () => {
    expect(() =>
      parseMusicXML(
        '<?xml version="1.0"?><score-timewise xmlns="http://www.musicxml.org/ns/musicxml"></score-timewise>',
        { scoreId: 'broken' }
      )
    ).toThrowError(/Only score-partwise MusicXML/);
  });
});
