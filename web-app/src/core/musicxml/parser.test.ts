import { describe, expect, it } from 'vitest';
import { parseMusicXML } from './parser';
import { SAMPLE_SCORES } from '../../samples/sampleScores';

describe('parseMusicXML', () => {
  it('parses MusicXML into score domain objects', () => {
    const sample = SAMPLE_SCORES[0];
    const parsed = parseMusicXML(sample.sourceXml, { scoreId: sample.id, sample: true });

    expect(parsed.document.id).toBe(sample.id);
    expect(parsed.document.title).toBe('Simple Duet');
    expect(parsed.document.composer).toBe('CueNote Team');
    expect(parsed.version.parts).toHaveLength(1);
    expect(parsed.version.parts[0].measures).toHaveLength(2);
    expect(parsed.version.parts[0].measures[0].id).toBe('simple-duet:p1:m1:sd-m1');
    expect(parsed.version.parts[0].measures[1].id).toBe('simple-duet:p1:m2:sd-m2');
  });

  it('keeps measure ids stable across repeated parses', () => {
    const sample = SAMPLE_SCORES[1];
    const first = parseMusicXML(sample.sourceXml, { scoreId: sample.id, sample: true });
    const second = parseMusicXML(sample.sourceXml, { scoreId: sample.id, sample: true });

    expect(second.version.parts[0].measures.map((measure) => measure.id)).toEqual(
      first.version.parts[0].measures.map((measure) => measure.id)
    );
  });

  it('extracts chords, lyrics, time signatures, and key signatures', () => {
    const sample = SAMPLE_SCORES[1];
    const parsed = parseMusicXML(sample.sourceXml, { scoreId: sample.id, sample: true });
    const firstMeasure = parsed.version.parts[0].measures[0];

    expect(firstMeasure.timeSignature).toEqual({ beats: 4, beatType: 4 });
    expect(firstMeasure.keySignature).toEqual({ fifths: 2, mode: 'major' });
    expect(firstMeasure.chordSymbols).toContain('C major');
    expect(firstMeasure.lyrics).toEqual(['Sing', 'with', 'me']);
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
