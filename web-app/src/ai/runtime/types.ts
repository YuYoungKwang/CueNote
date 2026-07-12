export interface OMRSourcePage {
  pageId: string;
  label: string;
  imageUrl?: string;
}

export interface OMRRecognitionPage {
  pageId: string;
  score: string;
  confidence: number;
}

export interface OMRRecognitionResult {
  engine: 'mock';
  modelVersion: string;
  pages: OMRRecognitionPage[];
  producedAt: string;
}

export interface OMRService {
  recognize(pages: OMRSourcePage[]): Promise<OMRRecognitionResult>;
}
