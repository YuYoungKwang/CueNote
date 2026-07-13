import type { KeySignature, NavigationMark, ScoreID, ScorePartID, ScoreVersionID, StableMeasureId, TimeSignature } from '../model';

export type EditSeverity = 'INFO' | 'WARNING' | 'ERROR';

export interface ValidationIssue {
  code: string;
  severity: EditSeverity;
  message: string;
  partId?: ScorePartID;
  measureId?: StableMeasureId;
  eventId?: string;
  fragmentId?: string;
  blocking: boolean;
}

export type OpaqueMusicXmlParentType = 'SCORE_PARTWISE' | 'PART_LIST' | 'PART' | 'MEASURE' | 'NOTE' | 'DIRECTION' | 'HARMONY';

export type OpaqueMusicXmlFragmentStatus = 'OPAQUE_PRESERVED' | 'DROPPED_FOR_SECURITY' | 'UNSUPPORTED_UNPRESERVABLE';

export interface OpaqueMusicXmlFragment {
  id: string;
  parentType: OpaqueMusicXmlParentType;
  parentId: string;
  originalOrder: number;
  elementName: string;
  xml: string;
  namespaceUri?: string;
  status: OpaqueMusicXmlFragmentStatus;
}

export interface EditableScoreDocument {
  scoreId: ScoreID;
  baseScoreVersionId: ScoreVersionID;
  title: string;
  parts: EditablePart[];
  revision: number;
  dirty: boolean;
  opaqueFragments: OpaqueMusicXmlFragment[];
  validationIssues: ValidationIssue[];
}

export interface EditablePart {
  id: ScorePartID;
  name: string;
  abbreviation?: string;
  measures: EditableMeasure[];
}

export interface EditableMeasure {
  id: StableMeasureId;
  sourceMeasureId: StableMeasureId;
  number: number;
  attributes: EditableMeasureAttributes;
  events: EditableEvent[];
  chordSymbols: EditableChordSymbol[];
  lyrics: EditableLyric[];
  navigationMarks: NavigationMark[];
}

export interface EditableMeasureAttributes {
  divisions: number;
  timeSignature?: TimeSignature;
  keySignature?: KeySignature;
  clef?: EditableClef;
}

export interface EditableClef {
  sign: string;
  line: number;
}

export type EditableEvent = EditableNoteEvent | EditableRestEvent;

export interface EditableNoteEvent {
  kind: 'NOTE';
  id: string;
  pitch: Pitch;
  duration: DurationValue;
  voice?: string;
  staff?: string;
  tie?: 'start' | 'stop' | 'continue';
  originalOrder?: number;
  lyricIds: string[];
  unsupported?: string[];
}

export interface EditableRestEvent {
  kind: 'REST';
  id: string;
  duration: DurationValue;
  voice?: string;
  staff?: string;
  originalOrder?: number;
  unsupported?: string[];
}

export interface Pitch {
  step: PitchStep;
  alter: -1 | 0 | 1;
  octave: number;
}

export type PitchStep = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

export interface DurationValue {
  divisions: number;
  type: DurationType;
  dotted: boolean;
  unsupportedTuplet?: boolean;
}

export type DurationType = 'whole' | 'half' | 'quarter' | 'eighth' | '16th';

export interface EditableChordSymbol {
  id: string;
  root: PitchStep;
  alter: -1 | 0 | 1;
  quality: ChordQuality;
  bass?: { step: PitchStep; alter: -1 | 0 | 1 };
  displayText: string;
  measureId: StableMeasureId;
  originalOrder?: number;
}

export type ChordQuality = 'major' | 'minor' | 'dominant' | 'major-seventh' | 'minor-seventh' | 'half-diminished' | 'other';

export interface EditableLyric {
  id: string;
  eventId: string;
  verse: string;
  syllabic: 'single' | 'begin' | 'middle' | 'end';
  text: string;
}

export type AnnotationMigrationPolicy = 'NONE' | 'MEASURE_ONLY';

export type EditCommand =
  | { type: 'CHANGE_PITCH'; partId: string; measureId: string; eventId: string; pitch: Pitch }
  | { type: 'TRANSPOSE_EVENT'; partId: string; measureId: string; eventId: string; semitones: number }
  | { type: 'CHANGE_DURATION'; partId: string; measureId: string; eventId: string; duration: DurationValue }
  | { type: 'CHANGE_CHORD'; partId: string; measureId: string; chordId: string; chord: Omit<EditableChordSymbol, 'id' | 'measureId'> }
  | { type: 'CHANGE_LYRIC'; partId: string; measureId: string; lyricId: string; text: string; eventId?: string; syllabic?: EditableLyric['syllabic'] }
  | { type: 'INSERT_MEASURE'; afterMeasureId?: string }
  | { type: 'DELETE_MEASURE'; measureId: string }
  | { type: 'DUPLICATE_MEASURE'; measureId: string }
  | { type: 'TRANSPOSE_RANGE'; semitones: number; partId?: string; startMeasureId?: string; endMeasureId?: string };

export interface EditHistoryState {
  present: EditableScoreDocument;
  past: EditableScoreDocument[];
  future: EditableScoreDocument[];
  maxHistory: number;
}

export type IdGenerator = (prefix: string) => string;

export const DEFAULT_MAX_HISTORY = 50;
