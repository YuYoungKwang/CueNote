import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AuthoritativePlaybackState,
  PerformanceMeasure,
  PlaybackSnapshot,
  RehearsalEnvelope,
  RehearsalFollowMode,
  RehearsalParticipant,
  RehearsalServerMessageType,
  RehearsalSessionSummary
} from '@cuenote/score-domain';
import { createRehearsalSessionApi } from '../../core/api/rehearsalSessionApi';
import { RehearsalSocketClient, type RehearsalConnectionStatus } from '../../core/rehearsal/rehearsalSocketClient';
import { RehearsalSyncController } from '../../core/rehearsal/rehearsalSyncController';
import { ServerClockEstimator } from '../../core/rehearsal/serverClockEstimator';
import { createRehearsalPreferenceStore } from '../../core/storage/rehearsalPreferenceStore';

interface RehearsalPanelProps {
  accessToken: string;
  userId: string;
  ensembleId: string;
  scoreId: string;
  scoreVersionId: string;
  performanceMeasures: PerformanceMeasure[];
  playbackSnapshot: PlaybackSnapshot;
  bpm: number;
  countInMeasures: number;
  manualBrowseSignal: number;
  onApplyState(state: AuthoritativePlaybackState, estimatedServerNowMs: number): void;
}

export function RehearsalPanel(props: RehearsalPanelProps) {
  const api = useMemo(() => createRehearsalSessionApi(), []);
  const preferences = useMemo(() => createRehearsalPreferenceStore(), []);
  const clockEstimator = useMemo(() => new ServerClockEstimator(), []);
  const socketRef = useRef<RehearsalSocketClient | null>(null);
  const activeSessionRef = useRef<RehearsalSessionSummary | null>(null);
  const controllerRef = useRef<RehearsalSyncController | null>(null);
  const [sessions, setSessions] = useState<RehearsalSessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<RehearsalSessionSummary | null>(null);
  const [participants, setParticipants] = useState<RehearsalParticipant[]>([]);
  const [connection, setConnection] = useState<RehearsalConnectionStatus>('DISCONNECTED');
  const [followMode, setFollowMode] = useState<RehearsalFollowMode>('FOLLOWING_LEADER');
  const [lastSequence, setLastSequence] = useState(0);
  const [latency, setLatency] = useState(0);
  const [message, setMessage] = useState('Rehearsal idle.');
  const [syncWarning, setSyncWarning] = useState('');

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.list(props.accessToken, props.ensembleId),
      preferences.load(props.scoreId, props.scoreVersionId)
    ])
      .then(([nextSessions, stored]) => {
        if (cancelled) {
          return;
        }
        setSessions(nextSessions);
        if (stored?.followMode) {
          setFollowMode(stored.followMode);
        }
        const preferred = stored?.recentSessionId ? nextSessions.find((session) => session.id === stored.recentSessionId) : null;
        if (preferred && preferred.status !== 'ENDED') {
          setActiveSession(preferred);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : 'Rehearsal sessions failed to load.');
        }
      });
    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
    };
  }, [api, preferences, props.accessToken, props.ensembleId, props.scoreId, props.scoreVersionId]);

  useEffect(() => {
    void preferences.save({
      scoreId: props.scoreId,
      scoreVersionId: props.scoreVersionId,
      recentSessionId: activeSession?.id,
      followMode,
      showLatency: true,
      updatedAt: Date.now()
    });
  }, [activeSession?.id, followMode, preferences, props.scoreId, props.scoreVersionId]);

  useEffect(() => {
    if (!activeSession || connection !== 'CONNECTED') {
      return;
    }
    const intervalId = window.setInterval(() => {
      socketRef.current?.send('PING', activeSession.id, { clientSentAt: Date.now() }, `ping-${crypto.randomUUID()}`);
    }, 2000);
    return () => window.clearInterval(intervalId);
  }, [activeSession, connection]);

  useEffect(() => {
    if (!activeSession || connection !== 'CONNECTED') {
      return;
    }
    const onVisible = () => {
      if (!document.hidden) {
        socketRef.current?.requestSnapshot(activeSession.id, 'FOREGROUND', lastSequence);
      }
    };
    window.addEventListener('online', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [activeSession, connection, lastSequence]);

  useEffect(() => {
    if (props.manualBrowseSignal === 0 || !activeSession || connection !== 'CONNECTED') {
      return;
    }
    if (followMode === 'FOLLOWING_LEADER') {
      changeFollowMode('BROWSING_INDEPENDENTLY');
    }
  }, [props.manualBrowseSignal]);

  const refreshSessions = async () => {
    setSessions(await api.list(props.accessToken, props.ensembleId));
  };

  const createSession = async () => {
    const firstMeasure = props.performanceMeasures[0];
    const currentId = props.playbackSnapshot.currentPerformanceMeasureId ?? firstMeasure?.id;
    const currentMeasure = props.performanceMeasures.find((measure) => measure.id === currentId) ?? firstMeasure;
    if (!currentMeasure) {
      setMessage('No performance measures are available for rehearsal.');
      return;
    }
    const created = await api.create(props.accessToken, {
      ensembleId: props.ensembleId,
      scoreId: props.scoreId,
      scoreVersionId: props.scoreVersionId,
      performanceOrder: props.performanceMeasures,
      initialPosition: {
        performanceMeasureId: currentMeasure.id,
        sourceMeasureId: currentMeasure.sourceMeasureId,
        occurrence: currentMeasure.occurrence,
        beat: props.playbackSnapshot.currentBeat,
        baseTimelinePositionMs: props.playbackSnapshot.elapsedMs
      },
      bpm: props.bpm,
      countInMeasures: props.countInMeasures
    });
    setSessions((current) => [created, ...current.filter((session) => session.id !== created.id)]);
    setActiveSession(created);
    setMessage('Rehearsal session created.');
    connect(created);
  };

  const joinSession = async (session = activeSession) => {
    if (!session) {
      setMessage('Select a rehearsal session first.');
      return;
    }
    const joined = await api.join(props.accessToken, session.id, followMode);
    setActiveSession(joined);
    setMessage('Joined rehearsal session.');
    connect(joined);
  };

  const connect = (session: RehearsalSessionSummary) => {
    controllerRef.current = new RehearsalSyncController((sequence) => socketRef.current?.requestSnapshot(session.id, 'SEQUENCE_GAP', sequence));
    socketRef.current?.disconnect();
    const client = new RehearsalSocketClient({
      onStatus: setConnection,
      onMessage: handleSocketMessage
    });
    socketRef.current = client;
    client.connect({
      protocolVersion: 1,
      type: 'JOIN_SESSION',
      sessionId: session.id,
      clientCommandId: `join-${crypto.randomUUID()}`,
      payload: {
        accessToken: props.accessToken,
        lastAppliedSequence: lastSequence,
        followMode
      }
    });
  };

  const handleSocketMessage = (envelope: RehearsalEnvelope<RehearsalServerMessageType, unknown>) => {
    if (envelope.type === 'PONG') {
      const payload = envelope.payload as { clientSentAt: number; serverReceivedAt: number; serverSentAt: number };
      const estimate = clockEstimator.addSample({ ...payload, clientReceivedAt: Date.now() });
      setLatency(Math.round(estimate.rttMs));
      return;
    }
    const nextState = controllerRef.current?.handleMessage(envelope);
    if (!nextState) {
      return;
    }
    setActiveSession(nextState.session);
    setParticipants(nextState.participants);
    setLastSequence(nextState.lastAppliedSequence);
    setSyncWarning(nextState.syncWarning);
    if (nextState.authoritativeState && nextState.followMode === 'FOLLOWING_LEADER') {
      props.onApplyState(nextState.authoritativeState, clockEstimator.serverNow(Date.now()));
    }
  };

  const sendPlaybackCommand = (type: 'PLAY_REQUEST' | 'PAUSE_REQUEST' | 'STOP_REQUEST' | 'SEEK_REQUEST' | 'BPM_CHANGE_REQUEST' | 'COUNT_IN_CHANGE_REQUEST') => {
    if (!activeSession) {
      return;
    }
    const measure = props.performanceMeasures.find((item) => item.id === props.playbackSnapshot.currentPerformanceMeasureId) ?? props.performanceMeasures[0];
    if (!measure) {
      return;
    }
    socketRef.current?.send(
      type,
      activeSession.id,
      {
        scoreVersionId: props.scoreVersionId,
        performanceMeasureId: measure.id,
        sourceMeasureId: measure.sourceMeasureId,
        occurrence: measure.occurrence,
        beat: props.playbackSnapshot.currentBeat,
        baseTimelinePositionMs: props.playbackSnapshot.elapsedMs,
        bpm: props.bpm,
        countInMeasures: props.countInMeasures
      },
      `${type.toLowerCase()}-${crypto.randomUUID()}`
    );
  };

  const changeFollowMode = (nextFollowMode: RehearsalFollowMode) => {
    setFollowMode(nextFollowMode);
    controllerRef.current?.setFollowMode(nextFollowMode);
    if (activeSession && connection === 'CONNECTED') {
      socketRef.current?.send('FOLLOW_MODE_CHANGE', activeSession.id, { followMode: nextFollowMode }, `follow-${crypto.randomUUID()}`);
    }
  };

  const returnToLeader = () => {
    changeFollowMode('FOLLOWING_LEADER');
    const state = controllerRef.current?.getState().authoritativeState;
    if (state) {
      props.onApplyState(state, clockEstimator.serverNow(Date.now()));
    }
  };

  const endSession = async () => {
    if (!activeSession) {
      return;
    }
    const ended = await api.end(props.accessToken, activeSession.id);
    setActiveSession(ended);
    setMessage('Rehearsal session ended.');
    await refreshSessions();
  };

  const isLeader = activeSession?.leaderUserId === props.userId;
  const activeState = controllerRef.current?.getState().authoritativeState ?? activeSession?.state ?? null;

  return (
    <div className="rehearsal-panel" data-testid="rehearsal-panel">
      <div className="rehearsal-panel__top">
        <div>
          <span className="summary-label">Rehearsal</span>
          <strong data-testid="rehearsal-connection">{connection}</strong>
        </div>
        <div>
          <span className="summary-label">Sequence</span>
          <strong data-testid="rehearsal-sequence">{lastSequence}</strong>
        </div>
        <div>
          <span className="summary-label">RTT</span>
          <strong data-testid="rehearsal-latency">{latency}ms</strong>
        </div>
        <div>
          <span className="summary-label">Mode</span>
          <strong data-testid="rehearsal-follow-mode">{followMode}</strong>
        </div>
      </div>

      <div className="playback-button-row">
        <button type="button" className="control-button" data-testid="rehearsal-create" onClick={createSession}>
          Create session
        </button>
        <button type="button" className="control-button" data-testid="rehearsal-refresh" onClick={refreshSessions}>
          Refresh sessions
        </button>
        <button type="button" className="control-button" data-testid="rehearsal-join" onClick={() => joinSession()} disabled={!activeSession}>
          Join
        </button>
        <button type="button" className="control-button" data-testid="rehearsal-end" onClick={endSession} disabled={!activeSession || !isLeader}>
          End
        </button>
      </div>

      {sessions.length > 0 ? (
        <label className="field">
          <span>Session</span>
          <select
            data-testid="rehearsal-session-select"
            value={activeSession?.id ?? ''}
            onChange={(event) => setActiveSession(sessions.find((session) => session.id === event.target.value) ?? null)}
          >
            <option value="">Select session</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.status} | {session.id}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="playback-button-row">
        <button type="button" className="control-button" data-testid="rehearsal-play" onClick={() => sendPlaybackCommand('PLAY_REQUEST')} disabled={!isLeader}>
          Play shared
        </button>
        <button type="button" className="control-button" data-testid="rehearsal-pause" onClick={() => sendPlaybackCommand('PAUSE_REQUEST')} disabled={!isLeader}>
          Pause shared
        </button>
        <button type="button" className="control-button" data-testid="rehearsal-stop" onClick={() => sendPlaybackCommand('STOP_REQUEST')} disabled={!isLeader}>
          Stop shared
        </button>
        <button type="button" className="control-button" data-testid="rehearsal-seek" onClick={() => sendPlaybackCommand('SEEK_REQUEST')} disabled={!isLeader}>
          Seek shared
        </button>
        <button type="button" className="control-button" data-testid="rehearsal-bpm" onClick={() => sendPlaybackCommand('BPM_CHANGE_REQUEST')} disabled={!isLeader}>
          Sync BPM
        </button>
        <button type="button" className="control-button" data-testid="rehearsal-count-in" onClick={() => sendPlaybackCommand('COUNT_IN_CHANGE_REQUEST')} disabled={!isLeader}>
          Sync count-in
        </button>
      </div>

      <div className="playback-button-row">
        <button
          type="button"
          className={`control-button${followMode === 'FOLLOWING_LEADER' ? ' is-active' : ''}`}
          data-testid="rehearsal-follow"
          onClick={() => changeFollowMode('FOLLOWING_LEADER')}
          disabled={!activeSession}
        >
          Follow leader
        </button>
        <button
          type="button"
          className={`control-button${followMode === 'BROWSING_INDEPENDENTLY' ? ' is-active' : ''}`}
          data-testid="rehearsal-browse"
          onClick={() => changeFollowMode('BROWSING_INDEPENDENTLY')}
          disabled={!activeSession}
        >
          Browse independently
        </button>
        <button type="button" className="control-button" data-testid="rehearsal-return-to-leader" onClick={returnToLeader} disabled={!activeState}>
          Return to leader
        </button>
      </div>

      <div className="rehearsal-panel__top">
        <div>
          <span className="summary-label">Leader</span>
          <strong data-testid="rehearsal-leader">{activeSession?.leaderUserId ?? 'none'}</strong>
        </div>
        <div>
          <span className="summary-label">Shared measure</span>
          <strong data-testid="rehearsal-shared-measure">{activeState?.performanceMeasureId ?? 'none'}</strong>
        </div>
        <div>
          <span className="summary-label">Shared beat</span>
          <strong data-testid="rehearsal-shared-beat">{activeState?.beat ?? 0}</strong>
        </div>
        <div>
          <span className="summary-label">Participants</span>
          <strong data-testid="rehearsal-participant-count">{participants.length}</strong>
        </div>
      </div>

      <p className="muted" data-testid="rehearsal-status">
        {syncWarning || message}
      </p>
    </div>
  );
}
