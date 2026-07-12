export interface ScoreIdentifier {
  value: string;
}

export interface MeasureIdentifier {
  value: string;
}

export interface BeatPosition {
  measureId: MeasureIdentifier;
  beatIndex: number;
}
