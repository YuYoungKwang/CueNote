from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

from .artifacts import package_artifact
from .common import bytes_from_gb, ensure_min_free_space, environment_report, make_drive_layout, read_json, write_json
from .convert_deepscores import convert_coco_like_dataset, extract_archive
from .dataset_registry import assert_train_eligible, license_report, load_registry, source_by_id
from .download import download_with_resume, manual_placement_message
from .export import export_yolo_onnx, validate_onnx_file, write_model_manifest
from .run_state import mark_error, update_run_state
from .split_validation import validate_split_leakage
from .training import evaluate_yolo, predict_yolo_diagnostics, train_yolo


def prepare_environment(repo_root: Path, drive_root: Path, run_mode: str) -> dict[str, Any]:
    colab_config = read_json(repo_root / "ai-training/configs/colab/phase9_colab.json")
    layout = make_drive_layout(drive_root, colab_config)
    report = environment_report(repo_root, {"runMode": run_mode, "colab": colab_config})
    write_json(layout.reports / "environment-report.json", report)
    update_run_state(layout.run_state, runId=f"phase9-{run_mode.lower()}", gitCommit=report["gitCommit"])
    return {"config": colab_config, "layout": layout, "environment": report}


def prepare_dataset(
    repo_root: Path,
    drive_root: Path,
    run_mode: str = "SMOKE",
    *,
    converted_name: str | None = None,
    allowed_class_ids: list[str] | None = None,
) -> dict[str, Any]:
    prepared = prepare_environment(repo_root, drive_root, run_mode)
    layout = prepared["layout"]
    config = prepared["config"]
    registry = load_registry(repo_root / "ai-training/registry/dataset-sources.json")
    evidence = license_report(registry)
    write_json(layout.reports / "license-report.json", evidence)
    write_json(layout.manifests / "license-evidence.json", evidence)
    dataset_id = config["datasetPolicy"]["fallbackDataset"] if run_mode == "SMOKE" else config["datasetPolicy"]["defaultDataset"]
    source = source_by_id(registry, dataset_id)
    assert_train_eligible(source, allow_research_only=config["datasetPolicy"].get("allowResearchOnlyTraining", False))
    if run_mode == "SMOKE":
        source_fixture = repo_root / "ai-training/generated/fixture-dataset"
        converted = layout.converted / "cuenote-fixture-omr"
        if converted.exists():
            shutil.rmtree(converted)
        shutil.copytree(source_fixture, converted)
        report = {"schemaVersion": 1, "datasetId": source["datasetId"], "datasetVersion": source["datasetVersion"], "mode": "SMOKE", "itemCount": len(read_json(converted / "manifest.json").get("items", []))}
        write_json(layout.reports / "fixture-smoke-dataset-report.json", report)
        update_run_state(layout.run_state, datasetVersion=source["datasetVersion"])
        return {"layout": layout, "converted": converted, "datasetReport": report, "leakage": {"status": "PASS", "mode": "fixture-smoke"}}
    converted = layout.converted / (converted_name or "deepscoresv2-dense")
    max_items = config["datasetPolicy"]["maxDenseImagesForColabSubset"]
    max_source_groups = config["datasetPolicy"].get("maxDenseSourceGroupsForColabSubset")
    if (converted / "annotations.json").exists() and (converted / "dataset.yaml").exists():
        report_path = converted / "conversion-report.json"
        report = read_json(report_path) if report_path.exists() else {"schemaVersion": 1, "datasetId": source["datasetId"], "reused": True}
        if conversion_matches(report, max_items, max_source_groups, allowed_class_ids):
            leakage = validate_split_leakage(converted / "annotations.json")
            if leakage["status"] != "PASS":
                raise RuntimeError("Existing converted subset failed split leakage validation")
            write_json(layout.reports / "split-leakage-report.json", leakage)
            update_run_state(layout.run_state, datasetVersion=source["datasetVersion"])
            return {"layout": layout, "converted": converted, "datasetReport": report, "leakage": leakage}
        shutil.rmtree(converted)

    archive_path = layout.raw / source["archiveFileName"]
    if not archive_path.exists():
        try:
            download_with_resume(source["downloadUri"], archive_path, expected_md5=source["archiveMd5"], min_free_bytes=2_000_000_000)
        except Exception as error:
            raise RuntimeError(f"{error}. {manual_placement_message(archive_path)}") from error
    extracted = extract_archive(archive_path, layout.cache / "deepscoresv2-dense")
    report = convert_coco_like_dataset(
        extracted,
        converted,
        repo_root / "ai-training/mappings/deepscoresv2-to-cuenote.json",
        dataset_id=source["datasetId"],
        dataset_version=source["datasetVersion"],
        max_items=max_items,
        max_source_groups=max_source_groups,
        allowed_class_ids=allowed_class_ids,
    )
    leakage = validate_split_leakage(converted / "annotations.json")
    write_json(layout.reports / "split-leakage-report.json", leakage)
    if leakage["status"] != "PASS":
        raise RuntimeError("Split leakage validation failed")
    update_run_state(layout.run_state, datasetVersion=source["datasetVersion"])
    return {"layout": layout, "converted": converted, "datasetReport": report, "leakage": leakage}


def conversion_matches(
    report: dict[str, Any],
    max_items: int | None,
    max_source_groups: int | None,
    allowed_class_ids: list[str] | None,
) -> bool:
    if report.get("maxItems") != max_items:
        return False
    if report.get("maxSourceGroups") != max_source_groups:
        return False
    if sorted(report.get("allowedClassIds") or []) != sorted(allowed_class_ids or []):
        return False
    return True


