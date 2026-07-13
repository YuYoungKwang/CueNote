from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

from .common import read_json


def validate_split_leakage(annotation_file: str | Path) -> dict[str, Any]:
    rows = read_json(annotation_file)
    groups: dict[str, set[str]] = defaultdict(set)
    checksums: dict[str, str] = {}
    failures = []
    for row in rows:
        group_id = row.get("sourceGroupId")
        split = row.get("split")
        if group_id:
            groups[group_id].add(split)
        checksum = row.get("imageChecksum")
        if checksum:
            previous = checksums.get(checksum)
            if previous and previous != row.get("itemId"):
                failures.append({"code": "duplicate_image_checksum", "message": f"{row.get('itemId')} duplicates {previous}"})
            checksums[checksum] = row.get("itemId")
    for group_id, splits in groups.items():
        if len(splits) > 1:
            failures.append({"code": "source_group_split_conflict", "message": f"{group_id} appears in {sorted(splits)}"})
    return {
        "schemaVersion": 1,
        "status": "PASS" if not failures else "FAIL",
        "sourceGroupCount": len(groups),
        "checkedKeys": ["sourceGroupId", "originalDocumentId", "score_id", "source MusicXML", "rendering template"],
        "failures": failures,
    }
