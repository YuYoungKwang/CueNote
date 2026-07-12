import { describe, expect, it } from 'vitest';
import {
  PlaybackTimeline,
  createPerformanceMeasureId,
  type Measure,
  type PerformanceMeasure
} from '@cuenote/score-domain';

describe('PlaybackTimeline', () => {
  it('starts in a stopped state', () => {
    const { timeline } = createTimeline();
    expect(timeline.getSnapshot()).toMatchObject({
      status: 'STOPPED',
      currentPerformanceMeasureId: 'score:p1:m1:m1::1',
      currentBeat: 1
    });
  });

  it('plays without count-in using monotonic elapsed time', () => {
    const { timeline, clock } = createTimeline({ countInMeasures: 0, bpm: 60 });
    timeline.play();
    clock.advance(2500);

    expect(timeline.getSnapshot()).toMatchObject({
      status: 'PLAYING',
      currentPerformanceMeasureId: 'score:p1:m1:m1::1',
      currentBeat: 3
    });

    clock.advance(2000);
    expect(timeline.getSnapshot()).toMatchObject({
      currentPerformanceMeasureId: 'score:p1:m2:m2::1',
      currentBeat: 1
    });
  });

  it('supports a one-bar count-in before playback starts', () => {
    const { timeline, clock } = createTimeline({ countInMeasures: 1, bpm: 60 });
    timeline.play();

    clock.advance(2000);
    expect(timeline.getSnapshot()).toMatchObject({
      status: 'COUNT_IN',
      currentPerformanceMeasureId: 'score:p1:m1:m1::1',
      currentBeat: 3
    });

    clock.advance(2500);
    expect(timeline.getSnapshot()).toMatchObject({
      status: 'PLAYING',
      currentPerformanceMeasureId: 'score:p1:m1:m1::1',
      currentBeat: 1
    });
  });

  it('pauses and resumes from the same musical position', () => {
    const { timeline, clock } = createTimeline({ countInMeasures: 0, bpm: 60 });
    timeline.play();
    clock.advance(3000);

    const paused = timeline.pause();
    expect(paused.status).toBe('PAUSED');
    expect(paused.currentBeat).toBe(4);

    clock.advance(5000);
    expect(timeline.getSnapshot().currentBeat).toBe(4);

    timeline.resume();
    clock.advance(1000);
    expect(timeline.getSnapshot()).toMatchObject({
      status: 'PLAYING',
      currentPerformanceMeasureId: 'score:p1:m2:m2::1',
      currentBeat: 1
    });
  });

  it('stops back at the first performance measure', () => {
    const { timeline, clock } = createTimeline({ countInMeasures: 0, bpm: 60 });
    timeline.play();
    clock.advance(6000);
    timeline.stop();

    expect(timeline.getSnapshot()).toMatchObject({
      status: 'STOPPED',
      currentPerformanceMeasureId: 'score:p1:m1:m1::1',
      currentBeat: 1
    });
  });

  it('preserves musical progress when BPM changes mid-playback', () => {
    const { timeline, clock } = createTimeline({ countInMeasures: 0, bpm: 60 });
    timeline.play();
    clock.advance(4000);
    timeline.setBpm(120);

    expect(timeline.getSnapshot()).toMatchObject({
      bpm: 120,
      currentPerformanceMeasureId: 'score:p1:m2:m2::1',
      currentBeat: 1
    });

    clock.advance(1000);
    expect(timeline.getSnapshot().currentBeat).toBe(3);
  });

  it('seeks by performance-measure id and keeps repeated occurrences distinct', () => {
    const measures = [createMeasure(1), createMeasure(2)];
    const performanceMeasures = [
      createPerformanceMeasure(measures[0], 1, 0),
      createPerformanceMeasure(measures[1], 1, 1),
      createPerformanceMeasure(measures[0], 2, 2)
    ];
    const clock = new ManualClock();
    const timeline = new PlaybackTimeline({
      performanceMeasures,
      measuresById: Object.fromEntries(measures.map((measure) => [measure.id, measure])),
      bpm: 60,
      countInMeasures: 0,
      clock
    });

    const snapshot = timeline.seekToPerformanceMeasure(performanceMeasures[2].id);
    expect(snapshot).toMatchObject({
      status: 'STOPPED',
      currentPerformanceMeasureId: performanceMeasures[2].id,
      currentOccurrence: 2,
      currentSourceMeasureId: measures[0].id
    });
  });

  it('moves to previous and next performance measures', () => {
    const { timeline } = createTimeline({ countInMeasures: 0, bpm: 60 });

    timeline.next();
    expect(timeline.getSnapshot().currentPerformanceMeasureId).toBe('score:p1:m2:m2::1');

    timeline.previous();
    expect(timeline.getSnapshot().currentPerformanceMeasureId).toBe('score:p1:m1:m1::1');
  });

  it('uses actual measure durations for pickup and non-4/4 measures', () => {
    const measures = [
      createMeasure(1, { timeSignature: { beats: 4, beatType: 4 }, durationDivisions: 1 }),
      createMeasure(2, { timeSignature: { beats: 3, beatType: 4 }, durationDivisions: 3 })
    ];
    const clock = new ManualClock();
    const timeline = new PlaybackTimeline({
      performanceMeasures: measures.map((measure, index) => createPerformanceMeasure(measure, 1, index)),
      measuresById: Object.fromEntries(measures.map((measure) => [measure.id, measure])),
      bpm: 60,
      countInMeasures: 0,
      clock
    });

    timeline.play();
    clock.advance(900);
    expect(timeline.getSnapshot()).toMatchObject({
      currentPerformanceMeasureId: measures[0].id + '::1',
      currentBeat: 1
    });

    clock.advance(200);
    expect(timeline.getSnapshot()).toMatchObject({
      currentPerformanceMeasureId: measures[1].id + '::1',
      currentBeat: 1
    });
  });

  it('recovers from a visibility-related clock jump without counting missed ticks', () => {
    const { timeline, clock } = createTimeline({ countInMeasures: 0, bpm: 60 });
    timeline.play();
    clock.advance(9000);

    const snapshot = timeline.syncAfterVisibilityChange();
    expect(snapshot).toMatchObject({
      currentPerformanceMeasureId: 'score:p1:m3:m3::1',
      currentBeat: 2
    });
  });

  it('ends at the last performance measure instead of running forever', () => {
    const { timeline, clock } = createTimeline({ countInMeasures: 0, bpm: 60 });
    timeline.play();
    clock.advance(13000);

    expect(timeline.getSnapshot()).toMatchObject({
      status: 'ENDED',
      currentPerformanceMeasureId: 'score:p1:m3:m3::1',
      currentBeat: 4
    });
  });
});

