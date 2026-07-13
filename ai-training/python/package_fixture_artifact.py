from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "ai-training/src"))

from cuenote_ai.artifacts import package_artifact


def main() -> None:
    parser = argparse.ArgumentParser(description="Package an existing small model artifact for installer smoke validation.")
    parser.add_argument("--model", choices=["layout", "symbol"], default="layout")
    parser.add_argument("--output", default="")
    args = parser.parse_args()
    model = args.model
    model_root = REPO_ROOT / "web-app/public/models/omr"
    manifest = model_root / f"{model}-smoke-manifest.json"
    onnx = model_root / f"{model}-smoke.onnx"
    evaluation = REPO_ROOT / f"ai-training/reports/{model}-smoke-evaluation.json"
    config = REPO_ROOT / f"ai-training/artifacts/{model}-smoke/model-spec.json"
    taxonomy = REPO_ROOT / "ai-training/taxonomy/classes.json"
    output = Path(args.output) if args.output else REPO_ROOT / f"ai-training/artifacts/{model}-smoke/{model}-smoke-artifact.zip"
    package_artifact(
        output_zip=output,
        manifest_path=manifest,
        evaluation_path=evaluation,
        taxonomy_path=taxonomy,
        config_path=config,
        onnx_path=onnx,
    )
    print(output)


if __name__ == "__main__":
    main()
