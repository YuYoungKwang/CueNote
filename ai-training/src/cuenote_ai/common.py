from __future__ import annotations

import hashlib
import json
import os
import platform
import random
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: str | Path) -> Any:
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: str | Path, value: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def atomic_write_json(path: str | Path, value: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=target.parent, delete=False) as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temp_name = handle.name
    Path(temp_name).replace(target)


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def md5_file(path: str | Path) -> str:
    digest = hashlib.md5()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_commit(repo_root: Path) -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=repo_root, text=True).strip()
    except Exception:
        return "unknown"


def config_checksum(config: dict[str, Any]) -> str:
    encoded = json.dumps(config, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def set_seed(seed: int) -> None:
    random.seed(seed)
    os.environ["PYTHONHASHSEED"] = str(seed)
    try:
        import numpy as np

        np.random.seed(seed)
    except Exception:
        pass
    try:
        import torch

        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)
    except Exception:
        pass


def environment_report(repo_root: Path, config: dict[str, Any]) -> dict[str, Any]:
    report: dict[str, Any] = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "processor": platform.processor(),
        "gitCommit": git_commit(repo_root),
        "configChecksum": config_checksum(config),
        "createdAt": utc_now(),
        "disk": disk_report(Path("/content") if Path("/content").exists() else repo_root),
    }
    try:
        import torch

        report["torch"] = {
            "version": torch.__version__,
            "cudaAvailable": torch.cuda.is_available(),
            "cudaVersion": getattr(torch.version, "cuda", None),
            "cudnnVersion": torch.backends.cudnn.version() if torch.backends.cudnn.is_available() else None,
            "deviceCount": torch.cuda.device_count(),
            "devices": [
                {
                    "index": index,
                    "name": torch.cuda.get_device_name(index),
                    "totalMemoryBytes": torch.cuda.get_device_properties(index).total_memory,
                }
                for index in range(torch.cuda.device_count())
            ],
        }
    except Exception as error:
        report["torch"] = {"error": str(error)}
    return report


def disk_report(path: Path) -> dict[str, int]:
    usage = shutil.disk_usage(path)
    return {"totalBytes": usage.total, "usedBytes": usage.used, "freeBytes": usage.free}


@dataclass(frozen=True)
class DriveLayout:
    root: Path
    datasets: Path
    raw: Path
    converted: Path
    manifests: Path
    checkpoints: Path
    artifacts: Path
    onnx: Path
    reports: Path
    logs: Path
    cache: Path
    runs: Path
    run_state: Path


def bytes_from_gb(value: int | float) -> int:
    return int(float(value) * 1024 * 1024 * 1024)


def ensure_min_free_space(path: Path, minimum_free_bytes: int, *, label: str) -> dict[str, int]:
    report = disk_report(path)
    if report["freeBytes"] < minimum_free_bytes:
        raise RuntimeError(
            f"{label} free space is below the required threshold. "
            f"Required at least {minimum_free_bytes} bytes free, found {report['freeBytes']} bytes. "
            "Clean raw archives, extracted temporary files, cache, old runs, or large artifacts before training."
        )
    return report


def make_drive_layout(root: str | Path, colab_config: dict[str, Any]) -> DriveLayout:
    base = Path(root)
    paths = colab_config["paths"]
    scratch = Path(colab_config.get("scratchRoot", "/content/cuenote-phase9"))
    layout = DriveLayout(
        root=base,
        datasets=base / paths["datasets"],
        raw=scratch / paths["raw"],
        converted=base / paths["converted"],
        manifests=base / paths["manifests"],
        checkpoints=base / paths["checkpoints"],
        artifacts=base / paths["artifacts"],
        onnx=base / paths["onnx"],
        reports=base / paths["reports"],
        logs=base / paths["logs"],
        cache=scratch / paths["cache"],
        runs=scratch / paths["runs"],
        run_state=base / colab_config["statusFile"],
    )
    for value in layout.__dict__.values():
        if isinstance(value, Path):
            value.mkdir(parents=True, exist_ok=True) if value.suffix == "" else value.parent.mkdir(parents=True, exist_ok=True)
    return layout
