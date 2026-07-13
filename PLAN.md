# Phase 7 Implementation Plan

Phase 7 implements PDF/image import and OMR layout preparation for the Web PWA. It does not implement Phase 8 symbol recognition, ONNX inference, WebGPU/WASM model execution, OCR, or MusicXML generation.

## Repository Analysis

- The primary platform is the React + TypeScript + Vite Web PWA.
- `legacy/ios-app` is Phase 11 archival material and remains out of scope.
- Phase 1-6 already provide MusicXML parsing/rendering, repeat playback, annotations, server sharing, rehearsal sync, and limited score editing.
- `web-app/src/features/import/ImportFeature.tsx` is currently only a placeholder.
- `web-app/src/workers/image.worker.ts` is currently an acknowledgement stub and can become the Phase 7 preprocessing worker.
- `web-app/src/workers/omr.worker.ts` remains Phase 0 mock OMR plumbing and will not be converted into real OMR.
- IndexedDB schema version 5 already stores recent scores, annotations, rehearsal preferences, and score edit drafts.
- Backend score/version/object storage is not required for Phase 7 because import projects are local-first and server upload must not be forced.

## Scope

- Add platform-independent import project domain types in `packages/score-domain`.
- Store original source metadata separately from page rasters, detection snapshots, user corrections, and review status.
- Use normalized canonical page coordinates for systems, staves, and measures.
- Add OPFS-first source storage with IndexedDB Blob fallback.
- Add Phase 7 IndexedDB stores for import projects, pages, source blobs, detection snapshots, corrections, and preferences.
- Add a typed worker protocol for `PREPROCESS_PAGE`, `DETECT_LAYOUT`, `CANCEL_JOB`, and `DISPOSE_PAGE`.
- Implement deterministic baseline layout detection for systems, staves, and measures as an OMR preparation detector, not as AI inference.
- Add import routes for `/imports`, `/imports/new`, and `/imports/:projectId/review`.
- Add review UI for page selection, preprocessing settings, layout overlays, correction operations, warnings, review complete, reset, and manifest export preview.
- Add focused unit tests and Playwright coverage for image/PDF import, review corrections, persistence, and offline-local behavior.

## Out of Scope

- Actual ONNX Runtime Web integration.
- WebGPU/WASM model execution.
- Note/rest/chord/lyrics OCR or symbol recognition.
- MusicXML generation from imported images/PDFs.
- Server `ImportProject` API or forced upload.
- Backend, deployment, and `legacy/ios-app` changes.
- OpenCV.js dependency. Canvas-based preprocessing is sufficient for this phase.

## Design Decisions

### PDF Rendering Adapter

Decision: Add a small `DocumentPageRenderer` contract and keep PDF handling behind the adapter. The UI will not import or store PDF.js objects directly.

Reason: The architecture requires replaceable components and page-by-page PDF processing. Keeping PDF.js behind an adapter prevents React components from depending on library internals.

Alternative: Let the import page use PDF.js directly. Rejected because it would couple UI state to renderer internals and make worker migration harder.

### Layout Detector

Decision: Implement a deterministic baseline detector using image luminance projections and synthetic fallback regions. Label it as layout preparation, not AI or OMR inference.

Reason: Phase 7 must show reviewable system/staff/measure regions without starting Phase 8 model work.

Alternative: Mock fixed rectangles only. Rejected because it would not exercise preprocessing or correction flows meaningfully.

### Coordinates

Decision: Store all region boxes as `NormalizedRect` in canonical page coordinates after page orientation/crop handling. Pixel conversion stays in geometry helpers and overlay rendering.

Reason: This keeps results stable across zoom, canvas size, device pixel ratio, and future renderer changes.

### Storage

Decision: Use OPFS for original source bytes when available and IndexedDB Blob fallback otherwise. Store no Canvas, DOM node, ImageBitmap, or worker object in IndexedDB.

Reason: The PWA offline spec lists OPFS as a candidate for large sources, with IndexedDB Blob fallback. It also protects the project model from browser object lifetimes.

### Worker Boundary

Decision: Use `image.worker.ts` for preprocessing and `layout.worker.ts` for layout detection through an explicit message protocol. Cancellation is job-id based.

Reason: Heavy image work must not live in React components. Job IDs make cancellation and stale-result handling explicit.

## Implementation Order

1. Add import domain model, geometry helpers, correction reducer, validation, and manifest round-trip helpers.
2. Add import storage stores and repository with OPFS/IndexedDB Blob source handling.
3. Implement document page renderer contract, file validation, checksum, and worker client.
4. Replace the image worker stub and add a layout worker.
5. Implement import library, new import, and review pages.
6. Add routes and navigation entry points without touching unrelated Phase 1-6 flows.
7. Add unit tests for domain, geometry, correction, validation, detector, storage, and worker-facing helpers.
8. Add Playwright E2E for image/PDF import, layout review, corrections, persistence, and offline-local access.
9. Run requested build, test, E2E, Markdown link, Docker config, and diff validations.

## Risks

- Browser PDF rendering through PDF.js may require worker asset configuration in Vite. The adapter must expose failure states such as `PDF_WORKER_FAILED` rather than blank UI.
- OPFS behavior differs by browser. IndexedDB Blob fallback remains required.
- Synthetic test PDFs are intentionally simple and only validate Phase 7 page-by-page import plumbing, not real-world PDF fidelity.
- Baseline layout detection is conservative and review-first. It must not be presented as model accuracy.
