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
- Colab training pipeline preparation: runnable
- Actual Colab GPU training: waiting for user

The current fixture dataset is synthetic-only and generated from code-owned geometric score fixtures. It contains no real scan/photo corpus and no third-party score material.

Local Windows policy:

- AMD Radeon RX 580 is not used for PyTorch/ROCm product training.
- Do not use unofficial ROCm patches, GPU overrides, or DirectML product training.
- Local PC work is limited to validation, CPU/static smoke checks, ONNX/package validation, and browser inference.

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

Validate Phase 9E-H Colab preparation:

```bash
node ai-training/scripts/validate-configs.mjs
node ai-training/scripts/validate-notebooks.mjs
```

Validate a model artifact before installing:

```bash
node ai-training/scripts/validate-model-artifact.mjs path/to/cuenote-layout-0.1.0-experimental.zip
```

Install a validated artifact into the Web PWA static model catalog:

```bash
node ai-training/scripts/install-model-artifact.mjs path/to/cuenote-layout-0.1.0-experimental.zip
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

## Google Colab

Notebook:

- `notebooks/cuenote_phase9_colab.ipynb`

User steps:

1. Open the notebook in Google Colab.
2. Runtime -> Change runtime type -> GPU for real training.
3. Approve Google Drive mount.
4. Set `CUENOTE_REPO_URL` if the notebook needs to clone the repository.
5. Confirm dataset terms and license evidence.
6. Choose `CUENOTE_RUN_MODE`: `SMOKE`, `LAYOUT_TRAIN`, `SYMBOL_TRAIN`, or `FULL_PIPELINE`.
7. Run all.
8. If Colab disconnects, rerun the notebook; compatible checkpoint metadata is used for resume.
9. Download the final artifact zip from Drive.
10. Run local artifact validation and installation.

Default Drive layout:

```text
/content/drive/MyDrive/CueNote/
├─ datasets/
│  ├─ raw/
│  ├─ converted/
│  └─ manifests/
├─ checkpoints/
│  ├─ layout/
│  └─ symbol/
├─ artifacts/
│  ├─ layout/
│  ├─ symbol/
│  └─ onnx/
├─ reports/
├─ logs/
├─ cache/
└─ runs/
```

Free Colab limits:

- GPU may not be allocated.
- GPU model and VRAM are not guaranteed.
- Sessions can disconnect.
- Drive throughput can be slow.
- Long training may require resume.
- Full training must not be reported PASS until the notebook actually completes.

## Dataset Sources

- DeepScoresV2 dense is the first external dataset path. Registry: `registry/dataset-sources.json`.
- DeepScoresV2 dense official source is Zenodo record `10.5281/zenodo.4012193`; the registry records the dense archive md5 and CC BY 4.0 evidence.
- The user must confirm dataset terms before Colab download/use.
- PrIMuS and MUSCIMA++ are currently `EXCLUDED` placeholders until official license evidence is recorded.

## Colab Artifacts

Expected artifact zip contents:

- `manifest.json`
- `evaluation.json`
- `taxonomy.json`
- `config.json`
- `checksums.json`
- trained ONNX file

Actual trained artifacts must use distinct model IDs such as:

- `cuenote-layout-deepscores-exp`
- `cuenote-symbol-deepscores-exp`

Do not confuse these with `cuenote-layout-smoke` or `cuenote-symbol-smoke`.

## Non-Goals

- No pitch inference
- No duration inference
- No notehead/stem structure assembly
- No `EditableScoreDocument`
- No MusicXML draft generation
- No Phase 6 editor handoff
- No product model promotion from synthetic-only smoke metrics
