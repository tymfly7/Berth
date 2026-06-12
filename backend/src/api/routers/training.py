"""Model management, training, evaluation, and dataset endpoints."""

import json
import logging
import os
import threading
import time
import uuid
from pathlib import Path
from typing import List

from fastapi import (
    APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile,
)

import config
from src.api.deps import limiter, verify_api_key
from src.api.operations import finish_op, register_op, update_op_progress
from src.api.processor_service import processor_service
from src.cameras.camera_registry import camera_registry
from src.reports.model_report import build_comparison_excel, load_model_training_details

logger = logging.getLogger("berth.training")
router = APIRouter()

# ── model_info cache (invalidated on training start / dataset upload) ─
_model_info_cache: dict = {"data": None, "ts": 0.0}
_MODEL_INFO_TTL = 60.0  # seconds


# ── Model switching ──────────────────────────────────────
@router.post("/api/use-model/{model_name}", dependencies=[Depends(verify_api_key)])
def use_model(model_name: str):
    if model_name not in config.SUPPORTED_MODELS:
        raise HTTPException(400, f"Invalid model. Choose from: {list(config.SUPPORTED_MODELS)}")
    processor_service.reset_processor()
    processor_service.active_mode = model_name
    proc = processor_service.get_processor()
    proc.start_processing()
    # Restart all active live cameras with the new model so they pick it up immediately.
    restarted = 0
    for cam in camera_registry.get_all():
        if cam.get("active"):
            camera_registry.activate(cam["id"], model_name=model_name)
            restarted += 1
    return {"message": f"Switched to {model_name}", "cameras_restarted": restarted}


@router.post("/api/test-model/{model_name}", dependencies=[Depends(verify_api_key)])
def test_model(model_name: str):
    if model_name in ("yolo26", "yolo26_detect"):
        raise HTTPException(400, "YOLO26 detect uses a detection interface — per-patch accuracy testing is not supported.")
    if model_name not in config.TESTABLE_MODELS:
        raise HTTPException(400, f"Unknown model '{model_name}'. Testable: {list(config.TESTABLE_MODELS)}")
    try:
        import torch
        from src.models.model_factory import load_model
        from src.data_prep.preprocessor import prepare_dataset
        from src.eval.evaluator import evaluate_model
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model = load_model(model_name, device=device)
        data = prepare_dataset()
        test_loader = data["test_loader"]
        metrics = evaluate_model(model, test_loader, device=device)
        return {"model": model_name, **metrics}
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"Test failed: {e}")


@router.post("/api/evaluate/all", dependencies=[Depends(verify_api_key)])
def evaluate_all():
    if config.DEPLOYMENT_PROFILE == "edge":
        raise HTTPException(403, "Evaluation is not available on edge nodes. Use the hub server.")
    from src.train.train_manager import TrainManager
    result = TrainManager().start_evaluation()
    if result.get("status") == "error":
        raise HTTPException(400, result["message"])

    def _monitor():
        from src.train.train_manager import TrainManager as TM
        deadline = time.time() + 6 * 3600  # safety cap so a stuck status can't leak the thread
        while time.time() < deadline:
            time.sleep(2)
            try:
                s = TM().get_status()
                if s.get("status") in ("done", "error", "idle"):
                    _model_info_cache["data"] = None
                    break
            except Exception:
                break

    threading.Thread(target=_monitor, daemon=True).start()
    return result


@router.get("/api/evaluate/excel", dependencies=[Depends(verify_api_key)])
def download_evaluation_excel():
    comparison_path = config.OUTPUT_DIR / "model_comparison.json"
    if not comparison_path.exists():
        raise HTTPException(404, "No evaluation results found. Run 'Evaluate All' first.")
    with open(comparison_path) as f:
        comparison = json.load(f)
    xlsx_bytes = build_comparison_excel(comparison)
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=model_comparison.xlsx"},
    )


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

    data_dir = config.DATA_DIR
    occ_dir = data_dir / "occupied"
    vac_dir = data_dir / "vacant"
    dataset_ready = occ_dir.exists() and vac_dir.exists()
    occupied_count = _count_images(occ_dir)
    vacant_count = _count_images(vac_dir)
    dataset_count = occupied_count + vacant_count

    comparison_path = config.OUTPUT_DIR / "model_comparison.json"
    comparison = None
    if comparison_path.exists():
        with open(comparison_path) as f:
            comparison = json.load(f)

    result = {
        "active_model": processor_service.active_mode,
        "available_models": {
            "cnn_scratch":     config.CNN_SCRATCH_PATH.exists(),
            "resnet50":        config.RESNET50_PATH.exists(),
            "mobilenetv4s":     config.MOBILENETV4_PATH.exists(),
            "yolo26_classify": config.YOLO26_CLASSIFY_PATH.exists(),
            "yolo26":          config.YOLO26_DETECT_PATH.exists(),
        },
        "dataset_ready": dataset_ready,
        "dataset_count": dataset_count,
        "occupied_count": occupied_count,
        "vacant_count": vacant_count,
        "comparison": comparison,
        "model_details": load_model_training_details(),
    }
    _model_info_cache["data"] = result
    _model_info_cache["ts"] = now
    return result


