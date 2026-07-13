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

Drive storage policy:

- Assume the default Google Drive quota is 14GB.
- Training modes stop before training when Drive has less than 3GB free.
- Do not use the full DeepScoresV2 dataset by default. Start from the configured dense source-group subset.
- Keep only dataset manifests/license evidence, the minimum reusable converted subset, last checkpoint, best checkpoint, at most one recent epoch checkpoint, evaluation reports, ONNX/model manifest, and the final artifact zip in Drive.
- Raw archives, extracted temporary files, training cache, and run directories use Colab `/content/cuenote-phase9` scratch storage and may be deleted after each successful stage.

Default persistent Drive layout:

```text
/content/drive/MyDrive/CueNote/
|-- datasets/
|   |-- converted/
|   `-- manifests/
|-- checkpoints/
|   |-- layout/
|   `-- symbol/
|-- artifacts/
|   |-- layout/
|   |-- symbol/
|   `-- onnx/
|-- reports/
|-- logs/
`-- run-state.json
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

## Phase 9I Symbol Coverage

Phase 9I expands DeepScoresV2 dense symbol conversion before rerunning `SYMBOL_TRAIN`.

New detector-only classes include:

- `beam`
- `ledger.line`
- `dot.repeat`
- `rest.16th`, `rest.32nd`, `rest.64th`
- `flag.eighth.up`, `flag.eighth.down`
- `notehead.whole`
- `time_signature.digit_4`
- `time_signature.common`

These are still experimental detector labels. They do not enable Phase 10 structure assembly, pitch/duration inference, repeat interpretation, or MusicXML generation.

Before rerunning Colab symbol training locally validate:

```powershell
node ai-training/scripts/validate-configs.mjs
node ai-training/scripts/validate-phase9i-symbol-coverage.mjs
node ai-training/scripts/validate-notebooks.mjs
```

In Colab set:

```python
os.environ["CUENOTE_RUN_MODE"] = "SYMBOL_TRAIN"
```

If the symbol detector still reports near-zero confidence, run the tiny-overfit diagnostic before repeating full symbol training:

```python
os.environ["CUENOTE_RUN_MODE"] = "SYMBOL_OVERFIT"
```

`SYMBOL_OVERFIT` uses one or two existing `deepscoresv2-dense-symbol` train images, batch size 1, image size 1280, 100 epochs, disabled early stopping, and pretrained YOLO weights. It writes:

- `reports/symbol-overfit-diagnostic.json`
- `reports/symbol-overfit-predictions/`
- `reports/symbol-overfit-onnx-validation.json`
- `artifacts/*-overfit-diagnostic.zip`

If `symbol-overfit-diagnostic.json` reports `DO_NOT_REPEAT_FULL_SYMBOL_TRAIN_UNTIL_TINY_OVERFIT_PASSES`, fix the training/data path before running full `SYMBOL_TRAIN` again.

If full-page tiny-overfit also fails, run the crop/tile diagnostic:

```python
os.environ["CUENOTE_RUN_MODE"] = "SYMBOL_TILE_OVERFIT"
```

`SYMBOL_TILE_OVERFIT` derives 10 to 50 object-containing crops from one or two existing `deepscoresv2-dense-symbol` train images. Default settings:

- crop size: `768` (`512`, `768`, or `1024` allowed)
- overlap: `0.25`
- batch size: `2`
- image size: `768`
- epochs: `100`
- early stopping: disabled

It writes:

- `reports/symbol-tile-overfit-diagnostic.json`
- `reports/symbol-tile-overfit-labels/`
- `reports/symbol-tile-overfit-predictions/`
- `reports/symbol-tile-overfit-onnx-validation.json`
- `artifacts/*-tile-overfit-diagnostic.zip`

If the report says `DO_NOT_REPEAT_FULL_SYMBOL_TRAIN_UNTIL_TILE_OVERFIT_PASSES`, do not repeat full `SYMBOL_TRAIN`. The next fix should target crop generation, labels, model IO, or training hyperparameters.

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