class ManualClock {
  private currentMs = 0;

  now(): number {
    return this.currentMs;
  }

  advance(deltaMs: number): void {
    this.currentMs += deltaMs;
  }
}

function createTimeline(options: { bpm?: number; countInMeasures?: number } = {}) {
  const measures = [createMeasure(1), createMeasure(2), createMeasure(3)];
  const performanceMeasures = measures.map((measure, index) => createPerformanceMeasure(measure, 1, index));
  const clock = new ManualClock();
  const timeline = new PlaybackTimeline({
    performanceMeasures,
    measuresById: Object.fromEntries(measures.map((measure) => [measure.id, measure])),
    bpm: options.bpm ?? 80,
    countInMeasures: options.countInMeasures ?? 0,
    clock
  });

  return { timeline, clock, measures, performanceMeasures };
}

function createMeasure(
  number: number,
  overrides: Partial<Measure> & Pick<Measure, 'timeSignature' | 'durationDivisions'> = {
    timeSignature: { beats: 4, beatType: 4 },
    durationDivisions: 4
  }
): Measure {
  const id = `score:p1:m${number}:m${number}`;
  return {
    id,
    number,
    sourceXmlId: `m${number}`,
    partId: 'P1',
    displayNumber: String(number),
    timeSignature: overrides.timeSignature,
    keySignature: { fifths: 0, mode: 'major' },
    divisions: 1,
    durationDivisions: overrides.durationDivisions,
    chordSymbols: [],
    lyrics: [],
    navigationMarks: []
  };
}

function createPerformanceMeasure(measure: Measure, occurrence: number, orderIndex: number): PerformanceMeasure {
  return {
    id: createPerformanceMeasureId(measure.id, occurrence),
    sourceMeasureId: measure.id,
    occurrence,
    orderIndex,
    sourceMeasureNumber: measure.number
  };
}
