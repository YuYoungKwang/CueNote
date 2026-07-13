import type { PerformanceMeasure } from '@cuenote/score-domain';
import type {
  AuthoritativePlaybackState,
  RehearsalFollowMode,
  RehearsalParticipant,
  RehearsalSessionSummary
} from '@cuenote/score-domain';
import { DEFAULT_API_BASE_URL, type ApiEnvelope } from './client';

export interface CreateRehearsalSessionInput {
  ensembleId: string;
  scoreId: string;
  scoreVersionId: string;
  performanceOrder: PerformanceMeasure[];
  initialPosition: {
    performanceMeasureId: string;
    sourceMeasureId: string;
    occurrence: number;
    beat: number;
    baseTimelinePositionMs: number;
  };
  bpm: number;
  countInMeasures: number;
}

export interface RehearsalSessionApi {
  list(accessToken: string, ensembleId: string): Promise<RehearsalSessionSummary[]>;
  create(accessToken: string, input: CreateRehearsalSessionInput): Promise<RehearsalSessionSummary>;
  get(accessToken: string, sessionId: string): Promise<RehearsalSessionSummary & { participants: RehearsalParticipant[]; state: AuthoritativePlaybackState }>;
  join(accessToken: string, sessionId: string, followMode: RehearsalFollowMode): Promise<RehearsalSessionSummary>;
  leave(accessToken: string, sessionId: string): Promise<void>;
  end(accessToken: string, sessionId: string): Promise<RehearsalSessionSummary>;
  transferLeader(accessToken: string, sessionId: string, leaderUserId: string): Promise<RehearsalSessionSummary>;
}

export function createRehearsalSessionApi(baseUrl: string = DEFAULT_API_BASE_URL): RehearsalSessionApi {
  return {
    async list(accessToken, ensembleId) {
      return (await request<RehearsalSessionSummary[]>(`${baseUrl}/ensembles/${ensembleId}/rehearsal-sessions`, accessToken)).data;
    },
    async create(accessToken, input) {
      return (await request<RehearsalSessionSummary>(`${baseUrl}/ensembles/${input.ensembleId}/rehearsal-sessions`, accessToken, {
        method: 'POST',
        body: JSON.stringify({
          scoreId: input.scoreId,
          scoreVersionId: input.scoreVersionId,
          initialPosition: input.initialPosition,
          bpm: input.bpm,
          countInMeasures: input.countInMeasures,
          performanceOrder: input.performanceOrder.map((measure) => ({
            id: measure.id,
            sourceMeasureId: measure.sourceMeasureId,
            occurrence: measure.occurrence,
            orderIndex: measure.orderIndex
          }))
        })
      })).data;
    },
    async get(accessToken, sessionId) {
      return (await request<RehearsalSessionSummary & { participants: RehearsalParticipant[]; state: AuthoritativePlaybackState }>(
        `${baseUrl}/rehearsal-sessions/${sessionId}`,
        accessToken
      )).data;
    },
    async join(accessToken, sessionId, followMode) {
      return (await request<RehearsalSessionSummary>(`${baseUrl}/rehearsal-sessions/${sessionId}/join`, accessToken, {
        method: 'POST',
        body: JSON.stringify({ followMode })
      })).data;
    },
    async leave(accessToken, sessionId) {
      await request(`${baseUrl}/rehearsal-sessions/${sessionId}/leave`, accessToken, { method: 'POST', body: JSON.stringify({}) });
    },
    async end(accessToken, sessionId) {
      return (await request<RehearsalSessionSummary>(`${baseUrl}/rehearsal-sessions/${sessionId}/end`, accessToken, {
        method: 'POST',
        body: JSON.stringify({})
      })).data;
    },
    async transferLeader(accessToken, sessionId, leaderUserId) {
      return (await request<RehearsalSessionSummary>(`${baseUrl}/rehearsal-sessions/${sessionId}/leader`, accessToken, {
        method: 'PATCH',
        body: JSON.stringify({ leaderUserId })
      })).data;
    }
  };
}

async function request<T>(url: string, accessToken: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as ApiEnvelope<T>;
}
