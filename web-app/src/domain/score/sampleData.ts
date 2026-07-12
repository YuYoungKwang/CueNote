import type { ScoreSummary } from './score';

export function createSampleScoreSummary(): ScoreSummary {
  return {
    id: 'score-001',
    title: 'Prelude in C',
    measureCount: 24,
    updatedAt: '2026-07-12',
    source: 'local'
  };
}
