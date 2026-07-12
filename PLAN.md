# Phase 3 Plan

## Scope

Implement only ROADMAP Phase 3:

- Canvas-based annotation overlay on top of real Verovio rendering
- Pointer Events input for mouse, touch, and pen
- Pen, highlighter, object eraser, and text memo flows
- Measure-default anchors, advanced performance-measure anchors, and explicit element-anchor unavailability when stable source element IDs do not exist
- PRIVATE / PART / ENSEMBLE annotation scopes stored locally
- Layer filter UI with local preference persistence
- IndexedDB persistence and migration for annotations and annotation UI preferences
- Resize / zoom / rerender-safe relative-coordinate rendering
- Phase 3 unit tests and Playwright coverage on top of the real viewer

## Out of Scope

- Backend annotation API
- WebSocket annotation sync
- MusicXML mutation or annotation injection into source XML
- Real score editing
- OMR or ONNX model execution
- Verovio preload, worker offloading, or chunk-level optimization
- Partial stroke eraser, undo/redo history, or Phase 4+ collaboration features
- Changes to `backend`, `deploy`, or `legacy/ios-app`

## Implementation Order

1. Replace the Phase 2 plan with Phase 3 decisions and risks.
2. Add platform-neutral annotation types, coordinate utilities, and filtering rules in `packages/score-domain`.
3. Add IndexedDB schema version 2 with dedicated stores for annotations and annotation UI preferences while preserving recent-score data.
4. Implement a DOM-side annotation geometry provider that resolves anchors, page surfaces, relative points, and client points without leaking DOM types into the domain package.
5. Add per-page canvas overlays that track Verovio page surfaces across rerender, zoom, resize, and device-pixel-ratio changes.
6. Integrate annotation mode, tools, scope controls, layer filters, text editing, save feedback, and playback-aware input disabling into the score viewer.
7. Add unit coverage for coordinate conversion, filtering, pressure fallback, repository behavior, and eraser hit testing.
8. Add Playwright E2E for real canvas overlay creation, persistence, reload restore, filtering, erasing, playback coexistence, and error-free rendering.
9. Run build, unit tests, E2E, link verification, git diffs, and a Phase 3 acceptance self-check.

## Decisions

### Domain Placement

Put reusable annotation types, coordinate helpers, and filtering rules in `packages/score-domain`.

Reason: Annotation payloads and anchor semantics must stay platform-neutral and reusable by future clients.

Impact: Web-only DOM work stays in `web-app`, while stored annotation records remain independent of Verovio, Canvas, and React.

Alternative: Keep all annotation logic in `web-app`. Rejected because the roadmap and domain model expect shared domain types.

### Annotation Object Model

Store one persisted annotation object per stroke or text memo.

Reason: Phase 3 needs simple CRUD, object erasing, scope filtering, and persistence semantics without introducing group-edit history.

Impact: A pen stroke, highlighter stroke, or text memo can be created, updated, filtered, and deleted independently.

Alternative: Store page bitmaps or aggregate many strokes into one page payload. Rejected because it weakens anchor-level behavior and makes selective erasing harder.

### Coordinate Storage

Store annotation geometry only as anchor-relative coordinates and ratios.

Reason: Zoom, resize, rerender, and device-pixel-ratio changes must not invalidate stored annotations.

Impact: The app resolves current DOM bounds only when converting between client points and relative points for drawing and hit testing.

Alternative: Persist canvas pixels, DOMRects, or viewport pixels. Rejected because those values are unstable across browser layout changes.

### Out-of-Range Stroke Policy

Keep the anchor chosen on `pointerdown`, and allow relative coordinates outside the nominal `0..1` range when the stroke leaves the anchor bounds.

Reason: Users naturally overshoot measure bounds while writing, and splitting strokes at the boundary would add unnecessary complexity in this phase.

Impact: Coordinate utilities and rendering must preserve negative or greater-than-one relative points.

