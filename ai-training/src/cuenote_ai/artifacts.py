from __future__ import annotations

import zipfile
from pathlib import Path
from typing import Any

from .common import read_json, sha256_file, write_json


REQUIRED_ARTIFACT_FILES = ["manifest.json", "evaluation.json", "taxonomy.json", "config.json", "checksums.json"]


def package_artifact(
    *,
    output_zip: Path,
    manifest_path: Path,
    evaluation_path: Path,
    taxonomy_path: Path,
    config_path: Path,
    onnx_path: Path,
) -> Path:
    output_zip.parent.mkdir(parents=True, exist_ok=True)
    checksums = {
        "onnx": {"file": onnx_path.name, "sha256": sha256_file(onnx_path), "sizeBytes": onnx_path.stat().st_size},
        "manifest": {"file": "manifest.json", "sha256": sha256_file(manifest_path), "sizeBytes": manifest_path.stat().st_size},
        "evaluation": {"file": "evaluation.json", "sha256": sha256_file(evaluation_path), "sizeBytes": evaluation_path.stat().st_size},
    }
    checksum_path = output_zip.parent / "checksums.json"
    write_json(checksum_path, checksums)
    with zipfile.ZipFile(output_zip, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(manifest_path, "manifest.json")
        archive.write(evaluation_path, "evaluation.json")
        archive.write(taxonomy_path, "taxonomy.json")
        archive.write(config_path, "config.json")
        archive.write(checksum_path, "checksums.json")
        archive.write(onnx_path, onnx_path.name)
    return output_zip


def validate_artifact(zip_path: Path) -> dict[str, Any]:
    failures = []
    with zipfile.ZipFile(zip_path, "r") as archive:
        names = set(archive.namelist())
        for required in REQUIRED_ARTIFACT_FILES:
            if required not in names:
                failures.append({"code": "missing_file", "message": f"{required} missing"})
        if "manifest.json" in names:
            manifest = read_zip_json(archive, "manifest.json")
            model_file = manifest.get("file", "")
            if not model_file or model_file not in names:
                failures.append({"code": "missing_model", "message": f"model file {model_file} missing"})
            if manifest.get("status") not in {"EXPERIMENTAL", "CANDIDATE", "PRODUCT"}:
                failures.append({"code": "invalid_status", "message": "manifest status invalid"})
            if manifest.get("modelId", "").endswith("-smoke") and manifest.get("status") != "EXPERIMENTAL":
                failures.append({"code": "smoke_promotion", "message": "smoke model cannot be promoted"})
            if "checksums.json" in names and model_file in names:
                checksums = read_zip_json(archive, "checksums.json")
                expected = checksums.get("onnx", {}).get("sha256")
                actual = sha256_bytes(archive.read(model_file))
                if expected and expected != actual:
                    failures.append({"code": "checksum_mismatch", "message": "ONNX checksum mismatch"})
    return {"schemaVersion": 1, "status": "PASS" if not failures else "FAIL", "failures": failures}


def read_zip_json(archive: zipfile.ZipFile, name: str) -> Any:
    return __import__("json").loads(archive.read(name).decode("utf-8"))


def sha256_bytes(data: bytes) -> str:
    import hashlib

    return hashlib.sha256(data).hexdigest()
