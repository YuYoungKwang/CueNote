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
from .training import evaluate_yolo, train_yolo


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
    if (converted / "annotations.json").exists() and (converted / "dataset.yaml").exists():
        report_path = converted / "conversion-report.json"
        report = read_json(report_path) if report_path.exists() else {"schemaVersion": 1, "datasetId": source["datasetId"], "reused": True}
        leakage = validate_split_leakage(converted / "annotations.json")
        if leakage["status"] != "PASS":
            raise RuntimeError("Existing converted subset failed split leakage validation")
        write_json(layout.reports / "split-leakage-report.json", leakage)
        update_run_state(layout.run_state, datasetVersion=source["datasetVersion"])
        return {"layout": layout, "converted": converted, "datasetReport": report, "leakage": leakage}

    archive_path = layout.raw / source["archiveFileName"]
    if not archive_path.exists():
        try:
            download_with_resume(source["downloadUri"], archive_path, expected_md5=source["archiveMd5"], min_free_bytes=2_000_000_000)
        except Exception as error:
            raise RuntimeError(f"{error}. {manual_placement_message(archive_path)}") from error
    extracted = extract_archive(archive_path, layout.cache / "deepscoresv2-dense")
    max_items = config["datasetPolicy"]["maxDenseImagesForSmoke"] if run_mode == "SMOKE" else config["datasetPolicy"]["maxDenseImagesForColabSubset"]
    max_source_groups = None if run_mode == "SMOKE" else config["datasetPolicy"].get("maxDenseSourceGroupsForColabSubset")
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
