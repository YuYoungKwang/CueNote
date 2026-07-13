from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import atomic_write_json, config_checksum, set_seed, utc_now


def train_yolo(dataset_yaml: Path, config: dict[str, Any], output_dir: Path, resume: bool = True) -> dict[str, Any]:
    try:
        from ultralytics import YOLO
        import torch
    except Exception as error:
        raise RuntimeError("Ultralytics/PyTorch dependencies are not installed. Run the Colab dependency cell first.") from error

    if not torch.cuda.is_available():
        raise RuntimeError("GPU runtime is not available. Switch Colab Runtime -> Change runtime type -> GPU, or use SMOKE mode only.")

    set_seed(int(config.get("seed", 90210)))
    output_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_meta = output_dir / "checkpoint-metadata.json"
    model = YOLO(config["pretrainedWeights"])
    args = {
        "data": str(dataset_yaml),
        "imgsz": int(config["inputSize"]),
        "batch": int(config["batchSize"]),
        "epochs": int(config["epochs"]),
        "workers": int(config.get("workers", 2)),
        "project": str(output_dir),
        "name": "train",
        "exist_ok": True,
        "patience": int(config.get("earlyStoppingPatience", 8)),
        "seed": int(config.get("seed", 90210)),
        "resume": resume,
        "amp": config.get("precision") == "amp",
    }
    results = model.train(**args)
    meta = {
        "schemaVersion": 1,
        "runId": f"{config['modelId']}-{config['modelVersion']}",
        "modelId": config["modelId"],
        "modelVersion": config["modelVersion"],
        "task": config["task"],
        "configChecksum": config_checksum(config),
        "datasetYaml": str(dataset_yaml),
        "lastCheckpoint": str(output_dir / "train" / "weights" / "last.pt"),
        "bestCheckpoint": str(output_dir / "train" / "weights" / "best.pt"),
        "createdAt": utc_now(),
        "resultSummary": str(results),
    }
    atomic_write_json(checkpoint_meta, meta)
    return meta


def evaluate_yolo(checkpoint: Path, dataset_yaml: Path, config: dict[str, Any], report_dir: Path) -> dict[str, Any]:
    try:
        from ultralytics import YOLO
    except Exception as error:
        raise RuntimeError("Ultralytics is not installed.") from error
    model = YOLO(str(checkpoint))
    metrics = model.val(data=str(dataset_yaml), split="test", imgsz=int(config["inputSize"]))
    report_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "schemaVersion": 1,
        "modelId": config["modelId"],
        "modelVersion": config["modelVersion"],
        "status": config.get("status", "EXPERIMENTAL"),
        "task": config["task"],
        "evaluatedAt": utc_now(),
        "metricsSummary": str(metrics),
        "promotionRecommendation": "EXPERIMENTAL",
        "knownFailures": ["requires_manual_metric_review_before_candidate_promotion"],
    }
    atomic_write_json(report_dir / f"{config['modelId']}-evaluation.json", report)
    return report
