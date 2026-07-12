import simpleDuetXml from './simple-duet.musicxml?raw';
import lyricsAndChordsXml from './lyrics-and-chords.musicxml?raw';
import repeatSimpleXml from './repeat-simple.musicxml?raw';
import repeatEndingsXml from './repeat-endings.musicxml?raw';
import dcAlFineXml from './dc-al-fine.musicxml?raw';
import dsAlCodaXml from './ds-al-coda.musicxml?raw';
import invalidNavigationXml from './invalid-navigation.musicxml?raw';

export interface SampleScore {
  id: string;
  title: string;
  composer: string;
  description: string;
  sourceXml: string;
}

export const SAMPLE_SCORES: SampleScore[] = [
  {
    id: 'simple-duet',
    title: 'Simple Duet',
    composer: 'CueNote Team',
    description: 'Baseline Phase 1 fixture for stable MusicXML parsing, rendering, and measure navigation.',
    sourceXml: simpleDuetXml
  },
  {
    id: 'lyrics-and-chords',
    title: 'Lyrics and Chords',
    composer: 'CueNote Team',
    description: 'Fixture with harmony and lyrics for parser and viewer coverage.',
    sourceXml: lyricsAndChordsXml
  },
  {
    id: 'repeat-simple',
    title: 'Repeat Simple',
    composer: 'CueNote Team',
    description: 'Simple forward and backward repeat flow for Phase 2 playback-order checks.',
    sourceXml: repeatSimpleXml
  },
  {
    id: 'repeat-endings',
    title: 'Repeat Endings',
    composer: 'CueNote Team',
    description: 'First and second ending fixture for repeat expansion and viewer playback.',
    sourceXml: repeatEndingsXml
  },
  {
    id: 'dc-al-fine',
    title: 'Da Capo al Fine',
    composer: 'CueNote Team',
    description: 'Da Capo navigation fixture for jump parsing and al Fine stopping.',
    sourceXml: dcAlFineXml
  },
  {
    id: 'ds-al-coda',
    title: 'Dal Segno al Coda',
    composer: 'CueNote Team',
    description: 'Segno and Coda fixture for repeated source measures with distinct occurrences.',
    sourceXml: dsAlCodaXml
  },
  {
    id: 'invalid-navigation',
    title: 'Invalid Navigation',
    composer: 'CueNote Team',
    description: 'Malformed navigation fixture that should warn without crashing the viewer.',
    sourceXml: invalidNavigationXml
  }
];

export function findSampleScore(scoreId: string): SampleScore | undefined {
  return SAMPLE_SCORES.find((sample) => sample.id === scoreId);
}