def train_task(repo_root: Path, drive_root: Path, task: str, run_mode: str = "SMOKE") -> dict[str, Any]:
    if task == "LAYOUT_DETECTION":
        config_path = repo_root / "ai-training/configs/layout/yolo_layout_colab.json"
        prefix = "layout"
    elif task == "SYMBOL_DETECTION":
        config_path = repo_root / "ai-training/configs/symbol/yolo_symbol_colab.json"
        prefix = "symbol"
    else:
        raise ValueError(f"Unsupported task {task}")
    config = read_json(config_path)
    dataset = prepare_dataset(
        repo_root,
        drive_root,
        run_mode,
        converted_name=f"deepscoresv2-dense-{prefix}",
        allowed_class_ids=config.get("classes", []),
    )
    layout = dataset["layout"]
    actual_classes = dataset.get("datasetReport", {}).get("classIds") or config.get("classes", [])
    if not actual_classes:
        raise RuntimeError(f"No classes were mapped for {prefix}. Check conversion-report.json and mapping aliases.")
    colab_config = read_json(repo_root / "ai-training/configs/colab/phase9_colab.json")
    drive_space = ensure_min_free_space(
        layout.root,
        bytes_from_gb(colab_config.get("minimumFreeDriveGbBeforeTraining", 3)),
        label="Google Drive",
    )
    write_json(layout.reports / "drive-space-before-training.json", drive_space)
    run_dir = layout.runs / prefix
    try:
        resume_enabled = bool(colab_config.get("checkpointPolicy", {}).get("resumeIfCompatible", False))
        persisted_last_checkpoint = layout.checkpoints / prefix / "last.pt" if resume_enabled else None
        checkpoint_meta = train_yolo(
            dataset["converted"] / "dataset.yaml",
            config,
            run_dir,
            resume=resume_enabled,
            resume_checkpoint=persisted_last_checkpoint,
        )
        checkpoint_meta = persist_checkpoints(checkpoint_meta, layout.checkpoints / prefix)
        update_run_state(layout.run_state, **{f"{prefix}TrainingStatus": "PASS"})
        evaluation = evaluate_yolo(Path(checkpoint_meta["bestCheckpoint"]), dataset["converted"] / "dataset.yaml", config, layout.reports)
        update_run_state(layout.run_state, **{f"{prefix}EvaluationStatus": "PASS"})
        onnx_path = export_yolo_onnx(Path(checkpoint_meta["bestCheckpoint"]), config, layout.onnx)
        onnx_validation = validate_onnx_file(onnx_path)
        write_json(layout.reports / f"{prefix}-onnx-validation.json", onnx_validation)
        manifest_path = layout.artifacts / prefix / "manifest.json"
        evaluation_path = layout.reports / f"{config['modelId']}-evaluation.json"
        manifest = write_model_manifest(onnx_path, config, actual_classes, evaluation_path, manifest_path)
        zip_path = layout.artifacts / f"{config['modelId']}-{config['modelVersion']}-{manifest['status'].lower()}.zip"
        package_artifact(
            output_zip=zip_path,
            manifest_path=manifest_path,
            evaluation_path=evaluation_path,
            taxonomy_path=repo_root / "ai-training/taxonomy/classes.json",
            config_path=config_path,
            onnx_path=onnx_path,
        )
        update_run_state(layout.run_state, **{f"{prefix}OnnxStatus": "PASS"})
        cleanup_scratch(layout)
        return {"checkpoint": checkpoint_meta, "evaluation": evaluation, "manifest": manifest, "artifact": str(zip_path)}
    except Exception as error:
        mark_error(layout.run_state, f"{prefix}-train", error)
        raise


def train_symbol_overfit(repo_root: Path, drive_root: Path, run_mode: str = "SYMBOL_OVERFIT") -> dict[str, Any]:
    prepared = prepare_environment(repo_root, drive_root, run_mode)
    colab_config = prepared["config"]
    layout = prepared["layout"]
    policy = colab_config["overfitPolicy"]
    config = read_json(repo_root / "ai-training/configs/symbol/yolo_symbol_colab.json")
    source_converted = layout.converted / policy["sourceConvertedDataset"]
    if not (source_converted / "dataset.yaml").exists():
        prepared_dataset = prepare_dataset(
            repo_root,
            drive_root,
            "SYMBOL_TRAIN",
            converted_name=policy["sourceConvertedDataset"],
            allowed_class_ids=config.get("classes", []),
        )
        source_converted = prepared_dataset["converted"]
        layout = prepared_dataset["layout"]
    overfit_converted = layout.converted / policy["convertedDataset"]
    tiny_report = create_symbol_overfit_dataset(
        source_converted,
        overfit_converted,
        image_count=int(policy.get("trainImageCount", 2)),
    )
    overfit_config = {
        **config,
        "modelVersion": f"{config['modelVersion']}-overfit",
        "status": "EXPERIMENTAL",
        "diagnosticMode": "SYMBOL_OVERFIT",
        "batchSize": int(policy["batchSize"]),
        "inputSize": int(policy["inputSize"]),
        "epochs": int(policy["epochs"]),
        "earlyStoppingPatience": int(policy["earlyStoppingPatience"]),
        "pretrained": bool(policy.get("pretrained", True)),
        "plots": bool(policy.get("plots", False)),
        "savePeriodEpochs": -1,
        "checkpointIntervalEpochs": -1,
        "keepRecentCheckpointCount": 1,
    }
    drive_space = ensure_min_free_space(
        layout.root,
        bytes_from_gb(colab_config.get("minimumFreeDriveGbBeforeTraining", 3)),
        label="Google Drive",
    )
    write_json(layout.reports / "drive-space-before-training.json", drive_space)
    run_dir = layout.runs / "symbol-overfit"
    try:
        checkpoint_meta = train_yolo(
            overfit_converted / "dataset.yaml",
            overfit_config,
            run_dir,
            resume=False,
            resume_checkpoint=None,
        )
        checkpoint_meta = persist_checkpoints(checkpoint_meta, layout.checkpoints / "symbol-overfit")
        train_evaluation = evaluate_yolo(
            Path(checkpoint_meta["bestCheckpoint"]),
            overfit_converted / "dataset.yaml",
            overfit_config,
            layout.reports,
            split="train",
            report_name=f"{overfit_config['modelId']}-overfit-train-evaluation.json",
        )
        image_paths = sorted((overfit_converted / "train/images").iterdir())
        prediction_report = predict_yolo_diagnostics(
            Path(checkpoint_meta["bestCheckpoint"]),
            image_paths,
            overfit_config,
            layout.reports / "symbol-overfit-predictions",
            thresholds=[float(value) for value in policy["predictionConfidenceThresholds"]],
            max_confidence_probe_threshold=float(policy["maxConfidenceProbeThreshold"]),
        )
        train_map50 = extract_map50(train_evaluation)
        max_confidence = float(prediction_report.get("maxConfidence", 0))
        prediction_counts = prediction_report.get("predictionCounts", {})
        overfit_passed = (
            train_map50 >= float(policy["minPassingTrainMap50"])
            and max_confidence >= float(policy["minPassingMaxConfidence"])
            and int(prediction_counts.get("0.001", 0)) > 0
        )
        diagnostic_report = {
            "schemaVersion": 1,
            "mode": "SYMBOL_OVERFIT",
            "status": "EXPERIMENTAL",
            "diagnosticStatus": "PASS" if overfit_passed else "FAIL",
            "modelId": overfit_config["modelId"],
            "modelVersion": overfit_config["modelVersion"],
            "task": overfit_config["task"],
            "dataset": tiny_report,
            "training": {
                "batchSize": overfit_config["batchSize"],
                "inputSize": overfit_config["inputSize"],
                "epochs": overfit_config["epochs"],
                "earlyStoppingPatience": overfit_config["earlyStoppingPatience"],
                "pretrained": overfit_config["pretrained"],
                "plots": overfit_config["plots"],
            },
            "trainMap50": train_map50,
            "predictionCounts": prediction_counts,
            "maxConfidence": max_confidence,
            "predictionOverlayDir": prediction_report["overlayDir"],
            "recommendation": (
                "OVERFIT_PASS_RERUN_SYMBOL_TRAIN_ALLOWED"
                if overfit_passed
                else "DO_NOT_REPEAT_FULL_SYMBOL_TRAIN_UNTIL_TINY_OVERFIT_PASSES"
            ),
            "notes": [
                "This is a diagnostic overfit run, not a product model.",
                "Keep artifacts EXPERIMENTAL/DIAGNOSTIC and do not promote to CANDIDATE or PRODUCT.",
            ],
        }
        diagnostic_path = layout.reports / "symbol-overfit-diagnostic.json"
        write_json(diagnostic_path, diagnostic_report)
        onnx_path = export_yolo_onnx(Path(checkpoint_meta["bestCheckpoint"]), overfit_config, layout.onnx)
        onnx_validation = validate_onnx_file(onnx_path)
        write_json(layout.reports / "symbol-overfit-onnx-validation.json", onnx_validation)
        manifest_path = layout.artifacts / "symbol-overfit" / "manifest.json"
        actual_classes = tiny_report.get("classIds") or overfit_config.get("classes", [])
        manifest = write_model_manifest(onnx_path, overfit_config, actual_classes, diagnostic_path, manifest_path)
        zip_path = layout.artifacts / f"{overfit_config['modelId']}-{overfit_config['modelVersion']}-diagnostic.zip"
        overfit_config_path = layout.artifacts / "symbol-overfit" / "config.json"
        write_json(overfit_config_path, overfit_config)
        package_artifact(
            output_zip=zip_path,
            manifest_path=manifest_path,
            evaluation_path=diagnostic_path,
            taxonomy_path=repo_root / "ai-training/taxonomy/classes.json",
            config_path=overfit_config_path,
            onnx_path=onnx_path,
        )
        update_run_state(layout.run_state, symbolOverfitStatus=diagnostic_report["diagnosticStatus"])
        cleanup_scratch(layout)
        return {"checkpoint": checkpoint_meta, "diagnostic": diagnostic_report, "manifest": manifest, "artifact": str(zip_path)}
    except Exception as error:
        mark_error(layout.run_state, "symbol-overfit", error)
        raise


