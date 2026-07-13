export interface ClockSample {
  clientSentAt: number;
  clientReceivedAt: number;
  serverReceivedAt: number;
  serverSentAt: number;
}

export interface ClockEstimate {
  offsetMs: number;
  rttMs: number;
}

export class ServerClockEstimator {
  private samples: ClockEstimate[] = [];

  addSample(sample: ClockSample): ClockEstimate {
    const rttMs = Math.max(0, sample.clientReceivedAt - sample.clientSentAt - Math.max(0, sample.serverSentAt - sample.serverReceivedAt));
    const estimatedServerAtReceive = sample.serverSentAt + rttMs / 2;
    const estimate = {
      offsetMs: estimatedServerAtReceive - sample.clientReceivedAt,
      rttMs
    };
    this.samples = [...this.samples, estimate].sort((left, right) => left.rttMs - right.rttMs).slice(0, 5);
    return this.getEstimate();
  }

  getEstimate(): ClockEstimate {
    if (this.samples.length === 0) {
      return { offsetMs: 0, rttMs: 0 };
    }
    return this.samples[0];
  }

  serverNow(clientNow: number = Date.now()): number {
    return clientNow + this.getEstimate().offsetMs;
  }
}
