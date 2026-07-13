from __future__ import annotations

import shutil
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
    checkpoint_to_resume = resume_checkpoint if resume_checkpoint and resume_checkpoint.exists() else None
    should_resume = resume and checkpoint_to_resume is not None
    resume_skipped_reason = None
    if should_resume and checkpoint_to_resume and checkpoint_finished_target_epochs(checkpoint_to_resume, int(config["epochs"])):
        should_resume = False
        resume_skipped_reason = "checkpoint_already_reached_target_epochs"
    if not should_resume:
        shutil.rmtree(output_dir / "train", ignore_errors=True)
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
        "plots": False,
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
        "resultSummary": metrics_summary(results),
        "resumedFrom": str(checkpoint_to_resume) if should_resume else None,
        "resumeSkippedReason": resume_skipped_reason,
    }
    atomic_write_json(checkpoint_meta, meta)
    return meta


def checkpoint_finished_target_epochs(checkpoint: Path, target_epochs: int) -> bool:
    try:
        import torch
        loaded = torch.load(checkpoint, map_location="cpu", weights_only=False)
    except Exception:
        return False
    if not isinstance(loaded, dict):
        return False
    epoch = loaded.get("epoch")
    if epoch is None:
        return False
    return int(epoch) + 1 >= target_epochs


def evaluate_yolo(checkpoint: Path, dataset_yaml: Path, config: dict[str, Any], report_dir: Path, split: str = "test", report_name: str | None = None) -> dict[str, Any]:
    try:
        from ultralytics import YOLO
    except Exception as error:
        raise RuntimeError("Ultralytics is not installed.") from error
    model = YOLO(str(checkpoint))
    metrics = model.val(data=str(dataset_yaml), split=split, imgsz=int(config["inputSize"]), plots=False)
    report_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "schemaVersion": 1,
        "modelId": config["modelId"],
        "modelVersion": config["modelVersion"],
        "status": config.get("status", "EXPERIMENTAL"),
        "task": config["task"],
        "split": split,
        "evaluatedAt": utc_now(),
        "metricsSummary": metrics_summary(metrics),
        "promotionRecommendation": "EXPERIMENTAL",
        "knownFailures": ["requires_manual_metric_review_before_candidate_promotion"],
    }
    atomic_write_json(report_dir / (report_name or f"{config['modelId']}-evaluation.json"), report)
    return report


def predict_yolo_diagnostics(
    checkpoint: Path,
    image_paths: list[Path],
    config: dict[str, Any],
    output_dir: Path,
    thresholds: list[float],
    max_confidence_probe_threshold: float,
) -> dict[str, Any]:
    try:
        from ultralytics import YOLO
    except Exception as error:
        raise RuntimeError("Ultralytics is not installed.") from error
    output_dir.mkdir(parents=True, exist_ok=True)
    model = YOLO(str(checkpoint))
    prediction_counts: dict[str, int] = {}
    max_confidence = 0.0
    probe_thresholds = sorted(set([max_confidence_probe_threshold, *thresholds]))
    for threshold in probe_thresholds:
        results = model.predict(
            source=[str(path) for path in image_paths],
            conf=float(threshold),
            imgsz=int(config["inputSize"]),
            save=True,
            project=str(output_dir),
            name=f"conf-{format_threshold(threshold)}",
            exist_ok=True,
            verbose=False,
        )
        count = 0
        threshold_max = 0.0
        for result in results:
            boxes = getattr(result, "boxes", None)
            if boxes is None:
                continue
            conf = getattr(boxes, "conf", None)
            if conf is None:
                continue
            values = conf.detach().cpu().tolist() if hasattr(conf, "detach") else list(conf)
            count += len(values)
            if values:
                threshold_max = max(threshold_max, max(float(value) for value in values))
        if threshold in thresholds:
            prediction_counts[str(threshold)] = count
        max_confidence = max(max_confidence, threshold_max)
    return {
        "schemaVersion": 1,
        "status": "PASS",
        "imageCount": len(image_paths),
        "predictionCounts": prediction_counts,
        "maxConfidence": max_confidence,
        "overlayDir": str(output_dir),
        "thresholds": thresholds,
        "maxConfidenceProbeThreshold": max_confidence_probe_threshold,
        "createdAt": utc_now(),
    }


def format_threshold(value: float) -> str:
    return f"{value:.5f}".rstrip("0").rstrip(".").replace(".", "p")


def metrics_summary(metrics: Any) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for attr in ["results_dict", "speed", "names", "fitness"]:
        try:
            value = getattr(metrics, attr)
            summary[attr] = json_safe(value() if callable(value) else value)
        except Exception as error:
            summary[f"{attr}Error"] = str(error)
    box = getattr(metrics, "box", None)
    if box is not None:
        for attr in ["mp", "mr", "map50", "map", "maps"]:
            try:
                value = getattr(box, attr)
                summary[f"box_{attr}"] = json_safe(value() if callable(value) else value)
            except Exception as error:
                summary[f"box_{attr}Error"] = str(error)
    return summary


def json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if hasattr(value, "tolist"):
        return json_safe(value.tolist())
    return repr(value)


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