def train_symbol_tile_overfit(repo_root: Path, drive_root: Path, run_mode: str = "SYMBOL_TILE_OVERFIT") -> dict[str, Any]:
    prepared = prepare_environment(repo_root, drive_root, run_mode)
    colab_config = prepared["config"]
    layout = prepared["layout"]
    policy = colab_config["tileOverfitPolicy"]
    config = read_json(repo_root / "ai-training/configs/symbol/yolo_symbol_colab.json")
    source_converted = layout.converted / policy["sourceConvertedDataset"]
    if not (source_converted / "dataset.yaml").exists():
        prepared_dataset = prepare_dataset(
            repo_root,
            drive_root,
            "SYMBOL_TRAIN",
            converted_name=policy["sourceConvertedDataset"],
            allowed_class_ids=config.get("classes", []),
        )
        source_converted = prepared_dataset["converted"]
        layout = prepared_dataset["layout"]
    tile_converted = layout.converted / policy["convertedDataset"]
    tile_report = create_symbol_tile_overfit_dataset(
        source_converted,
        tile_converted,
        label_overlay_dir=layout.reports / "symbol-tile-overfit-labels",
        policy=policy,
    )
    tile_config = {
        **config,
        "modelVersion": f"{config['modelVersion']}-tile-overfit",
        "status": "EXPERIMENTAL",
        "diagnosticMode": "SYMBOL_TILE_OVERFIT",
        "batchSize": int(policy["batchSize"]),
        "inputSize": int(policy["inputSize"]),
        "epochs": int(policy["epochs"]),
        "earlyStoppingPatience": int(policy["earlyStoppingPatience"]),
        "pretrained": bool(policy.get("pretrained", True)),
        "plots": bool(policy.get("plots", False)),
        "savePeriodEpochs": -1,
        "checkpointIntervalEpochs": -1,
        "keepRecentCheckpointCount": 1,
    }
    drive_space = ensure_min_free_space(
        layout.root,
        bytes_from_gb(colab_config.get("minimumFreeDriveGbBeforeTraining", 3)),
        label="Google Drive",
    )
    write_json(layout.reports / "drive-space-before-training.json", drive_space)
    run_dir = layout.runs / "symbol-tile-overfit"
    try:
        checkpoint_meta = train_yolo(
            tile_converted / "dataset.yaml",
            tile_config,
            run_dir,
            resume=False,
            resume_checkpoint=None,
        )
        checkpoint_meta = persist_checkpoints(checkpoint_meta, layout.checkpoints / "symbol-tile-overfit")
        train_evaluation = evaluate_yolo(
            Path(checkpoint_meta["bestCheckpoint"]),
            tile_converted / "dataset.yaml",
            tile_config,
            layout.reports,
            split="train",
            report_name=f"{tile_config['modelId']}-tile-overfit-train-evaluation.json",
        )
        image_paths = sorted((tile_converted / "train/images").iterdir())
        prediction_report = predict_yolo_diagnostics(
            Path(checkpoint_meta["bestCheckpoint"]),
            image_paths,
            tile_config,
            layout.reports / "symbol-tile-overfit-predictions",
            thresholds=[float(value) for value in policy["predictionConfidenceThresholds"]],
            max_confidence_probe_threshold=float(policy["maxConfidenceProbeThreshold"]),
        )
        train_map50 = extract_map50(train_evaluation)
        max_confidence = float(prediction_report.get("maxConfidence", 0))
        prediction_counts = prediction_report.get("predictionCounts", {})
        overfit_passed = (
            train_map50 >= float(policy["minPassingTrainMap50"])
            and max_confidence >= float(policy["minPassingMaxConfidence"])
            and int(prediction_counts.get("0.001", 0)) > 0
        )
        diagnostic_report = {
            "schemaVersion": 1,
            "mode": "SYMBOL_TILE_OVERFIT",
            "status": "EXPERIMENTAL",
            "diagnosticStatus": "PASS" if overfit_passed else "FAIL",
            "modelId": tile_config["modelId"],
            "modelVersion": tile_config["modelVersion"],
            "task": tile_config["task"],
            "dataset": tile_report,
            "training": {
                "batchSize": tile_config["batchSize"],
                "inputSize": tile_config["inputSize"],
                "epochs": tile_config["epochs"],
                "earlyStoppingPatience": tile_config["earlyStoppingPatience"],
                "pretrained": tile_config["pretrained"],
                "plots": tile_config["plots"],
            },
            "trainMap50": train_map50,
            "predictionCounts": prediction_counts,
            "maxConfidence": max_confidence,
            "labelOverlayDir": tile_report["labelOverlayDir"],
            "predictionOverlayDir": prediction_report["overlayDir"],
            "recommendation": (
                "TILE_OVERFIT_PASS_INVESTIGATE_FULL_SYMBOL_TRAIN_INPUT_SCALE"
                if overfit_passed
                else "DO_NOT_REPEAT_FULL_SYMBOL_TRAIN_UNTIL_TILE_OVERFIT_PASSES"
            ),
            "notes": [
                "This is a diagnostic tile/crop overfit run, not a product model.",
                "Keep artifacts EXPERIMENTAL/DIAGNOSTIC and do not promote to CANDIDATE or PRODUCT.",
            ],
        }
        diagnostic_path = layout.reports / "symbol-tile-overfit-diagnostic.json"
        write_json(diagnostic_path, diagnostic_report)
        onnx_path = export_yolo_onnx(Path(checkpoint_meta["bestCheckpoint"]), tile_config, layout.onnx)
        onnx_validation = validate_onnx_file(onnx_path)
        write_json(layout.reports / "symbol-tile-overfit-onnx-validation.json", onnx_validation)
        manifest_path = layout.artifacts / "symbol-tile-overfit" / "manifest.json"
        actual_classes = tile_report.get("classIds") or tile_config.get("classes", [])
        manifest = write_model_manifest(onnx_path, tile_config, actual_classes, diagnostic_path, manifest_path)
        zip_path = layout.artifacts / f"{tile_config['modelId']}-{tile_config['modelVersion']}-diagnostic.zip"
        tile_config_path = layout.artifacts / "symbol-tile-overfit" / "config.json"
        write_json(tile_config_path, tile_config)
        package_artifact(
            output_zip=zip_path,
            manifest_path=manifest_path,
            evaluation_path=diagnostic_path,
            taxonomy_path=repo_root / "ai-training/taxonomy/classes.json",
            config_path=tile_config_path,
            onnx_path=onnx_path,
        )
        update_run_state(layout.run_state, symbolTileOverfitStatus=diagnostic_report["diagnosticStatus"])
        cleanup_scratch(layout)
        return {"checkpoint": checkpoint_meta, "diagnostic": diagnostic_report, "manifest": manifest, "artifact": str(zip_path)}
    except Exception as error:
        mark_error(layout.run_state, "symbol-tile-overfit", error)
        raise


