import type {
  AuthoritativePlaybackState,
  RehearsalEnvelope,
  RehearsalFollowMode,
  RehearsalParticipant,
  RehearsalServerMessageType,
  RehearsalSessionSummary
} from '@cuenote/score-domain';

export interface RehearsalControllerState {
  session: RehearsalSessionSummary | null;
  participants: RehearsalParticipant[];
  authoritativeState: AuthoritativePlaybackState | null;
  followMode: RehearsalFollowMode;
  lastAppliedSequence: number;
  syncWarning: string;
}

export class RehearsalSyncController {
  private state: RehearsalControllerState = {
    session: null,
    participants: [],
    authoritativeState: null,
    followMode: 'FOLLOWING_LEADER',
    lastAppliedSequence: 0,
    syncWarning: ''
  };

  constructor(private readonly onGap: (lastAppliedSequence: number) => void) {}

  getState() {
    return this.state;
  }

  setFollowMode(followMode: RehearsalFollowMode) {
    this.state = { ...this.state, followMode };
    return this.state;
  }

  handleMessage(envelope: RehearsalEnvelope<RehearsalServerMessageType, unknown>) {
    if (envelope.type === 'STATE_SNAPSHOT' || envelope.type === 'SESSION_JOINED') {
      return this.applySnapshot(envelope.payload as SnapshotPayload, false);
    }
    if (envelope.type === 'PLAYBACK_STATE_CHANGED') {
      return this.applySnapshot(envelope.payload as SnapshotPayload, true);
    }
    if (envelope.type === 'PARTICIPANT_LIST') {
      const payload = envelope.payload as RehearsalParticipant[] | { participant?: RehearsalParticipant };
      this.state = {
        ...this.state,
        participants: Array.isArray(payload) ? payload : this.state.participants.map((item) => (item.userId === payload.participant?.userId ? payload.participant : item))
      };
      return this.state;
    }
    if (envelope.type === 'COMMAND_REJECTED' || envelope.type === 'ERROR') {
      const payload = envelope.payload as { message?: string };
      this.state = { ...this.state, syncWarning: payload.message ?? envelope.type };
      return this.state;
    }
    if (envelope.type === 'SESSION_ENDED') {
      const payload = envelope.payload as RehearsalSessionSummary;
      this.state = { ...this.state, session: payload, syncWarning: 'Session ended.' };
      return this.state;
    }
    return this.state;
  }

  private applySnapshot(payload: SnapshotPayload, detectGap: boolean) {
    const nextSequence = payload.state?.sequence ?? 0;
    if (nextSequence < this.state.lastAppliedSequence) {
      return { ...this.state, syncWarning: `Ignored stale sequence ${nextSequence}.` };
    }
    if (nextSequence === this.state.lastAppliedSequence && nextSequence !== 0 && detectGap) {
      this.state = { ...this.state, syncWarning: `Duplicate sequence ${nextSequence} ignored.` };
      return this.state;
    }
    if (detectGap && this.state.lastAppliedSequence > 0 && nextSequence > this.state.lastAppliedSequence + 1) {
      this.onGap(this.state.lastAppliedSequence);
      this.state = { ...this.state, syncWarning: `Sequence gap detected after ${this.state.lastAppliedSequence}.` };
      return this.state;
    }
    this.state = {
      ...this.state,
      session: payload.session ?? this.state.session,
      participants: payload.participants ?? this.state.participants,
      authoritativeState: payload.state ?? this.state.authoritativeState,
      lastAppliedSequence: Math.max(this.state.lastAppliedSequence, nextSequence),
      syncWarning: payload.reason ? `Snapshot applied: ${payload.reason}.` : ''
    };
    return this.state;
  }
}

interface SnapshotPayload {
  session?: RehearsalSessionSummary;
  participants?: RehearsalParticipant[];
  state?: AuthoritativePlaybackState;
  reason?: string;
}
