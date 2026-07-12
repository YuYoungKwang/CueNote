export interface PreprocessingStep {
  name: string;
  enabled: boolean;
}

export const defaultImagePipeline: PreprocessingStep[] = [
  { name: 'decode', enabled: true },
  { name: 'normalize', enabled: true },
  { name: 'crop', enabled: true },
  { name: 'tensor', enabled: true }
];
