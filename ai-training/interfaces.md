# Phase 9 Training Interfaces

These commands are interface contracts only. Phase 8 does not provide training data, checkpoints, or a production model.

```bash
python -m cuenote_omr.dataset.validate --manifest dataset.json
python -m cuenote_omr.train.layout --manifest dataset.json --output runs/layout
python -m cuenote_omr.train.symbol --manifest dataset.json --output runs/symbol
python -m cuenote_omr.evaluate --checkpoint runs/layout/best.pt --split test --output reports/layout-test.json
python -m cuenote_omr.export_onnx --checkpoint runs/layout/best.pt --output browser-models/layout.onnx
python -m cuenote_omr.validate_onnx --manifest browser-models/layout.manifest.json
```

Required validation before a model can replace `TEST_RUNTIME_MODEL`:

- source-level split check
- ONNX checker
- sample inference parity
- WebGPU operator compatibility
- WASM fallback compatibility
- hash, size, and manifest validation
- browser runtime smoke test
- evaluation report matching `schemas/evaluation-report.schema.json`
