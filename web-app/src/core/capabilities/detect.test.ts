import { describe, expect, it } from 'vitest';
import { detectBrowserCapabilities } from './detect';

describe('detectBrowserCapabilities', () => {
  it('marks browser APIs when present', () => {
    const capabilities = detectBrowserCapabilities({
      indexedDB: {},
      caches: {},
      PointerEvent: function PointerEvent() {},
      Worker: function Worker() {},
      navigator: {
        serviceWorker: {},
        wakeLock: {},
        gpu: {}
      },
    });

    expect(capabilities).toEqual({
      indexedDb: true,
      serviceWorker: true,
      cacheStorage: true,
      pointerEvents: true,
      webWorker: true,
      webGpu: true,
      wakeLock: true
    });
  });
});
