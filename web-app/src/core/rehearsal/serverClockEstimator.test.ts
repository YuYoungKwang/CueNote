import { describe, expect, it } from 'vitest';
import { ServerClockEstimator } from './serverClockEstimator';

describe('ServerClockEstimator', () => {
  it('uses the lowest RTT sample for server offset estimation', () => {
    const estimator = new ServerClockEstimator();

    estimator.addSample({
      clientSentAt: 1000,
      serverReceivedAt: 1500,
      serverSentAt: 1510,
      clientReceivedAt: 1110
    });
    const best = estimator.addSample({
      clientSentAt: 2000,
      serverReceivedAt: 2600,
      serverSentAt: 2600,
      clientReceivedAt: 2050
    });

    expect(best.rttMs).toBe(50);
    expect(Math.round(estimator.serverNow(2050))).toBe(2625);
  });
});
