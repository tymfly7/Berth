"""Runtime model endpoints: active-model info and switching.

These are needed by both the server and edge profiles (the dashboard reads
/api/model/info and switches the live model), so they live in the base router
mounted on main.app — unlike the hub-only training/eval/export routes in
dev/routers/training.py.
"""

import json
import logging
import os
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

import config
from src.api.deps import verify_api_key
from src.api.processor_service import processor_service
from src.cameras.camera_registry import camera_registry

logger = logging.getLogger("berth.models")
router = APIRouter()

# ── model_info cache (invalidated on training/export by the dev router) ─
_model_info_cache: dict = {"data": None, "ts": 0.0}
_MODEL_INFO_TTL = 60.0  # seconds


def invalidate_model_info_cache() -> None:
    """Drop the cached model_info so the next request rebuilds it. Called by the
    dev training/export routes when trained weights or NCNN exports change."""
    _model_info_cache["data"] = None


# ── Model switching ──────────────────────────────────────
@router.post("/api/use-model/{model_name}", dependencies=[Depends(verify_api_key)])
def use_model(model_name: str):
    if model_name not in config.SUPPORTED_MODELS:
        raise HTTPException(400, f"Invalid model. Choose from: {list(config.SUPPORTED_MODELS)}")
    processor_service.clear_classifier_cache()
    processor_service.active_mode = model_name
    # Restart all active live cameras with the new model so they pick it up immediately.
    restarted = 0
    for cam in camera_registry.get_all():
        if cam.get("active"):
            camera_registry.activate(cam["id"], model_name=model_name)
            restarted += 1
    return {"message": f"Switched to {model_name}", "cameras_restarted": restarted}


def _count_images(path: Path) -> int:
    """Count image files in a flat directory via os.scandir. Faster than
    Path.glob('*.*') on the large dataset dirs — no per-entry fnmatch or Path
    allocation — which matters because model switching re-runs this on each
    model_info cache miss."""
    if not path.exists():
        return 0
    exts = (".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp")
    count = 0
    with os.scandir(path) as it:
        for entry in it:
            if entry.is_file() and entry.name.lower().endswith(exts):
                count += 1
    return count


@router.get("/api/model/info", dependencies=[Depends(verify_api_key)])
def model_info():
    now = time.monotonic()
    # Return cached result if still fresh; active_model can change so check it too.
    cached = _model_info_cache["data"]
    if cached and (now - _model_info_cache["ts"]) < _MODEL_INFO_TTL and cached.get("active_model") == processor_service.active_mode:
        return cached

    is_edge = config.DEPLOYMENT_PROFILE == "edge"

    if is_edge:
        def _ncnn_ready(path: Path) -> bool:
            return (path / "model.ncnn.param").exists()
        available_models = {
            "cnn_scratch":      _ncnn_ready(config.EDGE_MODEL_DIR / "edge_cnn_scratch_ncnn_model"),
            "resnet18":         _ncnn_ready(config.EDGE_MODEL_DIR / "edge_resnet18_ncnn_model"),
            "resnet50":         _ncnn_ready(config.EDGE_MODEL_DIR / "edge_resnet50_ncnn_model"),
            "mobilenetv4s":     _ncnn_ready(config.EDGE_MODEL_DIR / "edge_mobilenetv4s_ncnn_model"),
            "mobilenetv4m":     _ncnn_ready(config.EDGE_MODEL_DIR / "edge_mobilenetv4m_ncnn_model"),
            "yolo26n_classify": _ncnn_ready(config.YOLO26_CLASSIFY_NCNN_PATHS["n"]),
            "yolo26s_classify": _ncnn_ready(config.YOLO26_CLASSIFY_NCNN_PATHS["s"]),
            "yolo26m_classify": _ncnn_ready(config.YOLO26_CLASSIFY_NCNN_PATHS["m"]),
        }
        dataset_ready = False
        dataset_count = occupied_count = vacant_count = 0
        # Training-history details are a hub-only concern (no history JSON on edge).
        model_details: dict = {}
    else:
        split_dir = config.CLASSIFY_SPLIT_DIR
        occupied_count = sum(_count_images(split_dir / s / "occupied") for s in ("train", "val", "test"))
        vacant_count   = sum(_count_images(split_dir / s / "vacant")   for s in ("train", "val", "test"))
        dataset_count  = occupied_count + vacant_count
        dataset_ready  = dataset_count > 0
        available_models = {
            "cnn_scratch":      config.CNN_SCRATCH_PATH.exists(),
            "resnet18":         config.RESNET18_PATH.exists(),
            "resnet50":         config.RESNET50_PATH.exists(),
            "mobilenetv4s":     config.MOBILENETV4S_PATH.exists(),
            "mobilenetv4m":     config.MOBILENETV4M_PATH.exists(),
            "yolo26n_classify": config.YOLO26N_CLASSIFY_PATH.exists(),
            "yolo26s_classify": config.YOLO26S_CLASSIFY_PATH.exists(),
            "yolo26m_classify": config.YOLO26M_CLASSIFY_PATH.exists(),
        }
        # Reporting helper lives in the dev tree; only imported on the server profile.
        from dev.reports.model_report import load_model_training_details
        model_details = load_model_training_details()

    comparison_path = config.OUTPUT_DIR / "model_comparison.json"
    comparison = None
    if comparison_path.exists():
        with open(comparison_path) as f:
            comparison = json.load(f)

    result = {
        "active_model":       processor_service.active_mode,
        "deployment_profile": config.DEPLOYMENT_PROFILE,
        "available_models":   available_models,
        "dataset_ready":      dataset_ready,
        "dataset_count":      dataset_count,
        "occupied_count":     occupied_count,
        "vacant_count":       vacant_count,
        "comparison":         comparison,
        "model_details":      model_details,
    }
    _model_info_cache["data"] = result
    _model_info_cache["ts"] = now
    return result
