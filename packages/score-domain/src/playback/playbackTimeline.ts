import {
  calculateMeasureBeatCount,
  calculateNominalMeasureBeatCount,
  type Measure,
  type PerformanceMeasure,
  type PerformanceMeasureID
} from '../model';

export interface PlaybackClock {
  now(): number;
}

export type PlaybackStatus = 'STOPPED' | 'COUNT_IN' | 'PLAYING' | 'PAUSED' | 'ENDED';

export interface PlaybackTimelineOptions {
  performanceMeasures: PerformanceMeasure[];
  measuresById: Record<string, Measure>;
  bpm: number;
  countInMeasures: number;
  clock: PlaybackClock;
  initialPerformanceMeasureId?: PerformanceMeasureID;
  initialStatus?: PlaybackStatus;
}

export interface PlaybackSnapshot {
  status: PlaybackStatus;
  bpm: number;
  countInMeasures: number;
  currentPerformanceMeasureId: PerformanceMeasureID | null;
  currentSourceMeasureId: string | null;
  currentOccurrence: number | null;
  currentBeat: number;
  elapsedMs: number;
  countInRemainingMs: number;
}

interface DerivedState {
  status: PlaybackStatus;
  positionMs: number;
  countInElapsedMs: number;
  countInRemainingMs: number;
}

export class PlaybackTimeline {
  private readonly performanceMeasures: PerformanceMeasure[];
  private readonly measuresById: Record<string, Measure>;
  private readonly clock: PlaybackClock;
  private bpm: number;
  private countInMeasures: number;
  private status: PlaybackStatus;
  private basePositionMs = 0;
  private baseCountInElapsedMs = 0;
  private activeStartedAtMs: number | null = null;

  constructor(options: PlaybackTimelineOptions) {
    this.performanceMeasures = options.performanceMeasures;
    this.measuresById = options.measuresById;
    this.clock = options.clock;
    this.bpm = options.bpm;
    this.countInMeasures = options.countInMeasures;
    this.status = options.initialStatus ?? 'STOPPED';
    this.basePositionMs = this.getElapsedMsForPerformanceMeasure(options.initialPerformanceMeasureId ?? this.performanceMeasures[0]?.id ?? null);
    this.baseCountInElapsedMs = this.status === 'PAUSED' ? this.getCountInDurationMs() : 0;

    if (this.status === 'ENDED') {
      this.basePositionMs = this.getTotalDurationMs();
      this.baseCountInElapsedMs = this.getCountInDurationMs();
    }
  }

  getSnapshot(): PlaybackSnapshot {
    return this.computeSnapshot();
  }

  getStatus(): PlaybackStatus {
    return this.computeSnapshot().status;
  }

  play(): PlaybackSnapshot {
    if (this.performanceMeasures.length === 0) {
      this.status = 'ENDED';
      return this.getSnapshot();
    }

    if (this.status === 'PAUSED') {
      return this.resume();
    }

    if (this.status === 'PLAYING' || this.status === 'COUNT_IN') {
      return this.getSnapshot();
    }

    if (this.status === 'ENDED') {
      this.basePositionMs = 0;
    }

    this.basePositionMs = this.clampPositionMs(this.basePositionMs);
    this.baseCountInElapsedMs = 0;
    this.activeStartedAtMs = this.clock.now();
    this.status = this.getCountInDurationMs() > 0 ? 'COUNT_IN' : 'PLAYING';
    return this.getSnapshot();
  }

  pause(): PlaybackSnapshot {
    if (this.status !== 'PLAYING' && this.status !== 'COUNT_IN') {
      return this.getSnapshot();
    }

    this.captureCurrentState();
    this.activeStartedAtMs = null;
    this.status = 'PAUSED';
    return this.getSnapshot();
  }

  resume(): PlaybackSnapshot {
    if (this.status !== 'PAUSED') {
      return this.getSnapshot();
    }

    this.activeStartedAtMs = this.clock.now();
    this.status = this.baseCountInElapsedMs < this.getCountInDurationMs() ? 'COUNT_IN' : 'PLAYING';
    return this.getSnapshot();
  }

