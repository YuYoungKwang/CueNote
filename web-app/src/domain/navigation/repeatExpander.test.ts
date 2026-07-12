import { describe, expect, it } from 'vitest';
import {
  createPerformanceMeasureId,
  expandRepeats,
  type Measure,
  type NavigationMarkType
} from '@cuenote/score-domain';

describe('expandRepeats', () => {
  it('keeps straight-through scores in source order', () => {
    const measures = [createMeasure(1), createMeasure(2), createMeasure(3)];
    const order = expandRepeats(measures);

    expect(order.measures.map((measure) => measure.sourceMeasureId)).toEqual(measures.map((measure) => measure.id));
    expect(order.warnings).toEqual([]);
  });

  it('expands a simple repeat and increments occurrences', () => {
    const measures = [
      createMeasure(1, [{ type: 'REPEAT_START' }]),
      createMeasure(2),
      createMeasure(3, [{ type: 'REPEAT_END' }]),
      createMeasure(4)
    ];

    const order = expandRepeats(measures);

    expect(order.measures.map((measure) => `${measure.sourceMeasureNumber}:${measure.occurrence}`)).toEqual([
      '1:1',
      '2:1',
      '3:1',
      '1:2',
      '2:2',
      '3:2',
      '4:1'
    ]);
    expect(order.measures[3].id).toBe(createPerformanceMeasureId(measures[0].id, 2));
  });

  it('honors repeat counts larger than the default', () => {
    const measures = [createMeasure(1, [{ type: 'REPEAT_START' }]), createMeasure(2, [{ type: 'REPEAT_END', repeatTimes: 3 }])];
    const order = expandRepeats(measures);

    expect(order.measures.map((measure) => `${measure.sourceMeasureNumber}:${measure.occurrence}`)).toEqual([
      '1:1',
      '2:1',
      '1:2',
      '2:2',
      '1:3',
      '2:3'
    ]);
  });

  it('falls back to the score start when a repeat end has no repeat start', () => {
    const measures = [createMeasure(1), createMeasure(2, [{ type: 'REPEAT_END' }]), createMeasure(3)];
    const order = expandRepeats(measures);

    expect(order.measures.map((measure) => measure.sourceMeasureNumber)).toEqual([1, 2, 1, 2, 3]);
    expect(order.warnings.map((warning) => warning.code)).toContain('MISSING_REPEAT_START');
  });

  it('supports first and second endings', () => {
    const measures = [
      createMeasure(1, [{ type: 'REPEAT_START' }]),
      createMeasure(2, [{ type: 'ENDING_START', endingNumbers: [1] }, { type: 'ENDING_STOP' }, { type: 'REPEAT_END' }]),
      createMeasure(3, [{ type: 'ENDING_START', endingNumbers: [2] }, { type: 'ENDING_STOP' }]),
      createMeasure(4)
    ];

    const order = expandRepeats(measures);

    expect(order.measures.map((measure) => measure.sourceMeasureNumber)).toEqual([1, 2, 1, 3, 4]);
  });

  it('handles a score with only a first ending without looping forever', () => {
    const measures = [
      createMeasure(1, [{ type: 'REPEAT_START' }]),
      createMeasure(2, [{ type: 'ENDING_START', endingNumbers: [1] }, { type: 'ENDING_STOP' }, { type: 'REPEAT_END' }]),
      createMeasure(3)
    ];

    const order = expandRepeats(measures);

    expect(order.measures.map((measure) => measure.sourceMeasureNumber)).toEqual([1, 2, 1, 3]);
  });

  it('supports D.C. al Fine', () => {
    const measures = [
      createMeasure(1),
      createMeasure(2, [{ type: 'FINE' }]),
      createMeasure(3),
      createMeasure(4, [{ type: 'DA_CAPO_AL_FINE' }])
    ];

    const order = expandRepeats(measures);

    expect(order.measures.map((measure) => measure.sourceMeasureNumber)).toEqual([1, 2, 3, 4, 1, 2]);
  });

  it('supports D.S. al Fine', () => {
    const measures = [
      createMeasure(1, [{ type: 'SEGNO' }]),
      createMeasure(2),
      createMeasure(3, [{ type: 'FINE' }]),
      createMeasure(4, [{ type: 'DAL_SEGNO_AL_FINE' }])
    ];

    const order = expandRepeats(measures);

    expect(order.measures.map((measure) => measure.sourceMeasureNumber)).toEqual([1, 2, 3, 4, 1, 2, 3]);
  });

  it('supports D.S. al Coda', () => {
    const measures = [
      createMeasure(1, [{ type: 'SEGNO' }]),
      createMeasure(2),
      createMeasure(3, [{ type: 'TO_CODA' }]),
      createMeasure(4, [{ type: 'DAL_SEGNO_AL_CODA' }]),
      createMeasure(5, [{ type: 'CODA' }]),
      createMeasure(6)
    ];

    const order = expandRepeats(measures);

    expect(order.measures.map((measure) => `${measure.sourceMeasureNumber}:${measure.occurrence}`)).toEqual([
      '1:1',
      '2:1',
      '3:1',
      '4:1',
      '1:2',
      '2:2',
      '3:2',
      '5:1',
      '6:1'
    ]);
  });

  it('warns when D.S. is missing a segno target', () => {
    const measures = [createMeasure(1), createMeasure(2, [{ type: 'DAL_SEGNO' }]), createMeasure(3)];
    const order = expandRepeats(measures);

    expect(order.measures.map((measure) => measure.sourceMeasureNumber)).toEqual([1, 2, 3]);
    expect(order.warnings.map((warning) => warning.code)).toContain('MISSING_SEGNO');
  });

  it('warns when D.S. al Coda is missing a coda target', () => {
    const measures = [
      createMeasure(1, [{ type: 'SEGNO' }]),
      createMeasure(2, [{ type: 'TO_CODA' }]),
      createMeasure(3, [{ type: 'DAL_SEGNO_AL_CODA' }])
    ];
    const order = expandRepeats(measures);

    expect(order.warnings.map((warning) => warning.code)).toContain('MISSING_CODA');
  });

  it('warns when D.S. al Coda never reaches To Coda after the jump', () => {
    const measures = [
      createMeasure(1, [{ type: 'SEGNO' }]),
      createMeasure(2),
      createMeasure(3, [{ type: 'DAL_SEGNO_AL_CODA' }]),
      createMeasure(4, [{ type: 'CODA' }])
    ];
    const order = expandRepeats(measures);

    expect(order.warnings.map((warning) => warning.code)).toContain('MISSING_TO_CODA');
  });

  it('prevents runaway navigation with an explicit transition cap', () => {
    const measures = [createMeasure(1, [{ type: 'REPEAT_END', repeatTimes: 99 }])];
    const order = expandRepeats(measures, { maxTransitions: 3 });

    expect(order.warnings.map((warning) => warning.code)).toContain('MAX_TRANSITIONS_EXCEEDED');
  });
});

function createMeasure(
  number: number,
  navigationMarks: Array<{ type: NavigationMarkType; endingNumbers?: number[]; repeatTimes?: number }> = []
): Measure {
  const id = `score:p1:m${number}:m${number}`;
  return {
    id,
    number,
    sourceXmlId: `m${number}`,
    partId: 'P1',
    displayNumber: String(number),
    timeSignature: { beats: 4, beatType: 4 },
    keySignature: { fifths: 0, mode: 'major' },
    divisions: 1,
    durationDivisions: 4,
    chordSymbols: [],
    lyrics: [],
    navigationMarks: navigationMarks.map((mark, index) => ({
      id: `${id}:nav:${index + 1}`,
      type: mark.type,
      measureId: id,
      endingNumbers: mark.endingNumbers,
      repeatTimes: mark.repeatTimes
    }))
  };
}
