# Phase 6 Plan

Implement only ROADMAP Phase 6: a limited structured score editor for existing MusicXML score versions in the Web PWA.

## Repository Analysis

- Phase 0-5 are complete and the primary platform is the React + TypeScript Web PWA.
- The viewer already parses MusicXML, renders with Verovio via a route-level dynamic import, maps stable measure IDs to rendered measures, supports local playback, annotations, server score versions, and server-backed rehearsal sync.
- The current domain model has stable score, part, measure, annotation, playback, and rehearsal types, but no structured editable note/rest model yet.
- The backend already stores MusicXML in object storage through append-only `ScoreVersion` records. It needs a narrow publish extension for edit metadata, base-version validation, optimistic revision checks, and publish permissions.
- `legacy/ios-app` is archival Phase 11 material and remains untouched.

## Scope

- Add an editable score model and command reducer under `packages/score-domain/src/editing`.
- Parse existing MusicXML into an editable document and serialize the editable document back to well-formed MusicXML.
- Support note selection through a stable event list, not through Verovio note DOM order.
- Support pitch, duration, rest duration, chord symbol, lyric, insert/delete/duplicate measure, transpose, validation, undo/redo, cancel, local export, and publish-as-new-version.
- Keep Verovio as preview-only display. The editable document is the source of truth.
- Add IndexedDB draft autosave/restore for score edit drafts.
- Add a separate `/scores/:scoreId/edit` route for server score editing.
- Extend the existing multipart `POST /api/v1/scores/{scoreId}/versions` publish path with optional `baseScoreVersionId`, `editSummary`, `annotationMigrationPolicy`, and `expectedScoreRevision`.
- Preserve existing Phase 1-5 viewer, annotation, rehearsal, and backend behavior.

## Out of Scope

- Phase 7 PDF/image import, OMR, ONNX Runtime Web, WebGPU/WASM model inference, and image workers.
- Full notation composition, tuplets editing, beams, slurs, articulations, layout editing, and realtime collaborative editing.
- Editing directly through SVG notes or patching MusicXML strings by index.
- Automatic annotation copying to new score versions. Phase 6 exposes safe measure-anchor migration logic, but publish does not clone annotations by default.
- Backend draft CRUD. Drafts remain browser-local IndexedDB records.
- Any changes under `legacy/ios-app`.

## Implementation Order

1. Add score-domain editing model, parser, serializer, commands, reducer, validation, transpose, and annotation migration helpers.
2. Add focused unit tests for parsing, serialization, edit commands, validation, undo/redo, transpose, and migration policy.
3. Add IndexedDB edit draft stores and tests.
4. Add API client support for publishing an edited MusicXML version.
5. Add backend Flyway V4 fields and publish validation for base version, revision, metadata, role, and immutable object storage writes.
6. Add a dedicated score edit route and UI using the existing renderer adapter for preview.
7. Add Playwright coverage for opening a server score in edit mode, editing, validating, publishing, and reopening the new version.
8. Update README and docs with the implemented Phase 6 behavior and limits.
9. Run frontend, backend, E2E, Markdown, diff, and legacy validations.

## Design Decisions

### Renderer Boundary

Decision: Verovio remains preview-only. Measure clicks select a measure; note/rest selection happens from an event list generated from the editable document.

Reason: The current stable renderer contract maps measures, not notes. Using SVG DOM order for note identity would be brittle across Verovio rerenders, zoom, and pagination.

Alternative: Add element-level SVG note mapping now. Deferred because it needs stable source element IDs across all note serialization paths and is larger than Phase 6 MVP.

### Parser and Serializer

Decision: Use the browser/Node DOMParser path to parse MusicXML into a structured editable model and serialize with deterministic string generation from that model.

Reason: No new dependency is needed, and the model can stay independent from React and Verovio. Serialization from the model avoids regex-based XML patching.

Impact: Common MusicXML elements needed by Phase 6 are round-tripped semantically. Unsupported structures generate validation warnings instead of being silently treated as fully editable.

### Publish API

Decision: Reuse the existing multipart `POST /api/v1/scores/{scoreId}/versions` endpoint and add optional edit metadata plus `expectedScoreRevision`.

Reason: The backend already has object storage, MusicXML validation, version append, and current-version pointer updates. A new draft/publish API would duplicate this path.

Alternative: Add `/versions/publish-edit`. Deferred until server-side draft lifecycle or collaborative editing exists.

### Permissions

Decision: In the current backend role model, `OWNER` and `ADMIN` may publish edited score versions; `MEMBER` is read/comment only.

Reason: Phase 6 docs mention OWNER/EDITOR versus MEMBER/VIEWER, but the implemented backend has OWNER/ADMIN/MEMBER. This keeps writes server-side and conservative until explicit EDITOR/VIEWER roles are added.

### Conflict Handling

Decision: Publish sends `baseScoreVersionId` and `expectedScoreRevision`. A mismatch returns `409 CONFLICT`; the browser keeps the local draft and does not attempt automatic three-way merge.

Reason: Score editing merge is musically ambiguous and out of Phase 6 scope.

### Editing During Rehearsal

Decision: The edit route is separate from rehearsal UI and does not join or mutate active rehearsal sessions. Active sessions remain pinned to their original `scoreVersionId`.

Reason: WebSocket rehearsal sync is score-version authoritative. Publishing a new score version must not silently swap a running session.

### Draft Storage

Decision: Store edit drafts in IndexedDB as browser-local records keyed by `scoreId` and `baseScoreVersionId`. Autosave timestamps live in storage metadata, not in the deterministic editable document.

Reason: The same base version plus command sequence should produce the same editable model and MusicXML.

## Risks

- The MVP serializer intentionally supports a limited set of MusicXML notation features. Unsupported data is reported as warnings, not fully preserved as arbitrary opaque XML.
- Verovio preview rerendering after every edit can be expensive on large scores; Phase 6 keeps fixtures and edits modest and defers worker/chunk optimization.
- Current backend roles do not include EDITOR/VIEWER, so Phase 6 maps publish rights to OWNER/ADMIN and documents that limitation.
- Offline edit drafts are local-first, but publishing a new immutable `ScoreVersion` requires network access and server permission.
