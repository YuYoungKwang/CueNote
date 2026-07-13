from __future__ import annotations

import json
import random
import shutil
import tarfile
from pathlib import Path
from typing import Any

from PIL import Image

from .common import sha256_file, write_json


def load_mapping(path: Path) -> dict[str, Any]:
    mapping = json.loads(path.read_text(encoding="utf-8"))
    if mapping.get("schemaVersion") != 1:
        raise ValueError("mapping schemaVersion must be 1")
    return mapping


def alias_map(mapping: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in mapping.get("mappings", []):
        keys = [row.get("sourceClassId", ""), row.get("sourceClassName", ""), *row.get("aliases", [])]
        for key in keys:
            if key:
                result[key.lower().replace(" ", "_")] = row
    return result


def extract_archive(archive: Path, target_dir: Path) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    marker = target_dir / ".extracted"
    if marker.exists():
        return target_dir
    with tarfile.open(archive, "r:gz") as tar:
        def safe(member: tarfile.TarInfo) -> bool:
            resolved = (target_dir / member.name).resolve()
            return str(resolved).startswith(str(target_dir.resolve()))

        members = [member for member in tar.getmembers() if safe(member)]
        tar.extractall(target_dir, members=members)
    marker.write_text("ok\n", encoding="utf-8")
    return target_dir


def convert_coco_like_dataset(
    source_dir: Path,
    output_dir: Path,
    mapping_path: Path,
    *,
    dataset_id: str,
    dataset_version: str,
    max_items: int | None = None,
    max_source_groups: int | None = None,
    seed: int = 90210,
) -> dict[str, Any]:
    mapping = load_mapping(mapping_path)
    by_alias = alias_map(mapping)
    annotation_file = find_annotation_file(source_dir)
    coco = json.loads(annotation_file.read_text(encoding="utf-8"))
    categories = {category["id"]: category.get("name", str(category["id"])) for category in coco.get("categories", [])}
    images = coco.get("images", [])
    random.Random(seed).shuffle(images)
    if max_source_groups:
        selected_groups: set[str] = set()
        selected_images = []
        for image in images:
            group = source_group_id(image)
            if group not in selected_groups and len(selected_groups) >= max_source_groups:
                continue
            selected_groups.add(group)
            selected_images.append(image)
        images = selected_images
    if max_items:
        images = images[:max_items]
    annotations_by_image: dict[int, list[dict[str, Any]]] = {}
    for annotation in coco.get("annotations", []):
        annotations_by_image.setdefault(annotation["image_id"], []).append(annotation)
    splits = assign_source_group_splits(images)
    annotation_rows: list[dict[str, Any]] = []
    yolo_dirs = make_yolo_dirs(output_dir)
    class_ids: list[str] = []
    excluded_count = 0
    approximate_count = 0

    for image in images:
        image_path = find_image_file(source_dir, image["file_name"])
        if not image_path:
            continue
        with Image.open(image_path) as img:
            width, height = img.size
        split = splits[source_group_id(image)]
        target_image = yolo_dirs[split]["images"] / Path(image["file_name"]).name
        target_image.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(image_path, target_image)
        item_annotations = []
        yolo_lines = []
        for annotation in annotations_by_image.get(image["id"], []):
            source_name = categories.get(annotation.get("category_id"), str(annotation.get("category_id")))
            row = by_alias.get(source_name.lower().replace(" ", "_"))
            if not row or row.get("mappingType") == "EXCLUDED" or not row.get("targetClassId"):
                excluded_count += 1
                continue
            if row.get("mappingType") == "APPROXIMATE":
                approximate_count += 1
            target_class = row["targetClassId"]
            if target_class not in class_ids:
                class_ids.append(target_class)
            class_index = class_ids.index(target_class)
            x, y, box_width, box_height = annotation["bbox"]
            item_annotations.append({
                "id": f"{image['id']}-{annotation.get('id', len(item_annotations))}",
                "classId": target_class,
                "bounds": {"x": x, "y": y, "width": box_width, "height": box_height},
                "attributes": {"mappingType": row.get("mappingType"), "sourceClassName": source_name},
                "occluded": False,
                "truncated": False,
                "ignored": False,
                "annotator": "deepscoresv2",
                "reviewStatus": "AUTO_GENERATED",
            })
            cx = (x + box_width / 2) / width
            cy = (y + box_height / 2) / height
            yolo_lines.append(f"{class_index} {cx:.8f} {cy:.8f} {box_width / width:.8f} {box_height / height:.8f}")
        label_path = yolo_dirs[split]["labels"] / f"{Path(image['file_name']).stem}.txt"
        label_path.write_text("\n".join(yolo_lines) + ("\n" if yolo_lines else ""), encoding="utf-8")
        annotation_rows.append({
            "schemaVersion": 1,
            "itemId": f"{dataset_id}-{image['id']}",
            "imageReference": str(target_image.relative_to(output_dir)).replace("\\", "/"),
            "imageChecksum": sha256_file(target_image),
            "sourceGroupId": source_group_id(image),
            "sourceDatasetId": dataset_id,
            "provenance": {"sourceId": dataset_id, "sourceType": "SYNTHETIC", "license": "CC-BY-4.0"},
            "licenseEligibility": "PRODUCT_TRAIN_ELIGIBLE",
            "width": width,
            "height": height,
            "annotations": item_annotations,
            "qualityFlags": ["CLEAN_SCAN"],
            "split": split,
            "converterVersion": "deepscoresv2-converter-v1",
            "taxonomyVersion": mapping["targetTaxonomyId"],
        })

    write_json(output_dir / "annotations.json", annotation_rows)
    dataset_yaml = output_dir / "dataset.yaml"
    dataset_yaml.write_text(
        "path: .\n"
        "train: train/images\n"
        "val: validation/images\n"
        "test: test/images\n"
        f"names:\n" + "\n".join(f"  {index}: {name}" for index, name in enumerate(class_ids)) + "\n",
        encoding="utf-8",
    )
    report = {
        "schemaVersion": 1,
        "datasetId": dataset_id,
        "datasetVersion": dataset_version,
        "itemCount": len(annotation_rows),
        "sourceGroupCount": len({row["sourceGroupId"] for row in annotation_rows}),
        "maxItems": max_items,
        "maxSourceGroups": max_source_groups,
        "classIds": class_ids,
        "excludedAnnotations": excluded_count,
        "approximateMappings": approximate_count,
        "splits": {split: sum(1 for row in annotation_rows if row["split"] == split) for split in ["train", "validation", "test"]},
    }
    write_json(output_dir / "conversion-report.json", report)
    return report


def find_annotation_file(source_dir: Path) -> Path:
    candidates = list(source_dir.rglob("*.json"))
    if not candidates:
        raise FileNotFoundError(f"No JSON annotation file found under {source_dir}")
    candidates.sort(key=lambda path: ("instances" not in path.name.lower(), len(str(path))))
    return candidates[0]


def find_image_file(source_dir: Path, name: str) -> Path | None:
    direct = source_dir / name
    if direct.exists():
        return direct
    matches = list(source_dir.rglob(Path(name).name))
    return matches[0] if matches else None


def source_group_id(image: dict[str, Any]) -> str:
    raw = str(image.get("score_id") or image.get("source_id") or image.get("file_name") or image.get("id"))
    return raw.split("_page")[0].split("-page")[0]


def assign_source_group_splits(images: list[dict[str, Any]]) -> dict[str, str]:
    groups = sorted({source_group_id(image) for image in images})
    split_by_group = {}
    for index, group in enumerate(groups):
        if index % 10 == 0:
            split_by_group[group] = "test"
        elif index % 10 == 1:
            split_by_group[group] = "validation"
        else:
            split_by_group[group] = "train"
    return split_by_group


def make_yolo_dirs(output_dir: Path) -> dict[str, dict[str, Path]]:
    result = {}
    for split in ["train", "validation", "test"]:
        result[split] = {
            "images": output_dir / split / "images",
            "labels": output_dir / split / "labels",
        }
        result[split]["images"].mkdir(parents=True, exist_ok=True)
        result[split]["labels"].mkdir(parents=True, exist_ok=True)
    return result