  stop(): PlaybackSnapshot {
    this.basePositionMs = 0;
    this.baseCountInElapsedMs = 0;
    this.activeStartedAtMs = null;
    this.status = 'STOPPED';
    return this.getSnapshot();
  }

  setBpm(nextBpm: number): PlaybackSnapshot {
    const derived = this.deriveState(this.clock.now());
    const previousBeatDurationMs = this.getBeatDurationMs();
    const positionBeats = previousBeatDurationMs > 0 ? derived.positionMs / previousBeatDurationMs : 0;
    const countInBeats = previousBeatDurationMs > 0 ? derived.countInElapsedMs / previousBeatDurationMs : 0;

    this.bpm = nextBpm;
    const nextBeatDurationMs = this.getBeatDurationMs();
    this.basePositionMs = positionBeats * nextBeatDurationMs;
    this.baseCountInElapsedMs = Math.min(this.getCountInDurationMs(), countInBeats * nextBeatDurationMs);
    this.activeStartedAtMs = this.isActiveStatus(derived.status) ? this.clock.now() : null;
    this.status = derived.status;
    return this.getSnapshot();
  }

  setCountInMeasures(nextCountInMeasures: number): PlaybackSnapshot {
    const derived = this.deriveState(this.clock.now());
    const beatDurationMs = this.getBeatDurationMs();
    const countInBeats = beatDurationMs > 0 ? derived.countInElapsedMs / beatDurationMs : 0;
    const hadCompletedCountIn =
      derived.status === 'PLAYING' ||
      derived.status === 'ENDED' ||
      (derived.status === 'PAUSED' && derived.countInRemainingMs === 0);

    this.countInMeasures = nextCountInMeasures;
    const nextCountInDurationMs = this.getCountInDurationMs();

    this.basePositionMs = derived.positionMs;
    this.baseCountInElapsedMs = hadCompletedCountIn ? nextCountInDurationMs : Math.min(nextCountInDurationMs, countInBeats * beatDurationMs);
    this.activeStartedAtMs = this.isActiveStatus(derived.status) ? this.clock.now() : null;
    this.status =
      derived.status === 'COUNT_IN' && this.baseCountInElapsedMs >= nextCountInDurationMs
        ? 'PLAYING'
        : derived.status;

    return this.getSnapshot();
  }

  seekToPerformanceMeasure(performanceMeasureId: PerformanceMeasureID): PlaybackSnapshot {
    const nextPositionMs = this.getElapsedMsForPerformanceMeasure(performanceMeasureId);
    const derived = this.deriveState(this.clock.now());

    this.basePositionMs = nextPositionMs;
    this.baseCountInElapsedMs = this.isActiveStatus(derived.status) ? this.getCountInDurationMs() : 0;

    if (derived.status === 'PLAYING' || derived.status === 'COUNT_IN') {
      this.activeStartedAtMs = this.clock.now();
      this.status = 'PLAYING';
    } else if (derived.status === 'STOPPED') {
      this.activeStartedAtMs = null;
      this.status = 'STOPPED';
    } else {
      this.activeStartedAtMs = null;
      this.status = 'PAUSED';
    }

    return this.getSnapshot();
  }

  next(): PlaybackSnapshot {
    if (this.performanceMeasures.length === 0) {
      return this.getSnapshot();
    }

    const currentId = this.getSnapshot().currentPerformanceMeasureId;
    const index = Math.max(0, this.performanceMeasures.findIndex((measure) => measure.id === currentId));
    const nextIndex = Math.min(this.performanceMeasures.length - 1, index + 1);
    return this.seekToPerformanceMeasure(this.performanceMeasures[nextIndex].id);
  }

  previous(): PlaybackSnapshot {
    if (this.performanceMeasures.length === 0) {
      return this.getSnapshot();
    }

    const currentId = this.getSnapshot().currentPerformanceMeasureId;
    const index = Math.max(0, this.performanceMeasures.findIndex((measure) => measure.id === currentId));
    const previousIndex = Math.max(0, index - 1);
    return this.seekToPerformanceMeasure(this.performanceMeasures[previousIndex].id);
  }

