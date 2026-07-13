from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import read_json


ALLOWED_ELIGIBILITY = {"PRODUCT_TRAIN_ELIGIBLE"}


def load_registry(path: str | Path) -> dict[str, Any]:
    registry = read_json(path)
    if registry.get("schemaVersion") != 1:
        raise ValueError("dataset registry schemaVersion must be 1")
    return registry


def source_by_id(registry: dict[str, Any], dataset_id: str) -> dict[str, Any]:
    for source in registry.get("sources", []):
        if source.get("datasetId") == dataset_id:
            return source
    raise KeyError(f"dataset source not found: {dataset_id}")


def assert_train_eligible(source: dict[str, Any], *, allow_research_only: bool = False) -> None:
    if source.get("verificationStatus") != "VERIFIED":
        raise ValueError(f"{source.get('datasetId')} is not VERIFIED")
    if source.get("licenseName") in {"", "UNKNOWN"}:
        raise ValueError(f"{source.get('datasetId')} has unknown license")
    if not source.get("allowedForTraining"):
        raise ValueError(f"{source.get('datasetId')} is not allowed for training")
    if not allow_research_only and source.get("eligibility") != "PRODUCT_TRAIN_ELIGIBLE":
        raise ValueError(f"{source.get('datasetId')} is not product-train eligible")
    if source.get("licenseSpdx", "").endswith("-NC"):
        raise ValueError(f"{source.get('datasetId')} has non-commercial restriction")


def license_report(registry: dict[str, Any]) -> dict[str, Any]:
    sources = registry.get("sources", [])
    return {
        "schemaVersion": 1,
        "sourceCount": len(sources),
        "verified": sum(1 for source in sources if source.get("verificationStatus") == "VERIFIED"),
        "excluded": sum(1 for source in sources if source.get("eligibility") == "EXCLUDED"),
        "productTrainEligible": sum(1 for source in sources if source.get("eligibility") == "PRODUCT_TRAIN_ELIGIBLE"),
        "unknown": sum(1 for source in sources if source.get("licenseName") in {"", "UNKNOWN"}),
        "byDataset": [
            {
                "datasetId": source.get("datasetId"),
                "licenseName": source.get("licenseName"),
                "verificationStatus": source.get("verificationStatus"),
                "eligibility": source.get("eligibility"),
                "allowedForTraining": source.get("allowedForTraining"),
                "allowedForCommercialUse": source.get("allowedForCommercialUse"),
            }
            for source in sources
        ],
    }
