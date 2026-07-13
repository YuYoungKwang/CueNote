# CueNote OMR Training Pipeline

This directory contains the Phase 9 dataset and model-development infrastructure.

## Current Status

- Dataset infrastructure: runnable
- License validation: runnable
- Source-group leakage validation: runnable
- Layout smoke model: runnable and exported to ONNX
- Symbol smoke model: runnable and exported to ONNX
- Layout product candidate: not ready
- Symbol product candidate: not ready
- Product OMR accuracy: not evaluated

The current fixture dataset is synthetic-only and generated from code-owned geometric score fixtures. It contains no real scan/photo corpus and no third-party score material.

## Contracts

- Taxonomy: `taxonomy/classes.json`
- Annotation schema: `schemas/annotation.schema.json`
- Source/license schema: `schemas/source-license.schema.json`
- Dataset manifest schema: `schemas/dataset-manifest.schema.json`
- Evaluation report schema: `schemas/evaluation-report.schema.json`

Annotation source coordinates are pixel `x/y/width/height`. Browser model outputs use normalized system coordinates.

`UNKNOWN` or unapproved licenses are excluded by default.

## Commands

Run the full smoke pipeline:

```bash
npm --prefix ai-training run smoke
```

Equivalent direct command:

```bash
node ai-training/scripts/run-smoke-pipeline.mjs
```

The pipeline performs:

1. fixture dataset build
2. dataset/license/leakage validation
3. layout smoke train
4. layout smoke evaluation
5. layout ONNX export
6. symbol smoke train
7. symbol smoke evaluation
8. symbol ONNX export
9. ONNX manifest/hash validation

## Outputs

- Fixture dataset: `generated/fixture-dataset/`
- Reports: `reports/`
- Smoke model specs: `artifacts/layout-smoke/model-spec.json`, `artifacts/symbol-smoke/model-spec.json`
- Browser ONNX files: `../web-app/public/models/omr/layout-smoke.onnx`, `../web-app/public/models/omr/symbol-smoke.onnx`
- Browser manifests: `../web-app/public/models/omr/layout-smoke-manifest.json`, `../web-app/public/models/omr/symbol-smoke-manifest.json`

Heavy checkpoints must not be committed. Use `artifacts/checkpoints/` or external artifact storage for future GPU training.

## Non-Goals

- No pitch inference
- No duration inference
- No notehead/stem structure assembly
- No `EditableScoreDocument`
- No MusicXML draft generation
- No Phase 6 editor handoff
- No product model promotion from synthetic-only smoke metrics
