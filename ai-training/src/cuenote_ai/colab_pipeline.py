from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

from .artifacts import package_artifact
from .common import environment_report, make_drive_layout, read_json, write_json
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


def prepare_dataset(repo_root: Path, drive_root: Path, run_mode: str = "SMOKE") -> dict[str, Any]:
    prepared = prepare_environment(repo_root, drive_root, run_mode)
    layout = prepared["layout"]
    config = prepared["config"]
    registry = load_registry(repo_root / "ai-training/registry/dataset-sources.json")
    write_json(layout.reports / "license-report.json", license_report(registry))
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
    archive_path = layout.raw / source["archiveFileName"]
    if not archive_path.exists():
        try:
            download_with_resume(source["downloadUri"], archive_path, expected_md5=source["archiveMd5"], min_free_bytes=2_000_000_000)
        except Exception as error:
            raise RuntimeError(f"{error}. {manual_placement_message(archive_path)}") from error
    extracted = extract_archive(archive_path, layout.cache / "deepscoresv2-dense")
    max_items = config["datasetPolicy"]["maxDenseImagesForSmoke"] if run_mode == "SMOKE" else config["datasetPolicy"]["maxDenseImagesForColabSubset"]
    converted = layout.converted / "deepscoresv2-dense"
    report = convert_coco_like_dataset(
        extracted,
        converted,
        repo_root / "ai-training/mappings/deepscoresv2-to-cuenote.json",
        dataset_id=source["datasetId"],
        dataset_version=source["datasetVersion"],
        max_items=max_items,
    )
    leakage = validate_split_leakage(converted / "annotations.json")
    write_json(layout.reports / "split-leakage-report.json", leakage)
    if leakage["status"] != "PASS":
        raise RuntimeError("Split leakage validation failed")
    update_run_state(layout.run_state, datasetVersion=source["datasetVersion"])
    return {"layout": layout, "converted": converted, "datasetReport": report, "leakage": leakage}


def train_task(repo_root: Path, drive_root: Path, task: str, run_mode: str = "SMOKE") -> dict[str, Any]:
    dataset = prepare_dataset(repo_root, drive_root, run_mode)
    layout = dataset["layout"]
    if task == "LAYOUT_DETECTION":
        config_path = repo_root / "ai-training/configs/layout/yolo_layout_colab.json"
        prefix = "layout"
    elif task == "SYMBOL_DETECTION":
        config_path = repo_root / "ai-training/configs/symbol/yolo_symbol_colab.json"
        prefix = "symbol"
    else:
        raise ValueError(f"Unsupported task {task}")
    config = read_json(config_path)
    run_dir = layout.runs / prefix
    try:
        checkpoint_meta = train_yolo(dataset["converted"] / "dataset.yaml", config, run_dir, resume=True)
        update_run_state(layout.run_state, **{f"{prefix}TrainingStatus": "PASS"})
        evaluation = evaluate_yolo(Path(checkpoint_meta["bestCheckpoint"]), dataset["converted"] / "dataset.yaml", config, layout.reports)
        update_run_state(layout.run_state, **{f"{prefix}EvaluationStatus": "PASS"})
        onnx_path = export_yolo_onnx(Path(checkpoint_meta["bestCheckpoint"]), config, layout.onnx)
        onnx_validation = validate_onnx_file(onnx_path)
        write_json(layout.reports / f"{prefix}-onnx-validation.json", onnx_validation)
        manifest_path = layout.artifacts / prefix / "manifest.json"
        evaluation_path = layout.reports / f"{config['modelId']}-evaluation.json"
        manifest = write_model_manifest(onnx_path, config, config["classes"], evaluation_path, manifest_path)
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
