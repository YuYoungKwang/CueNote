import type { OmrModelManifest } from '@cuenote/score-domain';

const CACHE_NAME = 'cuenote-omr-models-v1';

export interface OmrModelCacheMetadata {
  id: string;
  modelId: string;
  version: string;
  sha256: string;
  sizeBytes: number;
  cachedAt: number;
  verifiedAt: number;
  sourceUrl: string;
  status: 'VERIFIED' | 'ROLLBACK_CANDIDATE';
}

export interface OmrModelRepository {
  getModelBytes(manifest: OmrModelManifest, manifestUrl: string, signal?: AbortSignal): Promise<{ bytes: ArrayBuffer; cacheHit: boolean; metadata: OmrModelCacheMetadata }>;
  clearModel(manifest: OmrModelManifest): Promise<void>;
}

export function createOmrModelRepository(): OmrModelRepository {
  return {
    async getModelBytes(manifest, manifestUrl, signal) {
      const sourceUrl = new URL(manifest.file, new URL(manifestUrl, self.location.origin)).toString();
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(sourceUrl);
      if (cached) {
        const cachedBytes = await cached.arrayBuffer();
        if (cachedBytes.byteLength === manifest.sizeBytes && (await sha256Hex(cachedBytes)) === manifest.sha256) {
          return { bytes: cachedBytes, cacheHit: true, metadata: metadataFor(manifest, sourceUrl, 'VERIFIED') };
        }
        await cache.delete(sourceUrl);
      }

      const response = await fetch(sourceUrl, { signal, cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`MODEL_DOWNLOAD_FAILED: ${response.status}`);
      }
      const bytes = await response.arrayBuffer();
      const digest = await sha256Hex(bytes);
      if (bytes.byteLength !== manifest.sizeBytes || digest !== manifest.sha256) {
        throw new Error('MODEL_HASH_MISMATCH');
      }
      await cache.put(sourceUrl, new Response(bytes.slice(0), { headers: { 'content-type': 'application/octet-stream' } }));
      return { bytes, cacheHit: false, metadata: metadataFor(manifest, sourceUrl, 'VERIFIED') };
    },
    async clearModel(manifest) {
      const cache = await caches.open(CACHE_NAME);
      const keys = await cache.keys();
      await Promise.all(keys.filter((request) => request.url.includes(`/${manifest.file}`)).map((request) => cache.delete(request)));
    }
  };
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function metadataFor(manifest: OmrModelManifest, sourceUrl: string, status: OmrModelCacheMetadata['status']): OmrModelCacheMetadata {
  const now = Date.now();
  return {
    id: `${manifest.modelId}:${manifest.version}`,
    modelId: manifest.modelId,
    version: manifest.version,
    sha256: manifest.sha256,
    sizeBytes: manifest.sizeBytes,
    cachedAt: now,
    verifiedAt: now,
    sourceUrl,
    status
  };
}
