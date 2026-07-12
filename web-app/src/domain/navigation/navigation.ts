export interface NavigationState {
  currentMeasureId: string;
  beatIndex: number;
}

export function createNavigationState(currentMeasureId = 'measure-001', beatIndex = 0): NavigationState {
  return { currentMeasureId, beatIndex };
}
