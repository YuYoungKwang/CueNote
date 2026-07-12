export type ScoreID = string;
export type ScoreVersionID = string;
export type ScorePartID = string;
export type MeasureID = string;
export type StableMeasureId = string;
export type PerformanceMeasureID = string;

export interface Rational {
  numerator: number;
  denominator: number;
}

export interface TimeSignature {
  beats: number;
  beatType: number;
}

export interface KeySignature {
  fifths: number;
  mode: 'major' | 'minor';
}

export type NavigationMarkType =
  | 'REPEAT_START'
  | 'REPEAT_END'
  | 'ENDING_START'
  | 'ENDING_STOP'
  | 'DA_CAPO'
  | 'DA_CAPO_AL_FINE'
  | 'DAL_SEGNO'
  | 'DAL_SEGNO_AL_FINE'
  | 'DAL_SEGNO_AL_CODA'
  | 'SEGNO'
  | 'CODA'
  | 'TO_CODA'
  | 'FINE';

export interface NavigationMark {
  id: string;
  type: NavigationMarkType;
  measureId: MeasureID;
  endingNumbers?: number[];
  repeatTimes?: number;
  label?: string;
}

export interface Measure {
  id: StableMeasureId;
  number: number;
  sourceXmlId: string;
  partId: ScorePartID;
  displayNumber?: string;
  timeSignature?: TimeSignature;
  keySignature?: KeySignature;
  divisions: number;
  durationDivisions: number;
  chordSymbols: string[];
  lyrics: string[];
  navigationMarks: NavigationMark[];
}

export interface ScorePart {
  id: ScorePartID;
  name: string;
  abbreviation?: string;
  measures: Measure[];
}

export interface ScoreVersion {
  id: ScoreVersionID;
  scoreId: ScoreID;
  title: string;
  sourceXml: string;
  parts: ScorePart[];
}

export interface ScoreDocument {
  id: ScoreID;
  title: string;
  composer?: string;
  sample: boolean;
  versions: ScoreVersion[];
  currentVersionId: ScoreVersionID;
}

export interface BeatPosition {
  measureId: StableMeasureId;
  beatIndex: number;
}

export interface PerformanceMeasure {
  id: PerformanceMeasureID;
  sourceMeasureId: MeasureID;
  occurrence: number;
  orderIndex: number;
  passNumber?: number;
  navigationReason?: string;
  sourceMeasureNumber?: number;
}

export type RepeatExpansionWarningCode =
  | 'MISSING_REPEAT_START'
  | 'MISSING_SEGNO'
  | 'MISSING_CODA'
  | 'MISSING_TO_CODA'
  | 'INVALID_ENDING'
  | 'NAVIGATION_LOOP_PREVENTED'
  | 'MAX_TRANSITIONS_EXCEEDED'
  | 'MAX_OUTPUT_LENGTH_EXCEEDED';

export interface RepeatExpansionWarning {
  code: RepeatExpansionWarningCode;
  message: string;
  sourceMeasureId?: MeasureID;
  severity: 'INFO' | 'WARNING' | 'ERROR';
}

export interface PerformanceOrder {
  measures: PerformanceMeasure[];
  warnings: RepeatExpansionWarning[];
}

export function createStableMeasureId(scoreId: ScoreID, partIndex: number, measureNumber: number, xmlId: string): StableMeasureId {
  return `${scoreId}:p${partIndex + 1}:m${measureNumber}:${xmlId}`;
}

export function createPerformanceMeasureId(sourceMeasureId: MeasureID, occurrence: number): PerformanceMeasureID {
  return `${sourceMeasureId}::${occurrence}`;
}

export function calculateNominalMeasureBeatCount(measure: Measure): number {
  return measure.timeSignature?.beats ?? Math.max(1, Math.round(calculateMeasureBeatCount(measure)));
}

export function calculateMeasureBeatCount(measure: Measure): number {
  if (measure.divisions > 0 && measure.durationDivisions > 0 && measure.timeSignature) {
    return (measure.durationDivisions * measure.timeSignature.beatType) / (4 * measure.divisions);
  }

  return measure.timeSignature?.beats ?? 4;
}
