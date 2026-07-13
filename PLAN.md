# Phase 9E-H Implementation Plan

Phase 9A-D dataset infrastructure, experimental smoke models, ONNX browser execution, and Phase 8 runtime integration are complete. Phase 9E-H prepares a Google Colab based real-training pipeline. It does not claim that Colab GPU training, real checkpoints, actual trained ONNX files, product accuracy, or Phase 10 readiness have been completed.

## Repository Analysis

- The primary platform remains the React + TypeScript + Vite Web PWA.
- `legacy/ios-app` is Phase 11 archival material and remains out of scope.
- Phase 8 runtime loads manifest-based ONNX models in `web-app/src/workers/omr.worker.ts`, caches binaries in Cache Storage, and decodes `BOX_XYWH_CONF_CLASS` outputs.
- Phase 9A-D smoke infrastructure lives in `ai-training` and produces synthetic-only `layout-smoke.onnx` and `symbol-smoke.onnx` with `status: EXPERIMENTAL`.
- `web-app/src/features/import/OmrRuntimePage.tsx` exposes only built-in smoke models. Actual Colab artifacts must be installed before appearing in the UI.
- The current Windows PC has an AMD Radeon RX 580. It must not be used for PyTorch/ROCm product training, unofficial ROCm patches, GPU override, or DirectML product training.
- Local Windows is used only for data validation, CPU smoke/static checks, ONNX/package validation, and browser inference.
- Actual model training is intended for Google Colab GPU after the user opens the notebook, selects GPU runtime, mounts Drive, confirms dataset rights, and runs the notebook.

## Scope

- Add reproducible Colab notebooks for Phase 9E-H.
- Add Drive storage layout, scratch storage cleanup, checkpoint/resume, run-state, and artifact packaging policies.
- Add dataset source registry and license eligibility records for DeepScoresV2 dense and CueNote synthetic data.
- Add DeepScoresV2-to-CueNote class mapping with `EXACT`, `MERGED`, `APPROXIMATE`, and `EXCLUDED` mapping types.
- Add Colab-oriented Python pipeline code for environment checks, dataset download/cache, conversion, source-group split/leakage checks, YOLO-format export, training config, checkpoint metadata, evaluation report, ONNX export/parity, and artifact packaging.
- Add local Node validators for notebooks, configs, registry, mappings, and model artifact zip/install validation.
- Add a local fixture artifact package path to validate installer logic without pretending a trained model exists.
- Update docs and CI to distinguish pipeline preparation from actual Colab training.

## Explicitly Out of Scope

- Running Colab GPU training from Codex.
- Claiming Google Drive mount, GPU allocation, or Colab login/authorization succeeded.
- Product candidate promotion before actual trained artifacts are returned and validated.
- RX 580 ROCm training, unofficial AMD GPU overrides, or DirectML product training.
- Phase 10 structure assembly, pitch/duration inference, `EditableScoreDocument`, MusicXML drafts, and Phase 6 editor handoff.
- Server-side GPU inference, chord OCR, lyric OCR, automatic ScoreVersion publishing, and `legacy/ios-app` changes.

## Design Decisions

### Training Runtime

Decision: Colab is the product-training target. Local Windows remains validation/browser-only.

Reason: The RX 580 is not a supported PyTorch/ROCm product-training target for this project, and the user explicitly disallowed unofficial GPU paths.

Alternative: Try DirectML or unofficial ROCm patches locally. Rejected because it would create non-reproducible product-training results.

### Model Framework

Decision: Use Ultralytics YOLO nano/small configs as the initial Colab detector baseline for both layout and symbol models.

Reason: It is practical on free Colab GPUs, exports ONNX, supports object detection, has straightforward resume/checkpoint behavior, and is simpler than custom torchvision/mmdetection code for the first real-training pipeline.

Risk: YOLO may not be optimal for dense tiny music symbols. Evaluation and failure reports determine whether it stays as the candidate baseline.

### Dataset Eligibility

Decision: DeepScoresV2 dense is the first real external dataset path. The source registry records Zenodo official source, dense archive checksum, CC BY 4.0 evidence, attribution requirement, and `PRODUCT_TRAIN_ELIGIBLE` status pending user confirmation in Colab.

Reason: It has an official archive, dense subset, published checksum, and object annotations. It is still synthetic/engraved rather than camera/photo data, so scan/photo performance remains limited or unknown.

### Colab Drive Quota

Decision: Assume the default Google Drive quota is 14GB. Training modes must check Drive free space before training and stop when less than 3GB is available.

Reason: Full dataset archives, extracted data, caches, and unlimited epoch checkpoints can exhaust free Drive quickly.

Alternative: Keep all raw archives and runs in Drive. Rejected because Phase 9E-H starts from dense/source-group subsets and should preserve only reusable or final artifacts.

### Artifact Installation

Decision: Actual Colab artifacts are not shown in the app until `validate-model-artifact.mjs` and `install-model-artifact.mjs` succeed.

Reason: The UI must not display fake candidate models or stale artifacts. Installed manifests are generated from validated zip contents only.

## Implementation Order

1. Update this plan for Phase 9E-H.
2. Add Colab configs, dependency pins, dataset source registry, and class mapping.
3. Add Python pipeline modules and scripts for Colab execution.
4. Add notebooks with Run-all flow, Drive mount, resume, train/evaluate/export/package steps, and explicit user responsibility notes.
5. Add Node validators for notebooks/configs/registry/mapping/artifacts and installer scripts.
6. Add fixture artifact packaging validation without promoting smoke models to candidates.
7. Update README, PRD, Architecture, OMR spec, Roadmap, Acceptance Criteria, Codex prompts, Capability Matrix, Model Delivery spec, and `ai-training/README.md`.
8. Run feasible local validations: notebook JSON validation, config/registry checks, fixture dataset validation, license/leakage validation, artifact validator/installer smoke, frontend build/test/E2E, Docker config, Markdown links, diff checks, and backend/deploy/legacy untouched check.

## Risks

- DeepScoresV2 full data is too large for the assumed 14GB Drive budget. The pipeline starts from a dense/source-group subset and keeps raw archives, extracted files, cache, and runs in `/content` scratch storage.
- Free Drive may still fall below the 3GB pre-training threshold; the notebook must stop and ask the user to clean raw archives, extracted temporary files, cache, old runs, or large artifacts.
- Dataset class names and annotation formats may differ from the converter's first-pass assumptions; conversion script must fail clearly and produce mapping reports.
- Free Colab GPU allocation is not guaranteed and sessions can disconnect.
- Actual CANDIDATE status depends on user-run Colab artifacts and cannot be assigned by static preparation alone.
