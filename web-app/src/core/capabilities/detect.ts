export interface BrowserCapabilities {
  indexedDb: boolean;
  serviceWorker: boolean;
  cacheStorage: boolean;
  pointerEvents: boolean;
  webWorker: boolean;
  webGpu: boolean;
  wakeLock: boolean;
}

type CapabilitySource = {
  indexedDB?: unknown;
  caches?: unknown;
  navigator?: {
    serviceWorker?: unknown;
    wakeLock?: unknown;
    gpu?: unknown;
  };
  PointerEvent?: unknown;
  Worker?: unknown;
};

export function detectBrowserCapabilities(source: CapabilitySource = globalThis as CapabilitySource): BrowserCapabilities {
  return {
    indexedDb: typeof source.indexedDB !== 'undefined',
    serviceWorker: typeof source.navigator?.serviceWorker !== 'undefined',
    cacheStorage: typeof source.caches !== 'undefined',
    pointerEvents: typeof source.PointerEvent !== 'undefined',
    webWorker: typeof source.Worker !== 'undefined',
    webGpu: typeof source.navigator?.gpu !== 'undefined',
    wakeLock: typeof source.navigator?.wakeLock !== 'undefined'
  };
}
