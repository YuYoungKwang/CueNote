from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import atomic_write_json, sha256_file, utc_now


def export_yolo_onnx(checkpoint: Path, config: dict[str, Any], output_dir: Path) -> Path:
    try:
        from ultralytics import YOLO
    except Exception as error:
        raise RuntimeError("Ultralytics is not installed.") from error
    output_dir.mkdir(parents=True, exist_ok=True)
    model = YOLO(str(checkpoint))
    exported = model.export(format="onnx", opset=13, imgsz=int(config["inputSize"]), simplify=True, dynamic=False)
    exported_path = Path(exported)
    target = output_dir / f"{config['modelId']}-{config['modelVersion']}.onnx"
    exported_path.replace(target)
    return target


def validate_onnx_file(onnx_path: Path) -> dict[str, Any]:
    try:
        import onnx
    except Exception as error:
        raise RuntimeError("onnx package is not installed.") from error
    model = onnx.load(str(onnx_path))
    onnx.checker.check_model(model)
    return {
        "schemaVersion": 1,
        "status": "PASS",
        "file": str(onnx_path),
        "sha256": sha256_file(onnx_path),
        "sizeBytes": onnx_path.stat().st_size,
        "checkedAt": utc_now(),
        "inputs": [value.name for value in model.graph.input],
        "outputs": [value.name for value in model.graph.output],
    }


def write_model_manifest(onnx_path: Path, config: dict[str, Any], classes: list[str], report_path: Path, manifest_path: Path) -> dict[str, Any]:
    manifest = {
        "schemaVersion": 1,
        "modelId": config["modelId"],
        "version": config["modelVersion"],
        "task": config["task"],
        "status": config.get("status", "EXPERIMENTAL"),
        "file": onnx_path.name,
        "sha256": sha256_file(onnx_path),
        "sizeBytes": onnx_path.stat().st_size,
        "input": {
            "width": int(config["inputSize"]),
            "height": int(config["inputSize"]),
            "channels": 3,
            "tensorLayout": "NCHW",
            "resizeMode": "LETTERBOX",
            "valueRange": "ZERO_TO_ONE",
        },
        "outputs": [
            {
                "name": "output0",
                "format": "YOLO_V8_RAW",
                "coordinateSpace": "TENSOR_NORMALIZED",
                "shape": [1, 4 + len(classes), -1],
            }
        ],
        "executionProviders": ["WEBGPU", "WASM"],
        "classes": [{"id": class_id, "index": index, "label": class_id} for index, class_id in enumerate(classes)],
        "postprocessing": {
            "confidenceThreshold": 0.35,
            "nmsThreshold": 0.5,
            "autoAcceptThreshold": 0.92,
            "lowConfidenceThreshold": 0.55,
        },
        "datasetVersion": "",
        "taxonomyVersion": "cuenote-omr-taxonomy-v1",
        "evaluationReport": report_path.name,
        "minimumAppVersion": "0.9.0",
        "createdAt": utc_now(),
    }
    atomic_write_json(manifest_path, manifest)
    return manifest
