# Phase 4 Plan

Implement only ROADMAP Phase 4: backend account, sharing, score persistence, and annotation sync for the Web PWA.

## Scope

- Development auth foundation for local/test use
- Ensemble and membership persistence
- Server-side Score and immutable ScoreVersion persistence
- MusicXML upload/download through an object-storage adapter
- Permission checks for score, version, and annotation APIs
- Annotation server persistence with PRIVATE, PART, and ENSEMBLE visibility
- Browser IndexedDB local-first annotation sync queue with retry and conflict state
- Integration/E2E coverage for auth, score persistence, permission denial, annotation sync, conflict, offline queue, and retry

## Out of Scope

- External OAuth, Apple login, email magic links, or production identity provider integration
- WebSocket ensemble sync
- Realtime cursors or page-turn broadcasting
- Presigned upload URLs
- New OMR, ONNX Runtime, rendering, editing, or Phase 5+ collaboration features
- Any change under `legacy/ios-app`

## Implementation Order

1. Add Phase 4 backend schema migration for users, sessions, ensembles, memberships, scores, versions, annotations, and idempotent client mutations.
2. Implement backend auth, permission, object storage, score/version, ensemble, and annotation sync services.
3. Add backend integration tests using Testcontainers.
4. Extend web API client, auth/session storage, server score library, and server score viewer loading.
5. Extend IndexedDB annotation persistence with sync queue records, revision metadata, retry, and conflict state.
6. Add UI status and retry controls without changing Phase 1-3 viewer behavior.
7. Update docs/API/acceptance notes to match the implemented Phase 4 contract.
8. Run backend, frontend, E2E, compose, Kubernetes, PWA, Markdown link, and diff validations.

## Design Decisions

### Development Auth

Reason: Phase 4 needs authenticated ownership and permission behavior before production provider integration exists.

Decision: Implement a development login endpoint that creates or reuses a user by email/provider subject and returns opaque access and refresh tokens. Tokens are hashed before storage. API endpoints read `Authorization: Bearer <token>`.

Impact: Frontend and tests can exercise real auth and permission checks. Production identity provider verification remains a later integration, not a hidden fake.

Alternative considered: Add Spring Security now. Rejected for this phase because the current backend has no security dependency and Phase 4 can enforce permissions explicitly with a small request-auth service.

### MusicXML Object Storage

Reason: ScoreVersion source must be persisted outside UI state and downloadable by other devices.

Decision: Use multipart upload/download endpoints backed by an `ObjectStorageService` interface. The Phase 4 implementation uses local filesystem object storage for dev/test and keeps the adapter boundary for S3-compatible storage.

Impact: Tests do not require a MinIO container. Docker Compose includes MinIO as the intended S3-compatible development dependency, while backend code can switch adapter later without changing API shape.

Alternative considered: Presigned upload URLs. Rejected for this phase because multipart upload keeps the MVP smaller and still validates MIME, size, ownership, versioning, and permission behavior.

### ScoreVersion Immutability

Reason: Existing viewer, repeat expansion, annotation anchors, and sync revisions all depend on a stable source document.

Decision: ScoreVersion records are append-only. Upload creates version `n + 1`, stores a content hash and object key, and updates the score's current version pointer.

Impact: Existing annotations remain tied to the version they were created against. Editing a source file in place is not supported in Phase 4.

### Annotation Revisions and Idempotency

Reason: Offline mutation replay must avoid duplicate writes and must surface stale writes clearly.

Decision: Each annotation has a monotonically increasing server `revision`. Sync mutations include `baseRevision` and `clientMutationId`. Replayed mutation IDs return the previous result. If `baseRevision` does not match the current server revision, the server returns `409 CONFLICT` with the current annotation.

Impact: The browser can queue offline writes, retry when online, and mark conflicts without losing local data.

Alternative considered: Last-write-wins. Rejected because it hides conflicts between ensemble members and makes offline edits unsafe.

### Annotation Scope Semantics

Reason: Phase 3 stored scope labels locally, but Phase 4 must enforce them server-side.

Decision: PRIVATE annotations are visible only to the owner. PART and ENSEMBLE annotations require score ensemble membership. PART annotations require `partId`; ENSEMBLE annotations are visible to all score ensemble members.

Impact: The UI can still filter scopes locally, but the server never returns annotations outside the authenticated user's permission.

### Logout Cache Policy

Reason: Offline PWA data can contain private annotations and recently opened score state.

Decision: Phase 4 logout clears auth tokens and sync status. It does not automatically purge IndexedDB score/viewer data; user-controlled cache purge is deferred to a later account settings phase.

Impact: Existing offline viewer behavior is preserved. Shared-device data removal remains a known follow-up.

## Risks

- Browser integration with a live backend can be flaky if tests depend on external ports; E2E will mock network state only where necessary and use deterministic selectors.
- Local filesystem object storage validates the service boundary but is not equivalent to S3 consistency or presigned URL behavior.
- Conflict UI is intentionally minimal in Phase 4: it surfaces conflict state and retry controls, but does not implement a merge editor.
