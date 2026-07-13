import type { EditableChordSymbol, Pitch, PitchStep } from './model';

const SHARP_STEPS: Array<{ step: PitchStep; alter: -1 | 0 | 1 }> = [
  { step: 'C', alter: 0 },
  { step: 'C', alter: 1 },
  { step: 'D', alter: 0 },
  { step: 'D', alter: 1 },
  { step: 'E', alter: 0 },
  { step: 'F', alter: 0 },
  { step: 'F', alter: 1 },
  { step: 'G', alter: 0 },
  { step: 'G', alter: 1 },
  { step: 'A', alter: 0 },
  { step: 'A', alter: 1 },
  { step: 'B', alter: 0 }
];

const FLAT_STEPS: Array<{ step: PitchStep; alter: -1 | 0 | 1 }> = [
  { step: 'C', alter: 0 },
  { step: 'D', alter: -1 },
  { step: 'D', alter: 0 },
  { step: 'E', alter: -1 },
  { step: 'E', alter: 0 },
  { step: 'F', alter: 0 },
  { step: 'G', alter: -1 },
  { step: 'G', alter: 0 },
  { step: 'A', alter: -1 },
  { step: 'A', alter: 0 },
  { step: 'B', alter: -1 },
  { step: 'B', alter: 0 }
];

const NATURAL_SEMITONES: Record<PitchStep, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
};

export function transposePitch(pitch: Pitch, semitones: number): Pitch {
  const absolute = pitchToAbsoluteSemitone(pitch) + semitones;
  const octave = Math.floor(absolute / 12) - 1;
  const pitchClass = ((absolute % 12) + 12) % 12;
  const spelling = semitones < 0 ? FLAT_STEPS[pitchClass] : SHARP_STEPS[pitchClass];
  return { ...spelling, octave };
}

export function transposeChordSymbol(chord: EditableChordSymbol, semitones: number): EditableChordSymbol {
  const root = transposePitch({ step: chord.root, alter: chord.alter, octave: 4 }, semitones);
  const bass = chord.bass ? transposePitch({ ...chord.bass, octave: 4 }, semitones) : undefined;
  const next: EditableChordSymbol = {
    ...chord,
    root: root.step,
    alter: root.alter,
    bass: bass ? { step: bass.step, alter: bass.alter } : undefined
  };
  return { ...next, displayText: formatChordDisplay(next) };
}

export function transposeKeySignature(fifths: number, semitones: number): number {
  if (semitones === 0) {
    return fifths;
  }
  const circleSteps = Math.round((semitones * 7) / 12);
  return Math.max(-7, Math.min(7, fifths + circleSteps));
}

export function formatPitch(pitch: Pitch): string {
  return `${pitch.step}${formatAlter(pitch.alter)}${pitch.octave}`;
}

export function formatChordDisplay(chord: Pick<EditableChordSymbol, 'root' | 'alter' | 'quality' | 'bass'>): string {
  const qualityText: Record<EditableChordSymbol['quality'], string> = {
    major: '',
    minor: 'm',
    dominant: '7',
    'major-seventh': 'maj7',
    'minor-seventh': 'm7',
    'half-diminished': 'm7b5',
    other: ''
  };
  const bass = chord.bass ? `/${chord.bass.step}${formatAlter(chord.bass.alter)}` : '';
  return `${chord.root}${formatAlter(chord.alter)}${qualityText[chord.quality]}${bass}`;
}

function pitchToAbsoluteSemitone(pitch: Pitch): number {
  return (pitch.octave + 1) * 12 + NATURAL_SEMITONES[pitch.step] + pitch.alter;
}

function formatAlter(alter: number): string {
  if (alter > 0) {
    return '#'.repeat(alter);
  }
  if (alter < 0) {
    return 'b'.repeat(Math.abs(alter));
  }
  return '';
}
