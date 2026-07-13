from __future__ import annotations

import json
import random
import shutil
import tarfile
from collections import Counter
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
                result[normalize_key(key)] = row
    return result


def normalize_key(value: Any) -> str:
    return str(value).strip().lower().replace(" ", "_").replace("-", "_")


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
    allowed_class_ids: list[str] | None = None,
    seed: int = 90210,
) -> dict[str, Any]:
    mapping = load_mapping(mapping_path)
    by_alias = alias_map(mapping)
    allowed_classes = set(allowed_class_ids or [])
    annotation_file = find_annotation_file(source_dir)
    coco = json.loads(annotation_file.read_text(encoding="utf-8"))
    categories = normalize_categories(coco.get("categories", []))
    images = list(coco.get("images", []))
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
    annotations_by_id = normalize_annotations(coco.get("annotations", []))
    annotations_by_image = index_annotations_by_image(annotations_by_id)
    splits = assign_source_group_splits(images)
    annotation_rows: list[dict[str, Any]] = []
    yolo_dirs = make_yolo_dirs(output_dir)
    class_ids: list[str] = []
    excluded_count = 0
    approximate_count = 0
    unmapped_classes: Counter[str] = Counter()
    invalid_bbox_count = 0

    for image in images:
        image_name = image_file_name(image)
        image_path = find_image_file(source_dir, image_name)
        if not image_path:
            continue
        with Image.open(image_path) as img:
            width, height = img.size
        split = splits[source_group_id(image)]
        target_image = yolo_dirs[split]["images"] / Path(image_name).name
        target_image.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(image_path, target_image)
        item_annotations = []
        yolo_lines = []
        for annotation_id, annotation in image_annotations(image, annotations_by_id, annotations_by_image):
            source_name, row = select_mapped_category(annotation, categories, by_alias)
            if not row or row.get("mappingType") == "EXCLUDED" or not row.get("targetClassId"):
                unmapped_classes[source_name] += 1
                excluded_count += 1
                continue
            if row.get("mappingType") == "APPROXIMATE":
                approximate_count += 1
            target_class = row["targetClassId"]
            if allowed_classes and target_class not in allowed_classes:
                excluded_count += 1
                continue
            if target_class not in class_ids:
                class_ids.append(target_class)
            class_index = class_ids.index(target_class)
            bbox = parse_bbox(annotation)
            if not bbox:
                invalid_bbox_count += 1
                continue
            x, y, box_width, box_height = bbox
            item_annotations.append({
                "id": f"{image['id']}-{annotation_id}",
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
        label_path = yolo_dirs[split]["labels"] / f"{Path(image_name).stem}.txt"
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
    dataset_root = output_dir.resolve().as_posix()
    dataset_yaml.write_text(
        f'path: "{dataset_root}"\n'
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
        "allowedClassIds": allowed_class_ids,
        "classIds": class_ids,
        "excludedAnnotations": excluded_count,
        "approximateMappings": approximate_count,
        "invalidBoundingBoxes": invalid_bbox_count,
        "topUnmappedClasses": dict(unmapped_classes.most_common(25)),
        "annotationFile": str(annotation_file.relative_to(source_dir)).replace("\\", "/"),
        "splits": {split: sum(1 for row in annotation_rows if row["split"] == split) for split in ["train", "validation", "test"]},
    }
    write_json(output_dir / "conversion-report.json", report)
    return report


def normalize_categories(raw_categories: Any) -> dict[str, str]:
    if isinstance(raw_categories, dict):
        return {
            str(category_id): category.get("name", str(category_id)) if isinstance(category, dict) else str(category)
            for category_id, category in raw_categories.items()
        }
    return {
        str(category.get("id")): category.get("name", str(category.get("id")))
        for category in raw_categories
        if isinstance(category, dict) and category.get("id") is not None
    }


def normalize_annotations(raw_annotations: Any) -> dict[str, dict[str, Any]]:
    if isinstance(raw_annotations, dict):
        return {
            str(annotation_id): annotation
            for annotation_id, annotation in raw_annotations.items()
            if isinstance(annotation, dict)
        }
    return {
        str(annotation.get("id", index)): annotation
        for index, annotation in enumerate(raw_annotations)
        if isinstance(annotation, dict)
    }


def index_annotations_by_image(annotations_by_id: dict[str, dict[str, Any]]) -> dict[str, list[tuple[str, dict[str, Any]]]]:
    result: dict[str, list[tuple[str, dict[str, Any]]]] = {}
    for annotation_id, annotation in annotations_by_id.items():
        image_id = annotation.get("image_id", annotation.get("img_id"))
        if image_id is not None:
            result.setdefault(str(image_id), []).append((annotation_id, annotation))
    return result


def image_annotations(
    image: dict[str, Any],
    annotations_by_id: dict[str, dict[str, Any]],
    annotations_by_image: dict[str, list[tuple[str, dict[str, Any]]]],
) -> list[tuple[str, dict[str, Any]]]:
    annotation_ids = image.get("ann_ids")
    if annotation_ids:
        result = []
        for annotation_id in annotation_ids:
            annotation = annotations_by_id.get(str(annotation_id))
            if annotation:
                result.append((str(annotation_id), annotation))
        return result
    return annotations_by_image.get(str(image.get("id")), [])


def select_mapped_category(
    annotation: dict[str, Any],
    categories: dict[str, str],
    by_alias: dict[str, dict[str, Any]],
) -> tuple[str, dict[str, Any] | None]:
    category_ids = annotation.get("category_id", annotation.get("cat_id"))
    if category_ids is None:
        return "unknown", None
    if not isinstance(category_ids, list):
        category_ids = [category_ids]
    first_source_name = "unknown"
    for category_id in category_ids:
        source_name = categories.get(str(category_id), str(category_id))
        if first_source_name == "unknown":
            first_source_name = source_name
        row = by_alias.get(normalize_key(source_name)) or by_alias.get(normalize_key(category_id))
        if row and row.get("mappingType") != "EXCLUDED" and row.get("targetClassId"):
            return source_name, row
    return first_source_name, None


def parse_bbox(annotation: dict[str, Any]) -> tuple[float, float, float, float] | None:
    if "bbox" in annotation:
        values = annotation["bbox"]
        if len(values) != 4:
            return None
        x, y, width, height = [float(value) for value in values]
    elif "a_bbox" in annotation:
        values = annotation["a_bbox"]
        if len(values) != 4:
            return None
        x1, y1, x2, y2 = [float(value) for value in values]
        x, y, width, height = x1, y1, x2 - x1, y2 - y1
    elif "o_bbox" in annotation:
        values = annotation["o_bbox"]
        if len(values) != 4:
            return None
        x1, y1, x2, y2 = [float(value) for value in values]
        x, y, width, height = x1, y1, x2 - x1, y2 - y1
    else:
        return None
    if width <= 0 or height <= 0:
        return None
    return x, y, width, height


def find_annotation_file(source_dir: Path) -> Path:
    candidates = list(source_dir.rglob("*.json"))
    if not candidates:
        raise FileNotFoundError(f"No JSON annotation file found under {source_dir}")
    candidates.sort(key=annotation_file_priority)
    return candidates[0]


def annotation_file_priority(path: Path) -> tuple[int, int]:
    name = path.name.lower()
    if "train" in name:
        return (0, len(str(path)))
    if "instances" in name:
        return (1, len(str(path)))
    if "test" in name:
        return (2, len(str(path)))
    return (3, len(str(path)))


def find_image_file(source_dir: Path, name: str) -> Path | None:
    direct = source_dir / name
    if direct.exists():
        return direct
    matches = list(source_dir.rglob(Path(name).name))
    return matches[0] if matches else None


def image_file_name(image: dict[str, Any]) -> str:
    name = image.get("file_name") or image.get("filename") or image.get("path")
    if not name:
        raise ValueError(f"Image record has no filename field: {image}")
    return str(name)


def source_group_id(image: dict[str, Any]) -> str:
    raw = str(image.get("score_id") or image.get("source_id") or image.get("file_name") or image.get("filename") or image.get("id"))
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
