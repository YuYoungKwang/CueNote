import {
  createOmrClassIndexMap,
  validateOmrManifest,
  type OmrClassIndexMap,
  type OmrModelManifest
} from '@cuenote/score-domain';

export interface ParsedOmrModelManifest {
  manifest: OmrModelManifest;
  classIndex: OmrClassIndexMap;
}

export function parseOmrModelManifest(value: unknown): ParsedOmrModelManifest {
  if (!value || typeof value !== 'object') {
    throw new Error('MODEL_MANIFEST_INVALID');
  }
  const manifest = value as OmrModelManifest;
  const warnings = validateOmrManifest(manifest);
  if (warnings.some((warning) => warning.severity === 'error')) {
    throw new Error(warnings.map((warning) => warning.message).join(' '));
  }
  return {
    manifest,
    classIndex: createOmrClassIndexMap(manifest)
  };
}

export async function fetchOmrModelManifest(url: string, signal?: AbortSignal): Promise<ParsedOmrModelManifest> {
  const absoluteUrl = new URL(url, self.location.origin).toString();
  const cache = await caches.open('cuenote-omr-models-v1');
  const cached = await cache.match(absoluteUrl);

  try {
    const response = await fetch(absoluteUrl, { signal, cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`MODEL_DOWNLOAD_FAILED: ${response.status}`);
    }
    await cache.put(absoluteUrl, response.clone());
    return parseOmrModelManifest(await response.json());
  } catch (error) {
    if (cached) {
      return parseOmrModelManifest(await cached.json());
    }
    throw error;
  }
}
