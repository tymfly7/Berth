"""
History Store — timestamped snapshots of evaluation & training runs
===================================================================
Evaluate-All overwrites model_comparison.json and training overwrites
history_<model>.json, so past runs were lost. This module additionally archives
each run to a timestamped JSON so operators can browse results by date/time.

Layout (under config.OUTPUT_DIR):
    eval_history/<dataset>__<YYYYMMDDTHHMMSS>.json   {dataset, timestamp, results}
    train_history/<model>__<YYYYMMDDTHHMMSS>.json    {model,   timestamp, history}

Snapshots are small JSON, so retention is "keep all" by default. Set
MAX_SNAPSHOTS to an int to cap the number kept per dataset/model.
"""

import json
import logging
import re
from datetime import datetime
from pathlib import Path

import config

logger = logging.getLogger("berth.history")

EVAL_HISTORY_DIR  = config.OUTPUT_DIR / "eval_history"
TRAIN_HISTORY_DIR = config.OUTPUT_DIR / "train_history"

# Per-dataset / per-model cap, sourced from config so operators can cap
# retention via BERTH_HISTORY_MAX without code changes. 0 = keep everything.
MAX_SNAPSHOTS = config.HISTORY_MAX_SNAPSHOTS or None

_SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+\.json$")


def _slug(s: str) -> str:
    """Filename-safe slug so ids with odd characters can't escape the dir."""
    return re.sub(r"[^A-Za-z0-9_-]+", "-", str(s)).strip("-") or "unknown"


def _save(dir_path: Path, prefix: str, payload: dict) -> str:
    dir_path.mkdir(parents=True, exist_ok=True)
    fname = f"{prefix}__{datetime.now().strftime('%Y%m%dT%H%M%S')}.json"
    (dir_path / fname).write_text(json.dumps(payload, indent=2), encoding="utf-8")
    _prune(dir_path, prefix)
    return fname


def _prune(dir_path: Path, prefix: str) -> None:
    if not MAX_SNAPSHOTS:
        return
    files = sorted(dir_path.glob(f"{prefix}__*.json"))
    for old in files[:-MAX_SNAPSHOTS]:
        try:
            old.unlink()
        except OSError:
            pass


def _list(dir_path: Path, prefix: str, meta_key: str) -> list[dict]:
    """List snapshots for one prefix, newest first, with lightweight metadata."""
    if not dir_path.is_dir():
        return []
    out = []
    for p in dir_path.glob(f"{prefix}__*.json"):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        payload = d.get(meta_key)
        n = len(payload) if isinstance(payload, (list, dict)) else 0
        out.append({"file": p.name, "timestamp": d.get("timestamp"), "count": n})
    out.sort(key=lambda x: x["timestamp"] or "", reverse=True)
    return out


def _load(dir_path: Path, fname: str) -> dict | None:
    if not _SAFE_NAME.match(fname or ""):
        return None
    p = (dir_path / fname).resolve()
    if dir_path.resolve() not in p.parents or not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


# ── Evaluation snapshots ─────────────────────────────────────────────────────
def save_eval_snapshot(dataset_id: str, results: list) -> str | None:
    try:
        return _save(EVAL_HISTORY_DIR, _slug(dataset_id),
                     {"dataset": dataset_id,
                      "timestamp": datetime.now().isoformat(timespec="seconds"),
                      "results": results})
    except OSError as e:
        logger.warning(f"Could not archive eval snapshot for '{dataset_id}': {e}")
        return None


def list_eval_snapshots(dataset_id: str) -> list[dict]:
    return _list(EVAL_HISTORY_DIR, _slug(dataset_id), "results")


def load_eval_snapshot(fname: str) -> dict | None:
    return _load(EVAL_HISTORY_DIR, fname)


# ── Training snapshots ───────────────────────────────────────────────────────
def save_train_snapshot(model_name: str, history: dict) -> str | None:
    try:
        return _save(TRAIN_HISTORY_DIR, _slug(model_name),
                     {"model": model_name,
                      "timestamp": datetime.now().isoformat(timespec="seconds"),
                      "history": history})
    except OSError as e:
        logger.warning(f"Could not archive training snapshot for '{model_name}': {e}")
        return None


def list_train_snapshots(model_name: str) -> list[dict]:
    return _list(TRAIN_HISTORY_DIR, _slug(model_name), "history")


def load_train_snapshot(fname: str) -> dict | None:
    return _load(TRAIN_HISTORY_DIR, fname)
