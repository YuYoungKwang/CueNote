# Phase 9 Implementation Plan

Phase 9 builds the OMR dataset, validation, smoke training, evaluation, ONNX export, and browser execution path. It does not implement Phase 10 structure interpretation, pitch/duration inference, `EditableScoreDocument`, automatic MusicXML draft generation, or editor handoff.

## Repository Analysis

- The primary platform is the React + TypeScript + Vite Web PWA.
- `legacy/ios-app` is Phase 11 archival material and remains out of scope.
- Phase 8 already provides browser-local ONNX Runtime Web loading, model manifest/hash/cache/offline reuse, WebGPU-first/WASM fallback, `TEST_RUNTIME_MODEL`, system-crop tensor preprocessing, coordinate mapping, and OMR review persistence.
- `packages/score-domain/src/omr` defines the runtime manifest, class mapping, confidence/review types, and detection result contracts.
- `web-app/src/core/omr` owns manifest parsing, cache delivery, tensor building, ONNX Runtime Web execution, coordinate mapping, and postprocessing.
- `web-app/src/workers/omr.worker.ts` is the model execution boundary.
- `web-app/public/models/omr` currently contains only the Phase 8 runtime smoke model.
- `ai-training` is a Phase 8 scaffold and must become a runnable Phase 9 pipeline.
- Python is not available in the current local environment, and no licensed real scan/photo corpus or GPU is present. Phase 9 therefore can create reproducible fixture data and experimental smoke models, but cannot honestly produce a product OMR model.

## Scope

- Define stable class taxonomy for layout and symbol detection.
- Define source/license schema, annotation schema, dataset manifest, split policy, leakage policy, metrics, failure categories, and model input/output contract before model export.
- Build a copyright-safe synthetic fixture dataset with explicit provenance and license records.
- Validate dataset items, licenses, duplicate checksums, source-group split leakage, class IDs, geometry, and distribution.
- Add deterministic smoke training/evaluation for layout and symbol models.
- Export tiny experimental ONNX models that emit manifest-driven detections.
- Generate model manifests with status `EXPERIMENTAL`, hash, class map, output contract, dataset version, and evaluation report links.
- Connect experimental layout and symbol manifests to the Phase 8 runtime without marking them as product models.
- Add browser E2E coverage for actual ONNX execution, output decode, coordinate mapping, overlay display, cache reuse, and Phase 10 deferred state.
- Update docs and acceptance criteria to reflect what is implemented and what remains unavailable.

## Explicitly Out of Scope

- Full PyTorch or GPU training.
- Real scan/photo dataset ingestion without verified licenses.
- Product model promotion.
- Pitch inference, duration inference, notehead/stem association, voice assignment, repeat semantic assembly, or MusicXML draft generation.
- Server-side GPU OMR.
- OCR for lyrics or chords.
- Native iOS/Core ML work and `legacy/ios-app` changes.

## Data Contract Decisions

### Class Taxonomy

Decision: Maintain separate layout and symbol taxonomies with stable string IDs. Numeric class indices are assigned only in generated model manifests.

Reason: Phase 8 requires manifest-driven class index mapping, and Phase 9 must avoid hardcoded class indices.

### Annotation Coordinates

Decision: Source annotations use pixel coordinates with mandatory image width/height. Exported model detections use normalized system coordinates.

Reason: Pixel labels are easier to validate against original images, while browser runtime mapping already works with normalized system/page coordinates.

### License Policy

Decision: `UNKNOWN` and unverified licenses are excluded by default. Training requires `allowedForTraining: true`, source provenance, and non-empty license metadata.

Reason: The project cannot treat web-collected scores as safe training data without explicit rights.

### Split Policy

Decision: Split by `sourceGroupId`, `compositionId`, `editionId`, `originalDocumentId`, and `syntheticTemplateId`; page-level random split is not allowed.

Reason: Synthetic variants and pages from the same score leak visual and structural information across splits.

### Model Status

Decision: Generated fixture models are `EXPERIMENTAL`. `PRODUCT` requires a fixed real/synthetic test split, per-class metrics, browser execution, WebGPU/WASM verification, known failures, reproducible training config, and checkpoint preservation.

Reason: Synthetic-only smoke models validate infrastructure, not product OMR accuracy.

## Model Baseline Decision

Decision: Use a deterministic Node.js smoke baseline in this environment. It writes a reproducible model specification from fixture labels, evaluates against the fixture test split, and exports constant-output ONNX models for browser validation.

Reason: The local environment has no Python executable, GPU, or licensed real dataset. Installing global Python or claiming product training would be unsafe. The smoke baseline still exercises dataset validation, evaluation reports, model manifests, ONNX Runtime Web, output decoding, and offline cache behavior.

Alternative: Add a PyTorch/YOLO training stack immediately. Deferred because it cannot be run or verified in this environment and would create unvalidated code paths.

## Implementation Order

1. Replace the Phase 8 plan with this Phase 9 plan.
2. Add taxonomy, source/license schema, annotation schema, dataset manifest updates, evaluation report updates, and metric gate documentation.
3. Add Node-based dataset build, validation, smoke training, evaluation, ONNX export, ONNX manifest validation, and pipeline runner.
4. Generate the fixture dataset, validation reports, smoke model specs, evaluation reports, experimental ONNX binaries, and browser manifests.
5. Extend OMR manifest/domain types with model status and detection output contracts.
6. Extend postprocessing to decode manifest-driven detection tensors for layout and symbol tasks.
7. Expose experimental model selection in the OMR runtime UI while preserving `PRODUCT_MODEL_NOT_INSTALLED`.
8. Add unit and E2E tests for detection decoding and actual layout/symbol model browser execution.
9. Update README, OMR docs, roadmap, acceptance criteria, model delivery docs, and `ai-training/README.md`.
10. Run AI pipeline, frontend build/test/E2E, Markdown links, Docker config, diff checks, and legacy/backend/deploy change checks.

## Risks

- Fixture data is synthetic and tiny; metrics are useful only as pipeline checks.
- Browser WebGPU availability depends on the test browser and cross-origin isolation. WASM fallback remains the reliable baseline.
- ONNX models are tiny constant-output smoke models, not learned product models.
- Phase 10 cannot start until real product candidate metrics and failure analysis are available.