def train_symbol_tile_train(repo_root: Path, drive_root: Path, run_mode: str = "SYMBOL_TILE_TRAIN") -> dict[str, Any]:
    prepared = prepare_environment(repo_root, drive_root, run_mode)
    colab_config = prepared["config"]
    layout = prepared["layout"]
    policy = colab_config["tileTrainPolicy"]
    config_path = repo_root / "ai-training/configs/symbol/yolo_symbol_colab.json"
    config = read_json(config_path)
    source_converted = layout.converted / policy["sourceConvertedDataset"]
    if not (source_converted / "dataset.yaml").exists():
        prepared_dataset = prepare_dataset(
            repo_root,
            drive_root,
            "SYMBOL_TRAIN",
            converted_name=policy["sourceConvertedDataset"],
            allowed_class_ids=config.get("classes", []),
        )
        source_converted = prepared_dataset["converted"]
        layout = prepared_dataset["layout"]
    tile_converted = layout.converted / policy["convertedDataset"]
    tile_report = create_symbol_tile_dataset(
        source_converted,
        tile_converted,
        label_overlay_dir=layout.reports / "symbol-tile-train-labels",
        policy=policy,
    )
    tile_config = {
        **config,
        "modelVersion": f"{config['modelVersion']}-tile",
        "status": "EXPERIMENTAL",
        "trainingInput": "TILE_CROP",
        "inputPolicy": "source_group_preserving_tile_crop",
        "batchSize": int(policy["batchSize"]),
        "inputSize": int(policy["inputSize"]),
        "epochs": int(policy["epochs"]),
        "earlyStoppingPatience": int(policy["earlyStoppingPatience"]),
        "pretrained": bool(policy.get("pretrained", True)),
        "plots": bool(policy.get("plots", False)),
        "savePeriodEpochs": -1,
        "checkpointIntervalEpochs": -1,
        "keepRecentCheckpointCount": 1,
    }
    drive_space = ensure_min_free_space(
        layout.root,
        bytes_from_gb(colab_config.get("minimumFreeDriveGbBeforeTraining", 3)),
        label="Google Drive",
    )
    write_json(layout.reports / "drive-space-before-training.json", drive_space)
    run_dir = layout.runs / "symbol-tile"
    try:
        resume_enabled = bool(colab_config.get("checkpointPolicy", {}).get("resumeIfCompatible", False))
        persisted_last_checkpoint = layout.checkpoints / "symbol-tile" / "last.pt" if resume_enabled else None
        checkpoint_meta = train_yolo(
            tile_converted / "dataset.yaml",
            tile_config,
            run_dir,
            resume=resume_enabled,
            resume_checkpoint=persisted_last_checkpoint,
        )
        checkpoint_meta = persist_checkpoints(checkpoint_meta, layout.checkpoints / "symbol-tile")
        validation_evaluation = evaluate_yolo(
            Path(checkpoint_meta["bestCheckpoint"]),
            tile_converted / "dataset.yaml",
            tile_config,
            layout.reports,
            split="val",
            report_name=f"{tile_config['modelId']}-tile-validation-evaluation.json",
        )
        test_evaluation = evaluate_yolo(
            Path(checkpoint_meta["bestCheckpoint"]),
            tile_converted / "dataset.yaml",
            tile_config,
            layout.reports,
            split="test",
            report_name=f"{tile_config['modelId']}-tile-test-evaluation.json",
        )
        evaluation_report = {
            "schemaVersion": 1,
            "mode": "SYMBOL_TILE_TRAIN",
            "status": "EXPERIMENTAL",
            "modelId": tile_config["modelId"],
            "modelVersion": tile_config["modelVersion"],
            "task": tile_config["task"],
            "datasetId": tile_report["datasetId"],
            "evaluationBasis": "tile validation/test splits from source-group-preserving DeepScoresV2 dense symbol crops",
            "dataset": tile_report,
            "training": {
                "batchSize": tile_config["batchSize"],
                "inputSize": tile_config["inputSize"],
                "epochs": tile_config["epochs"],
                "earlyStoppingPatience": tile_config["earlyStoppingPatience"],
                "pretrained": tile_config["pretrained"],
                "plots": tile_config["plots"],
            },
            "validation": validation_evaluation,
            "test": test_evaluation,
            "promotionRecommendation": "EXPERIMENTAL",
            "knownFailures": [
                "Phase 8 runtime does not yet orchestrate tile inference/stitching for symbol detections.",
                "Phase 10 structure assembly, pitch/duration inference, and MusicXML generation are not implemented.",
                "Do not promote this artifact to CANDIDATE or PRODUCT without fixed-split metrics and browser tile inference validation.",
            ],
        }
        evaluation_path = layout.reports / f"{tile_config['modelId']}-tile-evaluation.json"
        write_json(evaluation_path, evaluation_report)
        update_run_state(layout.run_state, symbolTileTrainingStatus="PASS", symbolTileEvaluationStatus="PASS")
        onnx_path = export_yolo_onnx(Path(checkpoint_meta["bestCheckpoint"]), tile_config, layout.onnx)
        onnx_validation = validate_onnx_file(onnx_path)
        write_json(layout.reports / "symbol-tile-onnx-validation.json", onnx_validation)
        manifest_path = layout.artifacts / "symbol-tile" / "manifest.json"
        actual_classes = tile_report.get("classIds") or tile_config.get("classes", [])
        manifest = write_model_manifest(onnx_path, tile_config, actual_classes, evaluation_path, manifest_path)
        zip_path = layout.artifacts / f"{tile_config['modelId']}-{tile_config['modelVersion']}-{manifest['status'].lower()}.zip"
        tile_config_path = layout.artifacts / "symbol-tile" / "config.json"
        write_json(tile_config_path, tile_config)
        package_artifact(
            output_zip=zip_path,
            manifest_path=manifest_path,
            evaluation_path=evaluation_path,
            taxonomy_path=repo_root / "ai-training/taxonomy/classes.json",
            config_path=tile_config_path,
            onnx_path=onnx_path,
        )
        update_run_state(layout.run_state, symbolTileOnnxStatus="PASS")
        cleanup_scratch(layout)
        return {"checkpoint": checkpoint_meta, "evaluation": evaluation_report, "manifest": manifest, "artifact": str(zip_path)}
    except Exception as error:
        mark_error(layout.run_state, "symbol-tile-train", error)
        raise


