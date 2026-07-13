from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "ai-training/src"))

from cuenote_ai.colab_pipeline import prepare_dataset, prepare_environment, train_symbol_overfit, train_symbol_tile_overfit, train_task


def main() -> None:
    parser = argparse.ArgumentParser(description="CueNote Phase 9E-H Colab pipeline")
    parser.add_argument("--run-mode", default=os.environ.get("CUENOTE_RUN_MODE", "SMOKE"), choices=["SMOKE", "LAYOUT_TRAIN", "SYMBOL_TRAIN", "SYMBOL_OVERFIT", "SYMBOL_TILE_OVERFIT", "FULL_PIPELINE"])
    parser.add_argument("--drive-root", default=os.environ.get("CUENOTE_DRIVE_ROOT", "/content/drive/MyDrive/CueNote"))
    args = parser.parse_args()
    drive_root = Path(args.drive_root)
    prepare_environment(REPO_ROOT, drive_root, args.run_mode)
    if args.run_mode == "SMOKE":
        prepare_dataset(REPO_ROOT, drive_root, args.run_mode)
        print("SMOKE dataset preparation completed. Full training is intentionally not run in SMOKE mode.")
    elif args.run_mode == "LAYOUT_TRAIN":
        train_task(REPO_ROOT, drive_root, "LAYOUT_DETECTION", args.run_mode)
    elif args.run_mode == "SYMBOL_TRAIN":
        train_task(REPO_ROOT, drive_root, "SYMBOL_DETECTION", args.run_mode)
    elif args.run_mode == "SYMBOL_OVERFIT":
        train_symbol_overfit(REPO_ROOT, drive_root, args.run_mode)
    elif args.run_mode == "SYMBOL_TILE_OVERFIT":
        train_symbol_tile_overfit(REPO_ROOT, drive_root, args.run_mode)
    elif args.run_mode == "FULL_PIPELINE":
        train_task(REPO_ROOT, drive_root, "LAYOUT_DETECTION", args.run_mode)
        train_task(REPO_ROOT, drive_root, "SYMBOL_DETECTION", args.run_mode)


if __name__ == "__main__":
    main()
