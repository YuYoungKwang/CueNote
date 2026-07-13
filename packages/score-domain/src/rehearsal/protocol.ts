import type { PerformanceMeasure, PerformanceMeasureID, ScoreID, ScoreVersionID, StableMeasureId } from '../model';
import type { PlaybackStatus } from '../playback/playbackTimeline';

export type RehearsalSessionStatus = 'CREATED' | 'ACTIVE' | 'ENDED';
export type RehearsalConnectionState = 'CONNECTED' | 'DISCONNECTED';
export type RehearsalFollowMode = 'FOLLOWING_LEADER' | 'BROWSING_INDEPENDENTLY';
export type RehearsalParticipantRole = 'LEADER' | 'PARTICIPANT';

export interface AuthoritativePlaybackState {
  sessionId: string;
  scoreId: ScoreID;
  scoreVersionId: ScoreVersionID;
  leaderUserId: string;
  playbackStatus: PlaybackStatus;
  performanceMeasureId: PerformanceMeasureID;
  sourceMeasureId: StableMeasureId;
  occurrence: number;
  beat: number;
  bpm: number;
  countInMeasures: number;
  baseTimelinePositionMs: number;
  sequence: number;
  serverTimestamp: number;
  effectiveAtServerTime: number;
  updatedByUserId: string;
}

export interface RehearsalPerformanceEntry extends PerformanceMeasure {
  beatCount?: number;
}

export interface RehearsalSessionSummary {
  id: string;
  ensembleId: string;
  scoreId: ScoreID;
  scoreVersionId: ScoreVersionID;
  leaderUserId: string;
  status: RehearsalSessionStatus;
  createdBy: string;
  createdAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  revision: number;
  state: AuthoritativePlaybackState;
}

export interface RehearsalParticipant {
  sessionId: string;
  userId: string;
  displayName?: string;
  connectionState: RehearsalConnectionState;
  followMode: RehearsalFollowMode;
  joinedAt: string;
  lastSeenAt: string;
}

export type RehearsalClientMessageType =
  | 'JOIN_SESSION'
  | 'LEAVE_SESSION'
  | 'REQUEST_STATE_SNAPSHOT'
  | 'PING'
  | 'PLAY_REQUEST'
  | 'PAUSE_REQUEST'
  | 'STOP_REQUEST'
  | 'SEEK_REQUEST'
  | 'BPM_CHANGE_REQUEST'
  | 'COUNT_IN_CHANGE_REQUEST'
  | 'LEADER_TRANSFER_REQUEST'
  | 'FOLLOW_MODE_CHANGE';

export type RehearsalServerMessageType =
  | 'SESSION_JOINED'
  | 'PARTICIPANT_JOINED'
  | 'PARTICIPANT_LEFT'
  | 'PARTICIPANT_LIST'
  | 'STATE_SNAPSHOT'
  | 'PLAYBACK_STATE_CHANGED'
  | 'LEADER_CHANGED'
  | 'PONG'
  | 'COMMAND_REJECTED'
  | 'SESSION_ENDED'
  | 'ERROR';

export interface RehearsalEnvelope<TType extends string, TPayload = unknown> {
  protocolVersion: 1;
  type: TType;
  sessionId?: string;
  clientCommandId?: string;
  sequence?: number;
  serverTimestamp?: number;
  payload: TPayload;
}

export interface JoinSessionPayload {
  accessToken: string;
  lastAppliedSequence?: number;
  followMode?: RehearsalFollowMode;
}

export interface PingPayload {
  clientSentAt: number;
}

export interface RehearsalPositionPayload {
  scoreVersionId: ScoreVersionID;
  performanceMeasureId: PerformanceMeasureID;
  sourceMeasureId: StableMeasureId;
  occurrence: number;
  beat: number;
  baseTimelinePositionMs: number;
}

export interface RehearsalPlaybackCommandPayload extends RehearsalPositionPayload {
  bpm?: number;
  countInMeasures?: number;
}

export interface PongPayload {
  clientSentAt: number;
  serverReceivedAt: number;
  serverSentAt: number;
}

export interface StateSnapshotPayload {
  session: RehearsalSessionSummary;
  participants: RehearsalParticipant[];
  state: AuthoritativePlaybackState;
  reason?: string;
}

export interface CommandRejectedPayload {
  code: string;
  message: string;
  clientCommandId?: string;
}