def install_repo_if_needed(repo_url: str, target_dir: Path) -> Path:
    if target_dir.exists() and (target_dir / ".git").exists():
        os.system(f"git -C {target_dir} pull --ff-only")
        return target_dir
    if not repo_url:
        raise RuntimeError("CUENOTE_REPO_URL is not set. Clone the repository into Colab or set the env var.")
    os.system(f"git clone {repo_url} {target_dir}")
    return target_dir


def persist_checkpoints(checkpoint_meta: dict[str, Any], target_dir: Path) -> dict[str, Any]:
    target_dir.mkdir(parents=True, exist_ok=True)
    persisted: dict[str, Any] = dict(checkpoint_meta)
    for key, filename in [("lastCheckpoint", "last.pt"), ("bestCheckpoint", "best.pt")]:
        source = Path(checkpoint_meta[key])
        if not source.exists():
            raise FileNotFoundError(f"Expected checkpoint is missing: {source}")
        target = target_dir / filename
        shutil.copy2(source, target)
        persisted[key] = str(target)
    recent_targets = []
    for index, source_name in enumerate(checkpoint_meta.get("recentEpochCheckpoints", []), start=1):
        source = Path(source_name)
        if source.exists():
            target = target_dir / f"recent-{index}.pt"
            shutil.copy2(source, target)
            recent_targets.append(str(target))
    persisted["recentEpochCheckpoints"] = recent_targets
    write_json(target_dir / "checkpoint-metadata.json", persisted)
    return persisted


def cleanup_scratch(layout: Any) -> None:
    for path in [layout.raw, layout.cache, layout.runs]:
        if path.exists():
            shutil.rmtree(path)


def create_symbol_overfit_dataset(source_dir: Path, target_dir: Path, image_count: int) -> dict[str, Any]:
    shutil.rmtree(target_dir, ignore_errors=True)
    train_images = sorted((source_dir / "train/images").iterdir())
    selected = []
    for image in train_images:
        label = source_dir / "train/labels" / f"{image.stem}.txt"
        if label.exists() and label.read_text(encoding="utf-8").strip():
            selected.append((image, label))
        if len(selected) >= image_count:
            break
    if not selected:
        raise RuntimeError(f"No non-empty train labels found under {source_dir / 'train/labels'}")
    class_ids = parse_yolo_names(source_dir / "dataset.yaml")
    for split in ["train", "validation", "test"]:
        (target_dir / split / "images").mkdir(parents=True, exist_ok=True)
        (target_dir / split / "labels").mkdir(parents=True, exist_ok=True)
        for image, label in selected:
            shutil.copy2(image, target_dir / split / "images" / image.name)
            shutil.copy2(label, target_dir / split / "labels" / label.name)
    dataset_yaml = target_dir / "dataset.yaml"
    dataset_yaml.write_text(
        f'path: "{target_dir.resolve().as_posix()}"\n'
        "train: train/images\n"
        "val: validation/images\n"
        "test: test/images\n"
        "names:\n"
        + "\n".join(f"  {index}: {name}" for index, name in enumerate(class_ids))
        + "\n",
        encoding="utf-8",
    )
    label_stats = count_yolo_labels([label for _, label in selected], len(class_ids))
    report = {
        "schemaVersion": 1,
        "datasetId": "deepscoresv2-dense-symbol-overfit",
        "sourceDataset": str(source_dir),
        "converted": str(target_dir),
        "imageCount": len(selected),
        "labelCount": label_stats["labelCount"],
        "badLabelCount": label_stats["badLabelCount"],
        "classCount": len(class_ids),
        "classIds": class_ids,
        "imageReferences": [image.name for image, _ in selected],
    }
    write_json(target_dir / "overfit-dataset-report.json", report)
    return report


