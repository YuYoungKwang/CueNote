# Pre-Phase 7 Reinforcement Plan

This work does not start Phase 7. It reinforces the completed Phase 6 Web PWA/server score editing path before PDF/image import and OMR work begin.

## Repository Analysis

- Phase 0-6 are complete and the primary implementation target is the React + TypeScript Web PWA.
- `legacy/ios-app` is archival Phase 11 material and remains out of scope.
- Backend ensemble roles are currently stored as strings and permission checks are spread across collaboration and rehearsal services.
- The implemented backend roles are `OWNER`, `ADMIN`, and `MEMBER`; Phase 6 documented `EDITOR`/`VIEWER` as a future limitation.
- Score publish permissions currently allow only `OWNER`/`ADMIN`.
- Rehearsal session creation and leadership transfer currently allow only `OWNER`/`ADMIN`.
- Server annotation sync currently enforces membership, PRIVATE ownership, and PART `partId`, but it does not distinguish read-only viewers or ensemble-edit roles.
- Frontend role behavior is mostly implicit. The server remains the final authority, but UI controls need capability-aware disabling/hiding.
- The editable MusicXML parser/serializer supports the structured Phase 6 subset and currently drops unsupported MusicXML elements instead of preserving them as opaque XML fragments.

## Scope

- Add explicit role support for `OWNER`, `ADMIN`, `EDITOR`, `MEMBER`, and `VIEWER`.
- Centralize backend role capability decisions in a dedicated service instead of ordinal comparisons or scattered string checks.
- Preserve existing `OWNER`, `ADMIN`, and `MEMBER` rows while allowing `EDITOR` and `VIEWER`.
- Add Flyway migration constraints for valid membership roles.
- Allow score creation and score-version publishing for `OWNER`, `ADMIN`, and `EDITOR`; deny `MEMBER` and `VIEWER`.
- Allow rehearsal create/control/leader transfer for `OWNER`, `ADMIN`, and `EDITOR`; keep `MEMBER` and `VIEWER` as followers.
- Enforce annotation write permissions explicitly. `VIEWER` is read-only; `ENSEMBLE` writes require `EDITOR` or above; `PRIVATE` remains owner-only for normal members; PART remains limited by existing `partId` validation because no part assignment ACL exists yet.
- Expose capability metadata from backend responses where the frontend needs UI decisions.
- Add frontend capability helpers and apply them to publish, edit, annotation, and rehearsal controls.
- Add opaque MusicXML fragment preservation to the editable domain model, parser, serializer, edit reducer, and validation.
- Preserve safe unsupported MusicXML children as serialized XML strings with parent identity and original order.
- Reject unsafe XML such as DOCTYPE and entity declarations before browser/backend parsing.
- Add focused backend, frontend, score-domain, and E2E coverage for the reinforcement.

## Out of Scope

- Phase 7 PDF/image import, OMR layout detection, symbol detection, PDF.js, OpenCV.js, ONNX Runtime Web, WebGPU, WASM inference, and image workers.
- Complex part assignment ACLs for PART annotations. Existing membership has no `partId`, so this work documents and tests the current limitation instead of inventing a new schema.
- Ensemble deletion and ownership transfer flows if they are not already implemented.
- Server-side opaque fragment storage. The server receives and validates final MusicXML only.
- Realtime collaborative score editing, CRDTs, or automatic MusicXML merge.
- Any changes under `legacy/ios-app`.

## Implementation Order

1. Add backend role capability service and Flyway role constraint migration.
2. Update collaboration authorization for member role changes, score creation, score-version publish, and annotation sync.
3. Update rehearsal authorization for session creation, leader eligibility, end, transfer, and playback control.
4. Add backend role and MusicXML security tests.
5. Add frontend role capability helper and apply read-only UI behavior.
6. Extend score-domain editing model with opaque MusicXML fragments.
7. Update parser/serializer to preserve safe unsupported fragments and reject unsafe XML.
8. Update edit commands and validation for duplicate/delete/transpose opaque-fragment behavior.
9. Add score-domain round-trip tests for supported opaque preservation and unsafe XML rejection.
10. Add/update Playwright coverage without replacing real Verovio rendering or server authority.
11. Run frontend/backend/E2E/Markdown/Docker/diff validations and record any unavailable checks honestly.

## Design Decisions

### Role Capabilities

Decision: Use explicit capability methods such as `canManageMembers`, `canCreateScore`, `canPublishScoreVersion`, `canCreateAnnotation`, `canModifyAnnotation`, `canCreateRehearsalSession`, `canControlRehearsal`, and `canTransferLeader`.

Reason: The role model is not a simple linear hierarchy. `ADMIN` can manage most members but not `OWNER`; `VIEWER` can read and join; `MEMBER` can participate without publishing or leading.

Alternative: Compare role ordinals. Rejected because OWNER-management and read-only viewer rules are not safely represented by a single ordering.

### Member Role Changes

Decision: `OWNER` may assign all valid roles, including `OWNER`; `ADMIN` may assign `ADMIN`, `EDITOR`, `MEMBER`, and `VIEWER`, but cannot grant, demote, or otherwise manage `OWNER`.

Reason: This matches the requested policy and protects ownership changes. The last `OWNER` cannot be demoted.

### Annotation Permissions

Decision: Preserve PRIVATE owner-only behavior, require `partId` for PART annotations, allow `ENSEMBLE` writes only for `OWNER`/`ADMIN`/`EDITOR`, and make `VIEWER` read-only for server-synced annotations.

Reason: The current schema does not store member-to-part assignments. This avoids unsafe pretend ACLs while making the changed MEMBER/VIEWER behavior explicit.

### Opaque MusicXML Preservation

Decision: Store unsupported safe XML fragments as strings with deterministic IDs, parent type, parent ID, original order, element name, and namespace URI. Do not store DOM nodes.

Reason: The structured editor can safely edit the supported subset while round-tripping common unsupported notation and metadata through parse -> edit -> serialize.

Alternative: Patch the original XML by string offsets. Rejected because edits such as measure duplicate/delete and deterministic serialization make offset-based patching brittle.

### Security

Decision: Reject DOCTYPE and entity declarations in the editor parser and backend upload/publish validation. Do not preserve remote-resource or parser-unsafe XML.

Reason: Opaque preservation must not become an XML parser or external entity attack path.

## Risks

- Opaque preservation is intentionally scoped to safe XML fragments under known parents. Some unsupported or cross-referenced MusicXML may still be warned as not preserved.
- PART annotation ACLs remain coarse until a future schema records member part assignments.
- Frontend capability checks improve UX but the backend remains the source of truth.
- Existing real backend E2E is environment-sensitive because it depends on PostgreSQL and S3-compatible object storage containers.
