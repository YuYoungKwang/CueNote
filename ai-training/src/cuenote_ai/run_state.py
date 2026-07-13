from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import atomic_write_json, read_json, utc_now


DEFAULT_STATE = {
    "runId": "",
    "gitCommit": "",
    "datasetVersion": "",
    "layoutTrainingStatus": "NOT_STARTED",
    "layoutEvaluationStatus": "NOT_STARTED",
    "layoutOnnxStatus": "NOT_STARTED",
    "symbolTrainingStatus": "NOT_STARTED",
    "symbolEvaluationStatus": "NOT_STARTED",
    "symbolOnnxStatus": "NOT_STARTED",
    "lastUpdatedAt": "",
    "errors": [],
}


def load_run_state(path: str | Path) -> dict[str, Any]:
    target = Path(path)
    if not target.exists():
        state = dict(DEFAULT_STATE)
        state["lastUpdatedAt"] = utc_now()
        return state
    return read_json(target)


def update_run_state(path: str | Path, **updates: Any) -> dict[str, Any]:
    state = load_run_state(path)
    state.update(updates)
    state["lastUpdatedAt"] = utc_now()
    atomic_write_json(path, state)
    return state


def mark_error(path: str | Path, stage: str, error: Exception | str) -> dict[str, Any]:
    state = load_run_state(path)
    state.setdefault("errors", []).append({"stage": stage, "message": str(error), "at": utc_now()})
    state["lastUpdatedAt"] = utc_now()
    atomic_write_json(path, state)
    return state
