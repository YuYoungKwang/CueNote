import type { Annotation } from '@cuenote/score-domain';

export interface ApiMeta {
  requestId: string;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
  meta: ApiMeta;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthSession {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

export interface EnsembleSummary {
  id: string;
  name: string;
  role: string;
}

export interface ServerScoreSummary {
  id: string;
  ensemble_id: string;
  title: string;
  composer?: string | null;
  current_version_id: string;
  current_version_number?: number;
  revision?: number;
}

export interface ServerScoreVersion {
  id: string;
  score_id: string;
  version_number: number;
  title: string;
  content_hash: string;
  byte_size: number;
  mime_type: string;
  base_score_version_id?: string | null;
  edit_summary?: string | null;
  annotation_migration_policy?: string | null;
}

export interface CreateScoreVersionOptions {
  baseScoreVersionId?: string;
  editSummary?: string;
  annotationMigrationPolicy?: 'NONE' | 'MEASURE_ONLY';
  expectedScoreRevision?: number;
}

export interface ServerScoreDetail extends ServerScoreSummary {
  versions: ServerScoreVersion[];
}

export interface AnnotationSyncMutation {
  clientMutationId: string;
  baseRevision: number;
  action: 'UPSERT' | 'DELETE';
  annotation?: Annotation;
  annotationId?: string;
}

export interface AnnotationSyncResult {
  applied: Array<{
    clientMutationId: string;
    annotationId: string;
    revision: number;
    annotation?: Annotation;
    idempotentReplay?: boolean;
  }>;
  conflicts: Array<{
    clientMutationId: string;
    annotationId: string;
    serverRevision: number;
    serverAnnotation?: Annotation;
  }>;
}

export interface ApiClient {
  baseUrl: string;
  getHealth(): Promise<ApiEnvelope<{ status: string; version: string }>>;
  loginDev(email: string, displayName: string): Promise<AuthSession>;
  refresh(refreshToken: string): Promise<AuthSession>;
  getMe(accessToken: string): Promise<AuthUser>;
  listEnsembles(accessToken: string): Promise<EnsembleSummary[]>;
  createEnsemble(accessToken: string, name: string): Promise<EnsembleSummary>;
  listScores(accessToken: string, ensembleId: string): Promise<ServerScoreSummary[]>;
  createScore(accessToken: string, ensembleId: string, title: string, composer: string | undefined, sourceXml: string): Promise<ServerScoreDetail>;
  createScoreVersion(
    accessToken: string,
    scoreId: string,
    title: string,
    sourceXml: string,
    options?: CreateScoreVersionOptions
  ): Promise<ServerScoreVersion>;
  getScore(accessToken: string, scoreId: string): Promise<ServerScoreDetail>;
  getScoreVersionSource(accessToken: string, scoreId: string, versionId: string): Promise<string>;
  listAnnotations(accessToken: string, scoreId: string, scoreVersionId: string): Promise<Annotation[]>;
  syncAnnotations(accessToken: string, scoreId: string, scoreVersionId: string, mutations: AnnotationSyncMutation[]): Promise<AnnotationSyncResult>;
}

export const DEFAULT_API_BASE_URL = import.meta.env.VITE_CUENOTE_API_BASE_URL ?? 'http://127.0.0.1:8080/api/v1';

export function createApiClient(baseUrl: string = DEFAULT_API_BASE_URL): ApiClient {
  return {
    baseUrl,
    async getHealth() {
      return requestEnvelope<{ status: string; version: string }>(`${baseUrl}/health`);
    },
    async loginDev(email, displayName) {
      return (await requestEnvelope<AuthSession>(`${baseUrl}/dev-auth/login`, {
        method: 'POST',
        body: JSON.stringify({ email, displayName }),
        headers: jsonHeaders()
      })).data;
    },
    async refresh(refreshToken) {
      return (await requestEnvelope<AuthSession>(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
        headers: jsonHeaders()
      })).data;
    },
    async getMe(accessToken) {
      return (await requestEnvelope<AuthUser>(`${baseUrl}/auth/me`, { headers: authHeaders(accessToken) })).data;
    },
    async listEnsembles(accessToken) {
      return (await requestEnvelope<EnsembleSummary[]>(`${baseUrl}/ensembles`, { headers: authHeaders(accessToken) })).data;
    },
    async createEnsemble(accessToken, name) {
      return (await requestEnvelope<EnsembleSummary>(`${baseUrl}/ensembles`, {
        method: 'POST',
        headers: authJsonHeaders(accessToken),
        body: JSON.stringify({ name })
      })).data;
    },
    async listScores(accessToken, ensembleId) {
      return (await requestEnvelope<ServerScoreSummary[]>(`${baseUrl}/ensembles/${ensembleId}/scores`, { headers: authHeaders(accessToken) })).data;
    },
    async createScore(accessToken, ensembleId, title, composer, sourceXml) {
      const formData = new FormData();
      formData.set('title', title);
      if (composer) {
        formData.set('composer', composer);
      }
      formData.set('file', new Blob([sourceXml], { type: 'application/xml' }), `${slugify(title)}.musicxml`);
      return (await requestEnvelope<ServerScoreDetail>(`${baseUrl}/ensembles/${ensembleId}/scores`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: formData
      })).data;
    },
    async createScoreVersion(accessToken, scoreId, title, sourceXml, options) {
      const formData = new FormData();
      formData.set('title', title);
      formData.set('file', new Blob([sourceXml], { type: 'application/xml' }), `${slugify(title)}.musicxml`);
      if (options?.baseScoreVersionId) {
        formData.set('baseScoreVersionId', options.baseScoreVersionId);
      }
      if (options?.editSummary) {
        formData.set('editSummary', options.editSummary);
      }
      if (options?.annotationMigrationPolicy) {
        formData.set('annotationMigrationPolicy', options.annotationMigrationPolicy);
      }
      if (options?.expectedScoreRevision != null) {
        formData.set('expectedScoreRevision', String(options.expectedScoreRevision));
      }
      return (await requestEnvelope<ServerScoreVersion>(`${baseUrl}/scores/${scoreId}/versions`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: formData
      })).data;
    },
    async getScore(accessToken, scoreId) {
      return (await requestEnvelope<ServerScoreDetail>(`${baseUrl}/scores/${scoreId}`, { headers: authHeaders(accessToken) })).data;
    },
    async getScoreVersionSource(accessToken, scoreId, versionId) {
      const response = await fetch(`${baseUrl}/scores/${scoreId}/versions/${versionId}/source`, {
        headers: authHeaders(accessToken)
      });
      await assertOk(response);
      return response.text();
    },
    async listAnnotations(accessToken, scoreId, scoreVersionId) {
      const url = new URL(`${baseUrl}/scores/${scoreId}/annotations`);
      url.searchParams.set('scoreVersionId', scoreVersionId);
      return (await requestEnvelope<Annotation[]>(url.toString(), { headers: authHeaders(accessToken) })).data;
    },
    async syncAnnotations(accessToken, scoreId, scoreVersionId, mutations) {
      return (await requestEnvelope<AnnotationSyncResult>(`${baseUrl}/scores/${scoreId}/annotations/sync`, {
        method: 'POST',
        headers: authJsonHeaders(accessToken),
        body: JSON.stringify({ scoreVersionId, mutations })
      })).data;
    }
  };
}

async function requestEnvelope<T>(url: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const response = await fetch(url, init);
  await assertOk(response);
  return (await response.json()) as ApiEnvelope<T>;
}

async function assertOk(response: Response) {
  if (response.ok) {
    return;
  }

  let message = `${response.status} ${response.statusText}`;
  let details: Record<string, unknown> = {};
  try {
    const body = (await response.json()) as ApiErrorEnvelope;
    message = body.error?.message ?? message;
    details = body.error?.details ?? {};
  } catch {
    // Non-JSON errors still surface with the HTTP status text.
  }
  throw Object.assign(new Error(message), { status: response.status, details });
}

function jsonHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json' };
}

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

function authJsonHeaders(accessToken: string): HeadersInit {
  return { ...authHeaders(accessToken), ...jsonHeaders() };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'score';
}
