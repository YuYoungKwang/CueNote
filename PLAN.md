# Phase 1 Plan

## Scope

Implement only ROADMAP Phase 1:

- Sample MusicXML fixtures bundled into the web app
- MusicXML parser and domain translation
- Minimal `ScoreDocument` / `ScoreVersion` / `ScorePart` / `Measure` model support in `packages/score-domain`
- Score renderer adapter behind an app-facing interface
- Measure-to-renderer mapping, highlight, scroll, and zoom
- Library and viewer routes for sample scores
- IndexedDB recent-score persistence
- Parser, mapping, storage, and E2E coverage

## Out of Scope

- OMR
- Repeat expansion
- Canvas handwriting
- Backend API integration
- WebSocket ensemble sync
- Score editing

## Implementation Order

1. Add Phase 1 sample MusicXML fixtures and bundle them into the app.
2. Extend `packages/score-domain` with the minimum score document types.
3. Implement the MusicXML parser with clear parse/unsupported-structure errors.
4. Add a renderer adapter and choose a rendering library behind it.
5. Build the library and viewer routes with measure selection, highlight, scroll, and zoom.
6. Persist recent score state in IndexedDB without blocking score loading.
7. Add unit tests and Playwright smoke coverage.
8. Run build, test, E2E, and markdown-link verification.

## Decisions

### Renderer Choice

Use Verovio for the Phase 1 renderer adapter.

Reason: Verovio can render MusicXML to SVG in the browser, supports JavaScript toolkit usage, and exposes element-to-page lookup and SVG HTML5 attributes for JS interaction. That gives us a clearer path to stable measure mapping than a renderer that leaves more of the interaction model implicit.

Impact: The app can keep the domain model separate from renderer internals while still scrolling, highlighting, and relinking measures after rerender.

Alternative: OpenSheetMusicDisplay. Rejected for Phase 1 because the Verovio toolkit exposes page and element lookup APIs that fit this viewer-first milestone more directly.

### Routing

Add the smallest browser router needed for `/` and `/scores/:scoreId`.

Reason: The viewer needs stable deep links, but Phase 1 should not create unrelated pages.

Impact: Library navigation and score viewing become shareable without expanding the app surface.

Alternative: Manual window-location handling. Rejected because the phase already needs route params and browser navigation, and React Router keeps the code clearer.

### Sample Scores

Bundle two self-authored MusicXML fixtures in the app.

Reason: The phase requires offline, license-safe demo material and E2E-ready input.

Impact: The viewer works without backend calls and can be tested deterministically.

Alternative: Fetch samples from the network. Rejected because this phase must work offline and avoid external dependencies.

## Risks

- Verovio integration can require careful SVG and DOM handling for measure mapping.
- MusicXML parser coverage must stay intentionally small and fail clearly for unsupported structures.
- Recent-score persistence must not block score loading if IndexedDB is unavailable.
- The repository still contains backend and legacy iOS code, but Phase 1 must not modify them.