def create_symbol_tile_overfit_dataset(source_dir: Path, target_dir: Path, *, label_overlay_dir: Path, policy: dict[str, Any]) -> dict[str, Any]:
    from PIL import Image, ImageDraw

    shutil.rmtree(target_dir, ignore_errors=True)
    shutil.rmtree(label_overlay_dir, ignore_errors=True)
    label_overlay_dir.mkdir(parents=True, exist_ok=True)
    class_ids = parse_yolo_names(source_dir / "dataset.yaml")
    crop_size = int(policy["cropSize"])
    allowed_crop_sizes = set(int(value) for value in policy.get("allowedCropSizes", [512, 768, 1024]))
    if crop_size not in allowed_crop_sizes:
        raise RuntimeError(f"Unsupported crop size {crop_size}. Allowed values: {sorted(allowed_crop_sizes)}")
    overlap = float(policy.get("overlap", 0.25))
    if overlap < 0.2 or overlap > 0.3:
        raise RuntimeError("SYMBOL_TILE_OVERFIT overlap must be between 0.2 and 0.3")
    max_crops = int(policy.get("maxCropCount", 50))
    min_crops = int(policy.get("minCropCount", 10))
    source_count = int(policy.get("sourceTrainImageCount", 2))
    min_box_pixels = float(policy.get("minBoxPixels", 2))
    keep_empty_crops = bool(policy.get("keepEmptyCrops", False))
    selected_images = select_labeled_train_images(source_dir, source_count)
    crop_records: list[dict[str, Any]] = []
    empty_crop_count = 0
    dropped_small_boxes = 0
    dropped_outside_boxes = 0
    bad_label_count = 0

    for image_path, label_path in selected_images:
        with Image.open(image_path) as image:
            image = image.convert("RGB")
            width, height = image.size
            labels = read_yolo_labels(label_path, width, height, len(class_ids))
            bad_label_count += sum(1 for label in labels if label.get("bad"))
            valid_labels = [label for label in labels if not label.get("bad")]
            for tile in generate_tiles(width, height, crop_size, overlap):
                crop_labels = []
                for label in valid_labels:
                    converted = label_to_crop(label, tile, crop_size, min_box_pixels)
                    if converted["status"] == "outside":
                        dropped_outside_boxes += 1
                        continue
                    if converted["status"] == "too_small":
                        dropped_small_boxes += 1
                        continue
                    crop_labels.append(converted["line"])
                if not crop_labels and not keep_empty_crops:
                    empty_crop_count += 1
                    continue
                crop_name = f"{image_path.stem}-x{tile['x']}-y{tile['y']}.png"
                crop = image.crop((tile["x"], tile["y"], tile["x"] + crop_size, tile["y"] + crop_size))
                crop_records.append({"name": crop_name, "image": crop.copy(), "labels": crop_labels, "source": image_path.name, "tile": tile})
                if len(crop_records) >= max_crops:
                    break
            if len(crop_records) >= max_crops:
                break

    if len(crop_records) < min_crops:
        raise RuntimeError(f"SYMBOL_TILE_OVERFIT produced only {len(crop_records)} crops; expected at least {min_crops}.")

    crop_records = crop_records[:max_crops]
    for split in ["train", "validation", "test"]:
        (target_dir / split / "images").mkdir(parents=True, exist_ok=True)
        (target_dir / split / "labels").mkdir(parents=True, exist_ok=True)
        for record in crop_records:
            image_target = target_dir / split / "images" / record["name"]
            label_target = target_dir / split / "labels" / f"{Path(record['name']).stem}.txt"
            record["image"].save(image_target)
            label_target.write_text("\n".join(record["labels"]) + ("\n" if record["labels"] else ""), encoding="utf-8")
            if split == "train":
                save_label_overlay(record["image"], record["labels"], class_ids, label_overlay_dir / record["name"], ImageDraw)

    dataset_yaml = target_dir / "dataset.yaml"
    dataset_yaml.write_text(
        f'path: "{target_dir.resolve().as_posix()}"\n'
        "train: train/images\n"
        "val: validation/images\n"
        "test: test/images\n"
        "names:\n"
        + "\n".join(f"  {index}: {name}" for index, name in enumerate(class_ids))
        + "\n",
        encoding="utf-8",
    )
    label_paths = list((target_dir / "train/labels").glob("*.txt"))
    label_stats = count_yolo_labels(label_paths, len(class_ids))
    report = {
        "schemaVersion": 1,
        "datasetId": "deepscoresv2-dense-symbol-tile-overfit",
        "sourceDataset": str(source_dir),
        "converted": str(target_dir),
        "sourceImageCount": len(selected_images),
        "cropImageCount": len(crop_records),
        "cropSize": crop_size,
        "overlap": overlap,
        "emptyCropCount": empty_crop_count,
        "droppedSmallBoxCount": dropped_small_boxes,
        "droppedOutsideBoxCount": dropped_outside_boxes,
        "labelCount": label_stats["labelCount"],
        "badLabelCount": label_stats["badLabelCount"] + bad_label_count,
        "classCount": len(class_ids),
        "classIds": class_ids,
        "labelOverlayDir": str(label_overlay_dir),
        "emptyCropPolicy": "skipped" if not keep_empty_crops else "kept",
        "bboxPolicy": {
            "included": "Boxes intersecting a crop are clipped and converted to crop-relative YOLO xywh.",
            "tooSmall": f"Boxes smaller than {min_box_pixels} px after clipping are dropped.",
            "outside": "Boxes with no crop intersection are dropped.",
            "coordinateValidation": "All output YOLO coordinates must stay within 0..1.",
        },
    }
    if report["badLabelCount"] != 0:
        raise RuntimeError(f"SYMBOL_TILE_OVERFIT produced bad labels: {report['badLabelCount']}")
    write_json(target_dir / "tile-overfit-dataset-report.json", report)
    return report


