export type ScoreID = string;
export type ScoreVersionID = string;
export type ScorePartID = string;
export type MeasureID = string;
export type StableMeasureId = string;

export interface TimeSignature {
  beats: number;
  beatType: number;
}

export interface KeySignature {
  fifths: number;
  mode: 'major' | 'minor';
}

export interface Measure {
  id: StableMeasureId;
  number: number;
  sourceXmlId: string;
  partId: ScorePartID;
  displayNumber?: string;
  timeSignature?: TimeSignature;
  keySignature?: KeySignature;
  chordSymbols: string[];
  lyrics: string[];
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

export function createStableMeasureId(scoreId: ScoreID, partIndex: number, measureNumber: number, xmlId: string): StableMeasureId {
  return `${scoreId}:p${partIndex + 1}:m${measureNumber}:${xmlId}`;
}
