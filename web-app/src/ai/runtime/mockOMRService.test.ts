import { describe, expect, it } from 'vitest';
import { MockOMRService } from './mockOMRService';

describe('MockOMRService', () => {
  it('returns deterministic mock results', async () => {
    const service = new MockOMRService();
    const result = await service.recognize([
      { pageId: 'page-1', label: 'Page 1' },
      { pageId: 'page-2', label: 'Page 2' }
    ]);

    expect(result.engine).toBe('mock');
    expect(result.modelVersion).toBe('mock-omr-0');
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]).toEqual({
      pageId: 'page-1',
      score: 'Mock recognition for Page 1',
      confidence: 0.9
    });
  });
});
