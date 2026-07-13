import type { RehearsalClientMessageType, RehearsalEnvelope, RehearsalServerMessageType } from '@cuenote/score-domain';

export type RehearsalConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'FAILED';

export interface RehearsalSocketClientOptions {
  url?: string;
  onMessage(message: RehearsalEnvelope<RehearsalServerMessageType, unknown>): void;
  onStatus(status: RehearsalConnectionStatus): void;
}

export const DEFAULT_REHEARSAL_WS_URL =
  import.meta.env.VITE_CUENOTE_WS_BASE_URL ??
  (DEFAULT_API_ORIGIN().replace(/^http/, 'ws').replace(/\/api\/v1$/, '') + '/ws/rehearsal');

export class RehearsalSocketClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private readonly url: string;
  private readonly onMessage: RehearsalSocketClientOptions['onMessage'];
  private readonly onStatus: RehearsalSocketClientOptions['onStatus'];
  private lastJoinMessage: RehearsalEnvelope<RehearsalClientMessageType, unknown> | null = null;
  private intentionalClose = false;

  constructor(options: RehearsalSocketClientOptions) {
    this.url = options.url ?? DEFAULT_REHEARSAL_WS_URL;
    this.onMessage = options.onMessage;
    this.onStatus = options.onStatus;
  }

  connect(joinMessage: RehearsalEnvelope<RehearsalClientMessageType, unknown>) {
    this.lastJoinMessage = joinMessage;
    this.intentionalClose = false;
    this.open('CONNECTING');
  }

  send<T>(type: RehearsalClientMessageType, sessionId: string, payload: T, clientCommandId?: string) {
    const envelope: RehearsalEnvelope<RehearsalClientMessageType, T> = {
      protocolVersion: 1,
      type,
      sessionId,
      clientCommandId,
      payload
    };
    this.socket?.send(JSON.stringify(envelope));
  }

  requestSnapshot(sessionId: string, reason: string, lastAppliedSequence: number) {
    this.send('REQUEST_STATE_SNAPSHOT', sessionId, { reason, lastAppliedSequence }, `snapshot-${crypto.randomUUID()}`);
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.onStatus('DISCONNECTED');
  }

  private open(status: RehearsalConnectionStatus) {
    this.onStatus(status);
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.onStatus('CONNECTED');
      if (this.lastJoinMessage) {
        socket.send(JSON.stringify(this.lastJoinMessage));
      }
    };
    socket.onmessage = (event) => {
      this.onMessage(JSON.parse(event.data));
    };
    socket.onclose = () => {
      if (this.intentionalClose) {
        this.onStatus('DISCONNECTED');
        return;
      }
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
        return;
      }
      socket.close();
    };
  }

  private scheduleReconnect() {
    if (!this.lastJoinMessage || this.reconnectAttempts >= 5) {
      this.onStatus('FAILED');
      return;
    }
    this.onStatus('RECONNECTING');
    const delay = Math.min(4000, 250 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = window.setTimeout(() => this.open('RECONNECTING'), delay);
  }
}

function DEFAULT_API_ORIGIN() {
  return import.meta.env.VITE_CUENOTE_API_BASE_URL ?? 'http://127.0.0.1:8080/api/v1';
}
