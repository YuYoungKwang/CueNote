import simpleDuetXml from './simple-duet.musicxml?raw';
import lyricsAndChordsXml from './lyrics-and-chords.musicxml?raw';

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
    description: '단선율 단순 진행과 안정적인 마디 이동을 검증하는 샘플입니다.',
    sourceXml: simpleDuetXml
  },
  {
    id: 'lyrics-and-chords',
    title: 'Lyrics and Chords',
    composer: 'CueNote Team',
    description: '코드와 가사 추출 경로를 함께 확인하는 샘플입니다.',
    sourceXml: lyricsAndChordsXml
  }
];

export function findSampleScore(scoreId: string): SampleScore | undefined {
  return SAMPLE_SCORES.find((sample) => sample.id === scoreId);
}
