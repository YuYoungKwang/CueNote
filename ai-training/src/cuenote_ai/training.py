from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import atomic_write_json, config_checksum, set_seed, utc_now


def train_yolo(
    dataset_yaml: Path,
    config: dict[str, Any],
    output_dir: Path,
    resume: bool = True,
    resume_checkpoint: Path | None = None,
) -> dict[str, Any]:
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
    local_last_checkpoint = output_dir / "train" / "weights" / "last.pt"
    checkpoint_to_resume = resume_checkpoint if resume_checkpoint and resume_checkpoint.exists() else local_last_checkpoint
    should_resume = resume and checkpoint_to_resume.exists()
    model = YOLO(str(checkpoint_to_resume) if should_resume else config["pretrainedWeights"])
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
        "resume": should_resume,
        "amp": config.get("precision") == "amp",
        "save_period": int(config.get("savePeriodEpochs", -1)),
    }
    results = model.train(**args)
    kept_epoch_checkpoints = prune_epoch_checkpoints(
        output_dir / "train" / "weights",
        keep_recent=int(config.get("keepRecentCheckpointCount", 1)),
    )
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
        "recentEpochCheckpoints": [str(path) for path in kept_epoch_checkpoints],
        "createdAt": utc_now(),
        "resultSummary": str(results),
        "resumedFrom": str(checkpoint_to_resume) if should_resume else None,
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


def prune_epoch_checkpoints(weights_dir: Path, *, keep_recent: int) -> list[Path]:
    if not weights_dir.exists():
        return []
    epoch_checkpoints = sorted(
        weights_dir.glob("epoch*.pt"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    keep = {path.resolve() for path in epoch_checkpoints[: max(0, keep_recent)]}
    for path in epoch_checkpoints:
        if path.resolve() not in keep:
            path.unlink(missing_ok=True)
    return [path for path in epoch_checkpoints if path.resolve() in keep]
