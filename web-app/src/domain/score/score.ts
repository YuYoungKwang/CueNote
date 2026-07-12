export interface ScoreSummary {
  id: string;
  title: string;
  measureCount: number;
  updatedAt: string;
  source: 'local' | 'shared';
}