def create_symbol_tile_dataset(source_dir: Path, target_dir: Path, *, label_overlay_dir: Path, policy: dict[str, Any]) -> dict[str, Any]:
    shutil.rmtree(target_dir, ignore_errors=True)
    shutil.rmtree(label_overlay_dir, ignore_errors=True)
    label_overlay_dir.mkdir(parents=True, exist_ok=True)
    class_ids = parse_yolo_names(source_dir / "dataset.yaml")
    crop_size = int(policy["cropSize"])
    allowed_crop_sizes = set(int(value) for value in policy.get("allowedCropSizes", [512, 768, 1024]))
    if crop_size not in allowed_crop_sizes:
        raise RuntimeError(f"Unsupported crop size {crop_size}. Allowed values: {sorted(allowed_crop_sizes)}")
    overlap = float(policy.get("overlap", 0.25))
    if overlap < 0.2 or overlap > 0.3:
        raise RuntimeError("SYMBOL_TILE_TRAIN overlap must be between 0.2 and 0.3")
    min_box_pixels = float(policy.get("minBoxPixels", 2))
    keep_empty_crops = bool(policy.get("keepEmptyCrops", False))
    split_reports: dict[str, dict[str, Any]] = {}
    totals = {
        "sourceImageCount": 0,
        "cropImageCount": 0,
        "emptyCropCount": 0,
        "droppedSmallBoxCount": 0,
        "droppedOutsideBoxCount": 0,
        "labelCount": 0,
        "badLabelCount": 0,
    }

    for split in ["train", "validation", "test"]:
        report = create_symbol_tiles_for_split(
            source_dir,
            target_dir,
            label_overlay_dir,
            split=split,
            class_ids=class_ids,
            crop_size=crop_size,
            overlap=overlap,
            min_box_pixels=min_box_pixels,
            keep_empty_crops=keep_empty_crops,
        )
        split_reports[split] = report
        for key in totals:
            totals[key] += int(report.get(key, 0))
        if report["cropImageCount"] == 0:
            raise RuntimeError(f"SYMBOL_TILE_TRAIN produced no crops for {split}; cannot train/evaluate without that split.")

    dataset_yaml = target_dir / "dataset.yaml"
    dataset_yaml.write_text(
        f'path: "{target_dir.resolve().as_posix()}"\n'
        "train: train/images\n"
        "val: validation/images\n"
        "test: test/images\n"
        "names:\n"
        + "\n".join(f"  {index}: {name}" for index, name in enumerate(class_ids))
        + "\n",
        encoding="utf-8",
    )
    report = {
        "schemaVersion": 1,
        "datasetId": policy.get("datasetId", "deepscoresv2-dense-symbol-tile"),
        "sourceDataset": str(source_dir),
        "converted": str(target_dir),
        "cropSize": crop_size,
        "overlap": overlap,
        "sourceGroupSplitPreserved": True,
        "leakagePolicy": "Tiles are generated independently inside each existing source-group split; no crop is copied across train/validation/test.",
        "splits": split_reports,
        **totals,
        "classCount": len(class_ids),
        "classIds": class_ids,
        "labelOverlayDir": str(label_overlay_dir),
        "emptyCropPolicy": "skipped" if not keep_empty_crops else "kept",
        "bboxPolicy": {
            "included": "Boxes intersecting a crop are clipped and converted to crop-relative YOLO xywh.",
            "tooSmall": f"Boxes smaller than {min_box_pixels} px after clipping are dropped.",
            "outside": "Boxes with no crop intersection are dropped.",
            "coordinateValidation": "All output YOLO coordinates must stay within 0..1.",
        },
    }
    if report["badLabelCount"] != 0:
        raise RuntimeError(f"SYMBOL_TILE_TRAIN produced bad labels: {report['badLabelCount']}")
    write_json(target_dir / "tile-dataset-report.json", report)
    return report


def create_symbol_tiles_for_split(
    source_dir: Path,
    target_dir: Path,
    label_overlay_dir: Path,
    *,
    split: str,
    class_ids: list[str],
    crop_size: int,
    overlap: float,
    min_box_pixels: float,
    keep_empty_crops: bool,
) -> dict[str, Any]:
    from PIL import Image, ImageDraw

    source_image_dir = source_dir / split / "images"
    source_label_dir = source_dir / split / "labels"
    target_image_dir = target_dir / split / "images"
    target_label_dir = target_dir / split / "labels"
    target_image_dir.mkdir(parents=True, exist_ok=True)
    target_label_dir.mkdir(parents=True, exist_ok=True)
    source_images = sorted(path for path in source_image_dir.iterdir() if path.is_file())
    source_image_count = 0
    crop_image_count = 0
    empty_crop_count = 0
    dropped_small_boxes = 0
    dropped_outside_boxes = 0
    source_bad_label_count = 0

    for image_path in source_images:
        label_path = source_label_dir / f"{image_path.stem}.txt"
        if not label_path.exists():
            continue
        source_image_count += 1
        with Image.open(image_path) as image:
            image = image.convert("RGB")
            width, height = image.size
            labels = read_yolo_labels(label_path, width, height, len(class_ids))
            source_bad_label_count += sum(1 for label in labels if label.get("bad"))
            valid_labels = [label for label in labels if not label.get("bad")]
            for tile in generate_tiles(width, height, crop_size, overlap):
                crop_labels = []
                for label in valid_labels:
                    converted = label_to_crop(label, tile, crop_size, min_box_pixels)
                    if converted["status"] == "outside":
                        dropped_outside_boxes += 1
                        continue
                    if converted["status"] == "too_small":
                        dropped_small_boxes += 1
                        continue
                    crop_labels.append(converted["line"])
                if not crop_labels and not keep_empty_crops:
                    empty_crop_count += 1
                    continue
                crop_name = f"{image_path.stem}-x{tile['x']}-y{tile['y']}.png"
                crop = image.crop((tile["x"], tile["y"], tile["x"] + crop_size, tile["y"] + crop_size))
                image_target = target_image_dir / crop_name
                label_target = target_label_dir / f"{Path(crop_name).stem}.txt"
                crop.save(image_target)
                label_target.write_text("\n".join(crop_labels) + ("\n" if crop_labels else ""), encoding="utf-8")
                save_label_overlay(crop, crop_labels, class_ids, label_overlay_dir / split / crop_name, ImageDraw)
                crop_image_count += 1

    label_stats = count_yolo_labels(list(target_label_dir.glob("*.txt")), len(class_ids))
    return {
        "sourceImageCount": source_image_count,
        "cropImageCount": crop_image_count,
        "emptyCropCount": empty_crop_count,
        "droppedSmallBoxCount": dropped_small_boxes,
        "droppedOutsideBoxCount": dropped_outside_boxes,
        "labelCount": label_stats["labelCount"],
        "badLabelCount": label_stats["badLabelCount"] + source_bad_label_count,
    }


