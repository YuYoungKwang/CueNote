# Phase 5 Plan

Implement only ROADMAP Phase 5: realtime rehearsal sessions and authoritative score-position synchronization for the Web PWA.

## Repository Analysis

- Phase 0-4 are complete and the primary platform is the React + TypeScript Web PWA.
- Existing backend auth, ensemble membership, score/version, annotation, PostgreSQL, and object-storage paths are already in place.
- Existing frontend viewer already parses MusicXML, renders with Verovio, expands repeats into `PerformanceMeasure`, and drives local `PlaybackTimeline`.
- Existing sync documentation forbids page-number, scroll, SVG coordinate, DOM index, and pixel-based synchronization.
- `legacy/ios-app` is archival Phase 11 material and remains untouched.

## Scope

- Backend rehearsal session REST APIs and PostgreSQL persistence.
- Raw Spring WebSocket endpoint at `/ws/rehearsal` with explicit JSON protocol envelopes.
- Authoritative playback state based on `scoreId`, `scoreVersionId`, `performanceMeasureId`, `sourceMeasureId`, `occurrence`, `beat`, `bpm`, `playbackStatus`, `sequence`, and `effectiveAtServerTime`.
- Server-side permission checks for ensemble membership, leader-only commands, leader transfer, ended sessions, stale/duplicate commands, and score-version mismatch.
- Client server-clock estimation, reconnect/snapshot handling, sequence gap detection, and independent browsing mode.
- Viewer UI for session create/list/join/end, participants, leader, connection state, follow/browse mode, return to leader, latency/RTT, sequence, BPM/count-in, and sync warnings.
- IndexedDB storage only for recent session UI preferences, not authoritative playback state.
- Backend and frontend tests that use the real Spring WebSocket path.

## Out of Scope

- Realtime annotation push or cursor broadcasting.
- Audio/video, WebRTC, metronome sound, CRDT editing, Redis pub/sub, or multi-backend fanout.
- Phase 6 score editing or any OMR/model/PDF work.
- Any changes under `legacy/ios-app`.

## Implementation Order

1. Add shared rehearsal protocol types in `packages/score-domain`.
2. Add backend Flyway V3 rehearsal tables.
3. Add Spring WebSocket dependency and raw WebSocket configuration.
4. Implement backend rehearsal REST, state service, idempotency, permissions, and WebSocket handler.
5. Add backend integration tests for PostgreSQL persistence, permissions, state transitions, idempotency, and multi-client WebSocket broadcast.
6. Add frontend rehearsal API, socket client, clock estimator, sync controller, and session preference store.
7. Integrate the viewer with session controls while preserving existing local playback and annotation behavior.
8. Add frontend unit tests and Playwright real-backend rehearsal E2E.
9. Update README/docs with the implemented Phase 5 contract and single-instance limitation.
10. Run backend, frontend, E2E, compose, Markdown, diff, and legacy validation.

## Design Decisions

### WebSocket Protocol

Decision: Use raw Spring WebSocket with JSON envelopes instead of STOMP.

Reason: Phase 5 needs a small, explicit command/event protocol with `clientCommandId`, `sequence`, `STATE_SNAPSHOT`, and `effectiveAtServerTime`. Raw WebSocket avoids broker semantics that are not needed in a single-backend MVP and keeps the frontend protocol independent from STOMP frame details.

Alternative: STOMP over WebSocket. It would help later if topic routing and broker relay become central, but it adds frame-level behavior without solving the current authoritative-state problem.

### State Storage

Decision: Store session metadata, participants, last authoritative snapshot, and processed command IDs in PostgreSQL. Keep active WebSocket connections in memory.

Reason: PostgreSQL gives durable session state, sequence, idempotency, and permission constraints. In-memory connections are enough for the current single-backend dev/deploy target.

Impact: A single backend instance can broadcast to connected clients. Multi-instance deployment requires a later Redis pub/sub or broker-backed fanout layer.

### Performance Timeline Authority

Decision: The client sends the Phase 2 `PerformanceMeasure` order when creating a session. The server validates future commands against that stored order and persists only authoritative position snapshots.

Reason: The backend does not parse MusicXML into performance timelines today, and Phase 5 should not duplicate the browser repeat-expansion implementation. Storing the order keeps server validation independent from renderer DOM and page layout.

Alternative: Re-parse MusicXML on the server. Deferred because it would add a second MusicXML/navigation implementation beyond Phase 5.

### Follow Mode Persistence

Decision: Persist participant `followMode` in PostgreSQL for visibility and reconnect, and also store the local UI preference in IndexedDB.

Reason: The server can expose participant state consistently, while the browser can restore the user's last local mode without treating it as authoritative playback state.

### Effective Time and Clock Offset

Decision: The server assigns `effectiveAtServerTime` on leader commands. Clients estimate server offset with `PING`/`PONG` and compute playback position locally from the authoritative snapshot.

Reason: This avoids per-frame WebSocket traffic and avoids browser background timer drift.

## Risks

- Real multi-context Playwright WebSocket tests can be sensitive to backend startup and browser timing; tests must assert explicit ready/snapshot states instead of increasing timeouts blindly.
- The server validates `PerformanceMeasure` identity from stored performance order but does not independently verify MusicXML repeat semantics in this phase.
- Single-backend in-memory socket registry is intentionally not horizontally scalable until a future Redis/broker phase.