# ── Training ─────────────────────────────────────────────
@router.post("/api/train/start", dependencies=[Depends(verify_api_key)])
@limiter.limit("20/hour")
def start_training(request: Request, model_name: str = "cnn_scratch",
                   compare_all: bool = False):
    if config.DEPLOYMENT_PROFILE == "edge":
        raise HTTPException(403, "Training is not available on edge nodes. Use the hub server.")
    if model_name not in config.TRAINABLE_MODELS:
        raise HTTPException(400, f"Unknown model '{model_name}'. Choose from: {list(config.TRAINABLE_MODELS)}")
    from src.train.train_manager import TrainManager
    mgr = TrainManager()
    if mgr.is_training():
        raise HTTPException(409, "Training already in progress")
    # YOLO detect uses the gopro annotated dataset, not the occupied/vacant folders
    if model_name not in ("yolo26_classify", "yolo26_detect"):
        occ = config.DATA_DIR / "occupied"
        vac = config.DATA_DIR / "vacant"
        if not occ.exists() or not vac.exists():
            raise HTTPException(400, "Dataset not found. Prepare it first.")
    if model_name == "yolo26_detect" and not config.YOLO_GOPRO_DIR.exists():
        raise HTTPException(400, "Gopro annotated dataset not found. Expected: backend/data/yolo_data/parking_rois_gopro/")
    _model_info_cache["data"] = None  # invalidate so next poll reflects new state
    result = mgr.start_training(model_name, compare_all=compare_all)
    op_id = register_op("training", f"Training {model_name}…")

    def _monitor():
        from src.train.train_manager import TrainManager as TM
        deadline = time.time() + 6 * 3600  # safety cap so a stuck status can't leak the thread/op
        while time.time() < deadline:
            time.sleep(2)
            try:
                s = TM().get_status()
                epoch = s.get("epoch") or 0
                total = s.get("total_epochs") or 0
                update_op_progress(op_id, epoch / total if total > 0 else 0)
                if s.get("status") in ("done", "error", "idle"):
                    _model_info_cache["data"] = None
                    break
            except Exception:
                break
        finish_op(op_id)

    threading.Thread(target=_monitor, daemon=True).start()
    return result


@router.get("/api/train/status", dependencies=[Depends(verify_api_key)])
def train_status():
    from src.train.train_manager import TrainManager
    return TrainManager().get_status()


@router.post("/api/dataset/upload", dependencies=[Depends(verify_api_key)])
@limiter.limit(config.UPLOAD_RATE_LIMIT)
async def upload_dataset_images(
    request: Request,
    files: List[UploadFile] = File(...),
    label: str = Form(...),
):
    if config.DEPLOYMENT_PROFILE == "edge":
        raise HTTPException(403, "Dataset upload is not available on edge nodes. Use the hub server.")
    op_id = register_op("dataset_upload", "Saving training images…")
    try:
        if label not in ("occupied", "vacant"):
            raise HTTPException(400, "label must be 'occupied' or 'vacant'")
        if len(files) > 50:
            raise HTTPException(400, "Maximum 50 files per request")

        allowed = {".jpg", ".jpeg", ".png", ".bmp"}
        dest_dir = config.DATA_DIR / label
        dest_dir.mkdir(parents=True, exist_ok=True)

        max_image_bytes = 20 * 1024 * 1024  # 20 MB per image
        saved = 0
        skipped = 0
        for file in files:
            safe_name = Path(file.filename).name  # strip any directory components
            ext = Path(safe_name).suffix.lower()
            if ext not in allowed:
                skipped += 1
                continue
            content = await file.read()
            if len(content) > max_image_bytes:
                skipped += 1
                continue
            dest = dest_dir / safe_name
            if dest.exists():
                stem = Path(safe_name).stem
                suffix_str = uuid.uuid4().hex[:6]
                dest = dest_dir / f"{stem}_{suffix_str}{ext}"
            with open(dest, "wb") as f:
                f.write(content)
            saved += 1

        _model_info_cache["data"] = None  # dataset count changed
        return {"saved": saved, "skipped": skipped, "label": label}
    finally:
        finish_op(op_id)


