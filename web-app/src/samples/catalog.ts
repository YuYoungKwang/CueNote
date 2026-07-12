import { SAMPLE_SCORES } from './sampleScores';

export const sampleCatalog = SAMPLE_SCORES.map((sample) => ({
  id: sample.id,
  title: sample.title,
  composer: sample.composer,
  description: sample.description
}));

export function getSampleById(scoreId: string) {
  return SAMPLE_SCORES.find((sample) => sample.id === scoreId) ?? null;
}
