from __future__ import annotations

import os
import shutil
import urllib.request
from pathlib import Path

from .common import md5_file


def ensure_space(target_dir: Path, required_bytes: int) -> None:
    usage = shutil.disk_usage(target_dir)
    if usage.free < required_bytes:
        raise RuntimeError(f"Not enough free disk space in {target_dir}: need {required_bytes}, have {usage.free}")


def download_with_resume(url: str, target: Path, *, expected_md5: str = "", min_free_bytes: int = 0) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    if min_free_bytes:
        ensure_space(target.parent, min_free_bytes)
    partial = target.with_suffix(target.suffix + ".part")
    if target.exists() and expected_md5 and md5_file(target) == expected_md5:
        return target
    headers = {}
    mode = "wb"
    if partial.exists():
        offset = partial.stat().st_size
        if offset > 0:
            headers["Range"] = f"bytes={offset}-"
            mode = "ab"
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request) as response, partial.open(mode + "") as handle:
            shutil.copyfileobj(response, handle)
    except KeyboardInterrupt:
        raise
    except Exception as error:
        raise RuntimeError(f"Dataset download failed. If this URL requires manual terms acceptance, download it yourself and place it at {target}") from error
    partial.replace(target)
    if expected_md5:
        actual = md5_file(target)
        if actual != expected_md5:
            target.unlink(missing_ok=True)
            raise RuntimeError(f"Archive checksum mismatch for {target}: expected {expected_md5}, got {actual}")
    return target


def manual_placement_message(target: Path) -> str:
    return f"Place the manually downloaded archive at {target} in Colab /content scratch storage and rerun the notebook."
