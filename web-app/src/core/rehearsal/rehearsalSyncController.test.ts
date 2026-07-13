import { describe, expect, it, vi } from 'vitest';
import { RehearsalSyncController } from './rehearsalSyncController';

describe('RehearsalSyncController', () => {
  it('applies snapshots, ignores stale state, and requests a snapshot on sequence gap', () => {
    const onGap = vi.fn();
    const controller = new RehearsalSyncController(onGap);
    const snapshot = stateEnvelope(1);
    const first = controller.handleMessage(snapshot);

    expect(first.lastAppliedSequence).toBe(1);
    expect(first.authoritativeState?.performanceMeasureId).toBe('measure::1');

    const stale = controller.handleMessage(stateEnvelope(0, 'PLAYBACK_STATE_CHANGED'));
    expect(stale.lastAppliedSequence).toBe(1);
    expect(stale.syncWarning).toContain('stale');

    const gap = controller.handleMessage(stateEnvelope(4, 'PLAYBACK_STATE_CHANGED'));
    expect(gap.lastAppliedSequence).toBe(1);
    expect(onGap).toHaveBeenCalledWith(1);
  });

  it('keeps independent browsing from forcing follower state until return to leader', () => {
    const controller = new RehearsalSyncController(() => {});
    controller.setFollowMode('BROWSING_INDEPENDENTLY');
    const next = controller.handleMessage(stateEnvelope(2));
    expect(next.followMode).toBe('BROWSING_INDEPENDENTLY');
    expect(next.authoritativeState?.sequence).toBe(2);
  });
});

function stateEnvelope(sequence: number, type: 'STATE_SNAPSHOT' | 'PLAYBACK_STATE_CHANGED' = 'STATE_SNAPSHOT') {
  return {
    protocolVersion: 1 as const,
    type,
    sequence,
    payload: {
      session: {
        id: 'session-a',
        ensembleId: 'ensemble-a',
        scoreId: 'score-a',
        scoreVersionId: 'version-a',
        leaderUserId: 'user-a',
        status: 'ACTIVE',
        createdBy: 'user-a',
        createdAt: 'now',
        revision: 1,
        state: null
      },
      participants: [],
      state: {
        sessionId: 'session-a',
        scoreId: 'score-a',
        scoreVersionId: 'version-a',
        leaderUserId: 'user-a',
        playbackStatus: 'PLAYING',
        performanceMeasureId: 'measure::1',
        sourceMeasureId: 'measure',
        occurrence: 1,
        beat: 1,
        bpm: 90,
        countInMeasures: 1,
        baseTimelinePositionMs: 0,
        sequence,
        serverTimestamp: 1000,
        effectiveAtServerTime: 1000,
        updatedByUserId: 'user-a'
      }
    }
  };
}
