export interface RehearsalState {
  mode: 'idle' | 'count-in' | 'playing';
  positionLabel: string;
}

export function createDefaultRehearsalState(): RehearsalState {
  return {
    mode: 'idle',
    positionLabel: 'measure 1 / beat 1'
  };
}
