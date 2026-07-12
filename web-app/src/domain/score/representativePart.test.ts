import { describe, expect, it } from 'vitest';
import { analyzeRepresentativePartWarnings, type Measure, type ScorePart } from '@cuenote/score-domain';

describe('analyzeRepresentativePartWarnings', () => {
  it('returns no warnings for a single part', () => {
    expect(analyzeRepresentativePartWarnings([createPart('P1', 'Melody', [createMeasure(1), createMeasure(2)])])).toEqual([]);
  });

  it('warns when another part has a different measure count', () => {
    const warnings = analyzeRepresentativePartWarnings([
      createPart('P1', 'Melody', [createMeasure(1), createMeasure(2)]),
      createPart('P2', 'Bass', [createMeasure(1)])
    ]);

    expect(warnings.map((warning) => warning.code)).toContain('REPRESENTATIVE_PART_MEASURE_COUNT_MISMATCH');
  });

  it('warns when another part has a different time signature', () => {
    const warnings = analyzeRepresentativePartWarnings([
      createPart('P1', 'Melody', [createMeasure(1, { beats: 4, beatType: 4 })]),
      createPart('P2', 'Bass', [createMeasure(1, { beats: 3, beatType: 4 })])
    ]);

    expect(warnings.map((warning) => warning.code)).toContain('REPRESENTATIVE_PART_TIME_SIGNATURE_MISMATCH');
  });

  it('warns when another part has different navigation marks', () => {
    const warnings = analyzeRepresentativePartWarnings([
      createPart('P1', 'Melody', [createMeasure(1, { beats: 4, beatType: 4 }, ['REPEAT_START'])]),
      createPart('P2', 'Bass', [createMeasure(1, { beats: 4, beatType: 4 }, [])])
    ]);

    expect(warnings.map((warning) => warning.code)).toContain('REPRESENTATIVE_PART_NAVIGATION_MISMATCH');
  });
});

function createPart(id: string, name: string, measures: Measure[]): ScorePart {
  return {
    id,
    name,
    measures
  };
}

function createMeasure(
  number: number,
  timeSignature: { beats: number; beatType: number } = { beats: 4, beatType: 4 },
  navigationTypes: Array<'REPEAT_START' | 'REPEAT_END'> = []
): Measure {
  const id = `score:p1:m${number}:m${number}`;
  return {
    id,
    number,
    sourceXmlId: `m${number}`,
    partId: 'P1',
    displayNumber: String(number),
    timeSignature,
    keySignature: { fifths: 0, mode: 'major' },
    divisions: 1,
    durationDivisions: 4,
    chordSymbols: [],
    lyrics: [],
    navigationMarks: navigationTypes.map((type, index) => ({
      id: `${id}:nav:${index + 1}`,
      type,
      measureId: id
    }))
  };
}