  syncAfterVisibilityChange(): PlaybackSnapshot {
    if (!this.isActiveStatus(this.status)) {
      return this.getSnapshot();
    }

    const snapshot = this.getSnapshot();
    if (snapshot.status === 'ENDED') {
      this.basePositionMs = this.getTotalDurationMs();
      this.baseCountInElapsedMs = this.getCountInDurationMs();
      this.activeStartedAtMs = null;
      this.status = 'ENDED';
    }

    return snapshot;
  }

  private computeSnapshot(): PlaybackSnapshot {
    if (this.performanceMeasures.length === 0) {
      return {
        status: 'ENDED',
        bpm: this.bpm,
        countInMeasures: this.countInMeasures,
        currentPerformanceMeasureId: null,
        currentSourceMeasureId: null,
        currentOccurrence: null,
        currentBeat: 1,
        elapsedMs: 0,
        countInRemainingMs: 0
      };
    }

    const derived = this.deriveState(this.clock.now());
    const position = this.resolvePosition(derived.positionMs);
    const countInBeat =
      derived.status === 'COUNT_IN'
        ? Math.min(
            Math.max(1, this.getCountInMeasuresTotalBeats()),
            Math.floor(derived.countInElapsedMs / this.getBeatDurationMs()) + 1
          )
        : position.currentBeat;

    return {
      status: derived.status,
      bpm: this.bpm,
      countInMeasures: this.countInMeasures,
      currentPerformanceMeasureId: position.performanceMeasure?.id ?? null,
      currentSourceMeasureId: position.performanceMeasure?.sourceMeasureId ?? null,
      currentOccurrence: position.performanceMeasure?.occurrence ?? null,
      currentBeat: countInBeat,
      elapsedMs: position.positionMs,
      countInRemainingMs: derived.countInRemainingMs
    };
  }

  private captureCurrentState(): void {
    const derived = this.deriveState(this.clock.now());
    this.basePositionMs = derived.positionMs;
    this.baseCountInElapsedMs = derived.countInElapsedMs;
    this.status = derived.status;
  }

  private deriveState(nowMs: number): DerivedState {
    const countInDurationMs = this.getCountInDurationMs();

    if (!this.isActiveStatus(this.status) || this.activeStartedAtMs == null) {
      return {
        status: this.status,
        positionMs: this.clampPositionMs(this.basePositionMs),
        countInElapsedMs: Math.min(countInDurationMs, this.baseCountInElapsedMs),
        countInRemainingMs: this.status === 'COUNT_IN' ? Math.max(0, countInDurationMs - this.baseCountInElapsedMs) : 0
      };
    }

    if (this.status === 'COUNT_IN') {
      const activeElapsedMs = Math.max(0, nowMs - this.activeStartedAtMs);
      const totalCountInElapsedMs = this.baseCountInElapsedMs + activeElapsedMs;
      const remainingCountInMs = Math.max(0, countInDurationMs - totalCountInElapsedMs);

      if (remainingCountInMs > 0) {
        return {
          status: 'COUNT_IN',
          positionMs: this.clampPositionMs(this.basePositionMs),
          countInElapsedMs: totalCountInElapsedMs,
          countInRemainingMs: remainingCountInMs
        };
      }

      const playbackElapsedMs = totalCountInElapsedMs - countInDurationMs;
      const positionMs = this.clampPositionMs(this.basePositionMs + playbackElapsedMs);
      const reachedEnd = positionMs >= this.getTotalDurationMs();

      return {
        status: reachedEnd ? 'ENDED' : 'PLAYING',
        positionMs,
        countInElapsedMs: countInDurationMs,
        countInRemainingMs: 0
      };
    }

    const positionMs = this.clampPositionMs(this.basePositionMs + Math.max(0, nowMs - this.activeStartedAtMs));
    const reachedEnd = positionMs >= this.getTotalDurationMs();

    return {
      status: reachedEnd ? 'ENDED' : 'PLAYING',
      positionMs,
      countInElapsedMs: countInDurationMs,
      countInRemainingMs: 0
    };
  }