Alternative: Clamp coordinates or split strokes at anchor edges. Rejected because it distorts user input and complicates editing behavior.

### Canvas Overlay Structure

Use one canvas overlay per rendered Verovio page surface instead of a single canvas over the whole score stage.

Reason: Verovio already paginates the source score, and per-page overlays keep alignment, resizing, and redraw scope predictable.

Impact: Each page surface owns its own canvas backing store and redraw cycle, while annotations are still stored as score-level records.

Alternative: One giant stage canvas. Rejected because it is more fragile across multi-page layout, scrolling, and rerender timing.

### Anchor Geometry Adapter

Introduce a web-only geometry provider that resolves anchors, converts points, and tracks which page surface contains each anchor.

Reason: The viewer should not scatter DOMRect math and hit testing across React event handlers.

Impact: Pointer controllers and overlay rendering share one tested geometry layer, and the domain package stays free of DOM types.

Alternative: Inline all geometry logic inside `ScoreViewerPage`. Rejected because it would make rerender and testing much harder.

### Default and Optional Anchor Types

Use `MEASURE` as the default anchor, expose `PERFORMANCE_MEASURE` as an advanced option, and disable `ELEMENT` creation when stable `sourceElementId` data is unavailable.

Reason: The parser and renderer already provide stable measure IDs and performance order, while stable source-element IDs are not yet guaranteed for the current fixtures and renderer mapping.

Impact: The UI must make element-anchor unavailability explicit instead of silently falling back to measure anchors.

Alternative: Quietly map element requests to measure anchors or invent unstable DOM-derived IDs. Rejected because the policy explicitly forbids silent fallback and Verovio-only IDs are not stable source IDs.

### Playback Interaction Policy

Show existing annotations during playback, but disable new annotation input while playback is in `COUNT_IN` or `PLAYING`.

Reason: Playback position and pointer drawing should not compete for control in the same phase.

Impact: The toolbar stays visible, the overlay still renders, and users can annotate again after pause or stop.

Alternative: Allow simultaneous playback and drawing. Rejected because it creates conflicting interaction priority and increases flaky behavior.

### Layer Filter Persistence

Treat layer filter state as local UI preference, not score data, and persist it separately from annotation records.

Reason: Visibility toggles are device-local viewing preferences rather than shared annotation content.

Impact: Hidden layers are excluded from render and hit testing, but toggling them does not mutate annotation records.

Alternative: Persist filter state inside each score annotation payload. Rejected because it couples local view settings to content records.

### IndexedDB Migration

Upgrade the existing `cuenote` database from schema version 1 to version 2 and add dedicated stores for annotation records and annotation UI preferences.

Reason: Phase 3 must preserve recent viewer state while adding new offline data.

Impact: Existing Phase 1 and 2 persistence remains available after upgrade, and annotation storage stays isolated from recent-score state.

Alternative: Create a second database. Rejected because one app-level schema is easier to migrate and inspect for this MVP.

### State Management

Keep Phase 3 on local React state plus focused controllers and repositories. Do not add a new state library.

Reason: The new complexity is about geometry, persistence, and input flow, not shared app-wide orchestration.

Impact: Annotation state can stay close to the viewer while pure logic remains testable in domain modules.

Alternative: Add Zustand, XState, or another store. Rejected because it increases surface area without solving the core geometry problem.

## Risks

- The current renderer decorates source measures by DOM order, so the geometry layer must carefully reuse the existing mapping without destabilizing Phase 1 and 2 behavior.
- Stable source-element IDs may be missing in current MusicXML fixtures, so element anchors must fail explicitly and safely.
- Canvas overlays must survive Verovio rerender and zoom changes without leaving duplicate canvases behind.
- IndexedDB schema migration must preserve recent-score records while adding new stores.
- Real browser E2E for canvas drawing can become flaky if overlay readiness and page-surface selection are not explicit.
