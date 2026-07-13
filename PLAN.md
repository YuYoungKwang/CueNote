# Phase 8 Implementation Plan

Phase 8 implements browser-local OMR runtime infrastructure. It does not implement production-quality layout or symbol models, structure assembly, pitch/duration inference, automatic MusicXML drafts, or Phase 6 editor handoff.

## Repository Analysis

- The primary platform is the React + TypeScript + Vite Web PWA.
- `legacy/ios-app` is Phase 11 archival material and remains out of scope.
- Phase 1-7 already provide MusicXML parsing/rendering, repeat playback, annotations, server sharing, rehearsal sync, limited score editing, PDF/image import, page preprocessing, baseline layout detection, user layout corrections, and local ImportProject storage.
- `packages/score-domain/src/import` owns Phase 7 page/system/measure regions in normalized canonical page coordinates.
- `web-app/src/workers/omr.worker.ts` is still Phase 0 mock plumbing and will become the Phase 8 worker boundary.
- IndexedDB schema version 6 stores recent scores, annotations, rehearsal preferences, score edit drafts, and Phase 7 import records. Phase 8 will add OMR model metadata, jobs, detection results, corrections, and preferences.
- The backend is not required for Phase 8 because model manifests and the test ONNX model can be served as static PWA assets.

## Revised Scope

- Add OMR model input/output contracts.
- Add model manifest schema and class-index mapping validation.
- Build tensors from Phase 7 reviewed SYSTEM crops, not whole pages.
- Implement manifest-driven tensor preprocessing and coordinate reverse mapping.
- Add ONNX Runtime Web adapter used only from `omr.worker.ts`.
- Attempt WebGPU first and fall back to WASM when WebGPU is unavailable, session creation fails, or inference fails.
- Add model download/cache/hash/rollback with model binaries in Cache Storage and metadata in IndexedDB.
- Add a tiny ONNX test model for runtime verification only. UI and tests must identify it as `TEST_RUNTIME_MODEL`.
- Add layout/symbol model adapter interfaces so Phase 9 production models can replace the test path.
- Add detection result, confidence, and review decision domain types.
- Add detection overlay and correction UI foundations with a clear `PRODUCT_MODEL_NOT_INSTALLED` state.
- Persist OMR jobs, results, corrections, model metadata, and preferences in IndexedDB.
- Restore OMR runtime/review state after reload.
- Connect Phase 7 OMR preparation manifests to Phase 8 system-crop model inputs.
- Add `ai-training` skeletons for dataset, train, evaluate, export, validate, and evaluation report schemas.
- Preserve Phase 1-7 behavior with regression tests.

## Explicitly Out of Scope

- Production layout model training.
- Production symbol model training.
- Presenting fixture detections as real OMR output.
- Completing notehead/stem recognition, pitch inference, duration inference, or structure assembly.
- Automatic MusicXML draft generation.
- Passing fake MusicXML into the Phase 6 editor.
- Claiming OMR accuracy without a dataset and evaluated product model.
- Server GPU OMR.
- Code OCR or Hangul lyric OCR.
- Native iOS/Core ML work and `legacy/ios-app` changes.

## Roadmap Adjustment

### Phase 9: OMR Dataset And Model Development

Phase 9A defines dataset specs, label schema, source-level train/validation/test splits, leakage prevention, synthetic MusicXML-rendered data, scan/photo augmentation, license records, dataset validation, and class distribution reports.

Phase 9B trains and evaluates the layout model for system, staff, measure, and barline classes, then exports a browser-compatible ONNX model and manifest.

Phase 9C trains and evaluates the symbol model for noteheads, stems, rests, accidentals, clefs, augmentation dots, repeat barlines, and navigation symbols.

Phase 9D validates browser optimization: ONNX parity, operator compatibility, WebGPU/WASM behavior, quantization, model size, load time, inference time, and accuracy/performance tradeoffs.

### Phase 10: OMR Structure And MusicXML Draft

Phase 10 consumes real Phase 9 model outputs and implements layout/symbol assignment, notehead/stem association, pitch inference, duration inference, accidental application, voice/rhythm assembly, repeats/navigation, `EditableScoreDocument`, MusicXML draft generation, and Phase 6 editor handoff.

## Design Decisions

### Test ONNX Model Boundary

Decision: The checked-in ONNX model is a runtime smoke model only. It verifies `InferenceSession` creation, tensor input transfer, output reception, worker protocol, provider fallback, cache/hash, cancellation, stale-result handling, and coordinate adapter plumbing.

Reason: No production OMR dataset, checkpoint, or evaluated model exists yet.

Alternative: Use fixture detections to complete symbol detection and MusicXML generation. Rejected because it would make Phase 8 appear to complete product OMR without a real model.

### Model Delivery

Decision: Store model binaries in Cache Storage and store only metadata/results/corrections/preferences in IndexedDB.

Reason: This follows the PWA offline and model delivery specs while avoiding base64 model blobs in IndexedDB JSON.

### Model Input Unit

Decision: Build tensors from reviewed system crops, with manifest-driven preprocessing.

Reason: Phase 7 produces reviewed page/system/measure regions. System crops reduce memory pressure and match the Phase 8 contract.

### Product Model State

Decision: UI exposes `PRODUCT_MODEL_NOT_INSTALLED` when only the test runtime model is available.

Reason: Users and tests must distinguish infrastructure readiness from product OMR capability.

## Implementation Order

1. Align docs and roadmap with the revised Phase 8/9/10 split.
2. Add OMR domain model, manifest, confidence, and correction types without MusicXML draft claims.
3. Add model manifest validation, cache/hash delivery, tensor preprocessing, coordinate mapping, and worker protocol.
4. Add OMR IndexedDB stores and repository.
5. Replace the OMR worker with ONNX Runtime loading, provider fallback, cancellation, and stale-result handling.
6. Add OMR prepare/review foundation routes and link them from Phase 7 import review.
7. Add model manifest/static test ONNX asset and AI training skeleton.
8. Add unit tests and Playwright E2E for ONNX browser load, fallback reporting, offline cache, job persistence, and correction persistence.
9. Run requested build, unit tests, E2E, manifest validation, Markdown link check, Docker config, and diff checks.

## Risks

- Browser WebGPU support varies. The implementation must report the attempted provider and fallback reason rather than assuming WebGPU success.
- The checked-in ONNX model is not useful for OMR recognition.
- Detection review UI in Phase 8 is an infrastructure shell until Phase 9 supplies product models.
- Offline model use depends on Cache Storage availability and successful prior hash verification.