  private resolvePosition(positionMs: number): {
    positionMs: number;
    performanceMeasure: PerformanceMeasure | null;
    currentBeat: number;
  } {
    if (this.performanceMeasures.length === 0) {
      return {
        positionMs: 0,
        performanceMeasure: null,
        currentBeat: 1
      };
    }

    const clampedPositionMs = this.clampPositionMs(positionMs);
    let runningElapsedMs = 0;

    for (const performanceMeasure of this.performanceMeasures) {
      const measure = this.measuresById[performanceMeasure.sourceMeasureId];
      const measureDurationMs = this.getMeasureDurationMs(measure);
      if (clampedPositionMs < runningElapsedMs + measureDurationMs) {
        const withinMeasureMs = Math.max(0, clampedPositionMs - runningElapsedMs);
        return {
          positionMs: clampedPositionMs,
          performanceMeasure,
          currentBeat: this.calculateCurrentBeat(withinMeasureMs, measure)
        };
      }

      runningElapsedMs += measureDurationMs;
    }

    const lastMeasure = this.performanceMeasures[this.performanceMeasures.length - 1];
    const sourceMeasure = this.measuresById[lastMeasure.sourceMeasureId];

    return {
      positionMs: this.getTotalDurationMs(),
      performanceMeasure: lastMeasure,
      currentBeat: Math.max(1, Math.round(calculateMeasureBeatCount(sourceMeasure)))
    };
  }

  private calculateCurrentBeat(withinMeasureMs: number, measure: Measure): number {
    const beatDurationMs = this.getBeatDurationMs();
    const measureBeatCount = Math.max(1, calculateMeasureBeatCount(measure));
    const maxBeat = Math.max(1, Math.ceil(measureBeatCount));
    const rawBeat = Math.floor(withinMeasureMs / beatDurationMs) + 1;
    return Math.min(maxBeat, rawBeat);
  }

  private isActiveStatus(status: PlaybackStatus): boolean {
    return status === 'COUNT_IN' || status === 'PLAYING';
  }

  private getBeatDurationMs(): number {
    return 60000 / this.bpm;
  }

  private getCountInDurationMs(): number {
    return this.getCountInMeasuresTotalBeats() * this.getBeatDurationMs();
  }

  private getCountInMeasuresTotalBeats(): number {
    return this.countInMeasures * this.getCountInBeatsPerMeasure();
  }

  private getCountInBeatsPerMeasure(): number {
    const firstMeasure = this.performanceMeasures[0]
      ? this.measuresById[this.performanceMeasures[0].sourceMeasureId]
      : undefined;

    return firstMeasure ? calculateNominalMeasureBeatCount(firstMeasure) : 4;
  }

  private getMeasureDurationMs(measure: Measure): number {
    return Math.max(this.getBeatDurationMs(), calculateMeasureBeatCount(measure) * this.getBeatDurationMs());
  }

  private getElapsedMsForPerformanceMeasure(performanceMeasureId: PerformanceMeasureID | null): number {
    if (!performanceMeasureId) {
      return 0;
    }

    let elapsedMs = 0;
    for (const performanceMeasure of this.performanceMeasures) {
      if (performanceMeasure.id === performanceMeasureId) {
        return elapsedMs;
      }

      elapsedMs += this.getMeasureDurationMs(this.measuresById[performanceMeasure.sourceMeasureId]);
    }

    return 0;
  }

  private getTotalDurationMs(): number {
    return this.performanceMeasures.reduce((total, performanceMeasure) => {
      return total + this.getMeasureDurationMs(this.measuresById[performanceMeasure.sourceMeasureId]);
    }, 0);
  }

  private clampPositionMs(positionMs: number): number {
    return Math.max(0, Math.min(positionMs, this.getTotalDurationMs()));
  }
}
