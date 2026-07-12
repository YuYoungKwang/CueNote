import type { OMRRecognitionResult, OMRService, OMRSourcePage } from './types';

export class MockOMRService implements OMRService {
  async recognize(pages: OMRSourcePage[]): Promise<OMRRecognitionResult> {
    return {
      engine: 'mock',
      modelVersion: 'mock-omr-0',
      producedAt: '1970-01-01T00:00:00.000Z',
      pages: pages.map((page, index) => ({
        pageId: page.pageId,
        score: `Mock recognition for ${page.label}`,
        confidence: Number((0.9 - index * 0.05).toFixed(2))
      }))
    };
  }
}