def parse_yolo_names(dataset_yaml: Path) -> list[str]:
    names: list[str] = []
    in_names = False
    for line in dataset_yaml.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped == "names:":
            in_names = True
            continue
        if in_names:
            if not line.startswith("  "):
                break
            if ":" in stripped:
                _, value = stripped.split(":", 1)
                names.append(value.strip().strip("'\""))
    if not names:
        raise RuntimeError(f"No YOLO names found in {dataset_yaml}")
    return names


def select_labeled_train_images(source_dir: Path, image_count: int) -> list[tuple[Path, Path]]:
    selected = []
    for image in sorted((source_dir / "train/images").iterdir()):
        label = source_dir / "train/labels" / f"{image.stem}.txt"
        if label.exists() and label.read_text(encoding="utf-8").strip():
            selected.append((image, label))
        if len(selected) >= image_count:
            break
    if not selected:
        raise RuntimeError(f"No non-empty train labels found under {source_dir / 'train/labels'}")
    return selected


def read_yolo_labels(label_path: Path, image_width: int, image_height: int, class_count: int) -> list[dict[str, Any]]:
    labels = []
    for line in label_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        parts = line.split()
        try:
            class_index = int(parts[0])
            cx, cy, width, height = [float(value) for value in parts[1:]]
        except Exception:
            labels.append({"bad": True})
            continue
        if len(parts) != 5 or class_index < 0 or class_index >= class_count or any(value < 0 or value > 1 for value in [cx, cy, width, height]):
            labels.append({"bad": True})
            continue
        box_width = width * image_width
        box_height = height * image_height
        center_x = cx * image_width
        center_y = cy * image_height
        labels.append({
            "bad": False,
            "classIndex": class_index,
            "x1": center_x - box_width / 2,
            "y1": center_y - box_height / 2,
            "x2": center_x + box_width / 2,
            "y2": center_y + box_height / 2,
        })
    return labels


def generate_tiles(width: int, height: int, crop_size: int, overlap: float) -> list[dict[str, int]]:
    stride = max(1, int(round(crop_size * (1 - overlap))))
    xs = axis_positions(width, crop_size, stride)
    ys = axis_positions(height, crop_size, stride)
    return [{"x": x, "y": y} for y in ys for x in xs]


def axis_positions(length: int, crop_size: int, stride: int) -> list[int]:
    if length <= crop_size:
        return [0]
    positions = list(range(0, max(1, length - crop_size + 1), stride))
    last = length - crop_size
    if positions[-1] != last:
        positions.append(last)
    return positions


def label_to_crop(label: dict[str, Any], tile: dict[str, int], crop_size: int, min_box_pixels: float) -> dict[str, Any]:
    crop_x1 = tile["x"]
    crop_y1 = tile["y"]
    crop_x2 = crop_x1 + crop_size
    crop_y2 = crop_y1 + crop_size
    x1 = max(label["x1"], crop_x1)
    y1 = max(label["y1"], crop_y1)
    x2 = min(label["x2"], crop_x2)
    y2 = min(label["y2"], crop_y2)
    if x2 <= x1 or y2 <= y1:
        return {"status": "outside"}
    width = x2 - x1
    height = y2 - y1
    if width < min_box_pixels or height < min_box_pixels:
        return {"status": "too_small"}
    cx = ((x1 + x2) / 2 - crop_x1) / crop_size
    cy = ((y1 + y2) / 2 - crop_y1) / crop_size
    normalized_width = width / crop_size
    normalized_height = height / crop_size
    values = [cx, cy, normalized_width, normalized_height]
    if any(value < 0 or value > 1 for value in values):
        return {"status": "too_small"}
    return {
        "status": "ok",
        "line": f"{label['classIndex']} {cx:.8f} {cy:.8f} {normalized_width:.8f} {normalized_height:.8f}",
    }


def save_label_overlay(image: Any, labels: list[str], class_ids: list[str], output_path: Path, image_draw: Any) -> None:
    overlay = image.copy()
    draw = image_draw.Draw(overlay)
    width, height = overlay.size
    for line in labels:
        parts = line.split()
        if len(parts) != 5:
            continue
        class_index = int(parts[0])
        cx, cy, box_width, box_height = [float(value) for value in parts[1:]]
        x1 = (cx - box_width / 2) * width
        y1 = (cy - box_height / 2) * height
        x2 = (cx + box_width / 2) * width
        y2 = (cy + box_height / 2) * height
        draw.rectangle([x1, y1, x2, y2], outline=(255, 0, 0), width=2)
        label = class_ids[class_index] if 0 <= class_index < len(class_ids) else str(class_index)
        draw.text((x1, max(0, y1 - 10)), label, fill=(255, 0, 0))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    overlay.save(output_path)


def count_yolo_labels(label_paths: list[Path], class_count: int) -> dict[str, int]:
    label_count = 0
    bad_label_count = 0
    for label_path in label_paths:
        for line in label_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            label_count += 1
            parts = line.split()
            try:
                class_index = int(parts[0])
                values = [float(part) for part in parts[1:]]
            except Exception:
                bad_label_count += 1
                continue
            if len(parts) != 5 or class_index < 0 or class_index >= class_count or any(value < 0 or value > 1 for value in values):
                bad_label_count += 1
    return {"labelCount": label_count, "badLabelCount": bad_label_count}


def extract_map50(report: dict[str, Any]) -> float:
    summary = report.get("metricsSummary", {})
    if isinstance(summary.get("box_map50"), (int, float)):
        return float(summary["box_map50"])
    results = summary.get("results_dict", {})
    if isinstance(results, dict) and isinstance(results.get("metrics/mAP50(B)"), (int, float)):
        return float(results["metrics/mAP50(B)"])
    return 0.0