@router.post("/api/dataset/upload-yolo", dependencies=[Depends(verify_api_key)])
@limiter.limit(config.UPLOAD_RATE_LIMIT)
async def upload_yolo_dataset(
    request: Request,
    images: List[UploadFile] = File(...),
    annotations: UploadFile = File(...),
):
    """
    Upload a YOLO detect dataset to data/yolo_data/parking_rois_gopro/.
    - images: full-scene parking lot images (jpg/png)
    - annotations: annotations.json with train/valid/test splits
    """
    if config.DEPLOYMENT_PROFILE == "edge":
        raise HTTPException(403, "Dataset upload is not available on edge nodes.")
    op_id = register_op("yolo_upload", "Saving YOLO dataset…")
    try:
        gopro_dir = config.YOLO_GOPRO_DIR
        img_dir = gopro_dir / "images"
        img_dir.mkdir(parents=True, exist_ok=True)

        # Validate and save annotations.json
        if Path(annotations.filename).suffix.lower() != ".json":
            raise HTTPException(400, "annotations file must be a .json file")
        ann_content = await annotations.read()
        if len(ann_content) > 50 * 1024 * 1024:
            raise HTTPException(400, "annotations.json exceeds 50 MB limit")
        import json as _json
        try:
            parsed = _json.loads(ann_content)
        except Exception:
            raise HTTPException(400, "annotations file is not valid JSON")
        for split in ("train", "valid", "test"):
            if split not in parsed:
                raise HTTPException(400, f"annotations.json missing required split: '{split}'")
        (gopro_dir / "annotations.json").write_bytes(ann_content)

        # Save images
        allowed = {".jpg", ".jpeg", ".png", ".bmp"}
        max_image_bytes = 20 * 1024 * 1024
        saved = 0
        skipped = 0
        for file in images:
            safe_name = Path(file.filename).name
            ext = Path(safe_name).suffix.lower()
            if ext not in allowed:
                skipped += 1
                continue
            content = await file.read()
            if len(content) > max_image_bytes:
                skipped += 1
                continue
            dest = img_dir / safe_name
            if dest.exists():
                stem = Path(safe_name).stem
                dest = img_dir / f"{stem}_{uuid.uuid4().hex[:6]}{ext}"
            with open(dest, "wb") as fh:
                fh.write(content)
            saved += 1

        _model_info_cache["data"] = None
        return {"saved_images": saved, "skipped": skipped, "annotations": "saved"}
    finally:
        finish_op(op_id)


@router.get("/api/dataset/browse", dependencies=[Depends(verify_api_key)])
def browse_dataset():
    data_dir = config.DATA_DIR
    folders = []

    def _count(path):
        if not path.exists():
            return None
        exts = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp"}
        return sum(1 for f in path.iterdir() if f.is_file() and f.suffix.lower() in exts)

    for name in ("occupied", "vacant"):
        p = data_dir / name
        folders.append({"name": name, "count": _count(p), "exists": p.exists()})

    gopro = config.YOLO_GOPRO_DIR
    folders.append({"name": "yolo_data/parking_rois_gopro", "count": _count(gopro), "exists": gopro.exists()})

    yolo_ds = config.YOLO_DATASET_DIR
    if yolo_ds.exists():
        splits = {}
        for split in ("train", "val", "test"):
            img_dir = yolo_ds / "images" / split
            splits[split] = _count(img_dir)
        folders.append({"name": "yolo_detect_dataset", "count": sum(v for v in splits.values() if v), "exists": True, "splits": splits})
    else:
        folders.append({"name": "yolo_detect_dataset", "count": None, "exists": False})

    return {"folders": folders}


@router.post("/api/dataset/prepare", dependencies=[Depends(verify_api_key)])
def prepare_dataset(source: str = None, max_per_class: int = 0,
                    generate_sample: bool = False, sample_count: int = 200):
    from src.data_prep.downloader import organize_pklot, generate_sample_dataset
    if generate_sample:
        generate_sample_dataset(num_per_class=sample_count)
        return {"message": f"Generated {sample_count} synthetic images per class"}
    result = organize_pklot(source_root=source, max_per_class=max_per_class)
    return {"message": "Dataset prepared", **result}
