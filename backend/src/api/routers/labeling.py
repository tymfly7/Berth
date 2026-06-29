"""ROI-driven batch auto-labeling — crop every ROI across a date-foldered image
directory, pre-label occupied/vacant with the active classifier, and emit both
classifier training crops (occupied/ vacant/ folders) and a manifest that can be
exported to a YOLO detector dataset.

Reuses the exact crop+classify path from analyze-roi (inference.py), the ROI store,
the operation-progress registry, and the existing yolo_converter — no new crop,
classify, or detector-conversion code.
"""

import base64
import json
import logging
import random
import re
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

import config
from src.api.deps import verify_api_key
from src.api.operations import finish_op, register_op, update_op_progress
from src.api.processor_service import processor_service
from src.data_prep.yolo_converter import build_yolo_detect_dataset
from src.roi.roi_store import RoiStore

logger = logging.getLogger("berth.labeling")
router = APIRouter()

BUCKETS = ("occupied", "vacant", "review", "too_dark")
_SAFE_ID = re.compile(r"^[a-zA-Z0-9_\-]{1,64}$")
_IMG_EXTS = ("*.jpg", "*.jpeg", "*.png")

# Guard against concurrent runs / manifest writes for the same lot.
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()
_running: set[str] = set()


def _lock_for(lot_id: str) -> threading.Lock:
    with _locks_guard:
        lk = _locks.get(lot_id)
        if lk is None:
            lk = threading.Lock()
            _locks[lot_id] = lk
        return lk


def _validate_lot(lot_id: str) -> None:
    if not _SAFE_ID.match(lot_id):
        raise HTTPException(400, "Invalid lot_id (letters, digits, '-' and '_' only)")


def _safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_")


def _out_root(lot_id: str) -> Path:
    return config.DATA_DIR / "labeled" / lot_id


def _manifest_path(lot_id: str) -> Path:
    return _out_root(lot_id) / "manifest.json"


def _load_manifest(lot_id: str) -> dict:
    p = _manifest_path(lot_id)
    if not p.exists():
        raise HTTPException(404, "No labeling run found for this lot. Run a batch first.")
    with open(p) as f:
        return json.load(f)


def _save_manifest(lot_id: str, manifest: dict) -> None:
    manifest["counts"] = {b: sum(1 for c in manifest["crops"] if c["bucket"] == b) for b in BUCKETS}
    with open(_manifest_path(lot_id), "w") as f:
        json.dump(manifest, f)


def _quad_bbox(polygon: list) -> tuple[float, float, float, float]:
    """Normalized (cx, cy, w, h) from a polygon's axis-aligned bounding box."""
    xs = [p[0] for p in polygon]
    ys = [p[1] for p in polygon]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    return (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0


def _roi_mask(frame: np.ndarray, polys: list) -> np.ndarray:
    h, w = frame.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    for poly in polys:
        pts = np.array([[int(p[0] * w), int(p[1] * h)] for p in poly], np.int32)
        cv2.fillPoly(mask, [pts], 255)
    return mask


def _resolve_base(lot_id: str, image_dir: str) -> Path:
    """Image source root: an explicit absolute folder if given, else data/<lot_id>."""
    if image_dir:
        base = Path(image_dir)
        if not base.is_dir():
            raise HTTPException(404, f"Image folder not found: {image_dir}")
        return base
    base = config.DATA_DIR / lot_id
    if not base.exists():
        raise HTTPException(404, f"Image directory not found: data/{lot_id}/")
    return base


def _list_images(base: Path, date_glob: str) -> list[Path]:
    """Images directly in the folder plus any in date-glob subfolders — covers both
    a flat folder the user picked and the date-foldered data/<lot>/<YYYY-MM-DD>/ layout."""
    imgs: list[Path] = []
    for ext in _IMG_EXTS:
        imgs.extend(sorted(base.glob(ext)))
    for d in sorted(base.glob(date_glob)):
        if d.is_dir():
            for ext in _IMG_EXTS:
                imgs.extend(sorted(d.glob(ext)))
    return imgs


# ── Batch labeling ───────────────────────────────────────
def _run_batch(lot_id: str, base: Path, rois: list, polys: list, model_name: str,
               conf_threshold: float, brightness_threshold: float,
               date_glob: str, op_id: str) -> None:
    """Worker thread: crop + classify every ROI across the matching images."""
    try:
        root = _out_root(lot_id)
        crops_dir = root / "crops"
        if crops_dir.exists():
            shutil.rmtree(crops_dir)
        for b in BUCKETS:
            (crops_dir / b).mkdir(parents=True, exist_ok=True)

        clf = processor_service.get_classifier(model_name)
        images = _list_images(base, date_glob)
        records: list[dict] = []

        for i, img_path in enumerate(images):
            frame = cv2.imread(str(img_path))
            if frame is None:
                continue
            h, w = frame.shape[:2]
            rel = img_path.relative_to(base).as_posix()

            # Brightness gate measured over the ROI area only.
            mask = _roi_mask(frame, polys)
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            vals = gray[mask > 0]
            brightness = float(vals.mean()) if vals.size else 0.0
            too_dark = brightness < brightness_threshold

            # Collect crops (same bbox crop as analyze-roi).
            valid = []
            for roi in rois:
                polygon = roi.get("polygon", [])
                if len(polygon) < 3:
                    continue
                xs = [max(0, min(w - 1, int(p[0] * w))) for p in polygon]
                ys = [max(0, min(h - 1, int(p[1] * h))) for p in polygon]
                x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
                if x2 <= x1 or y2 <= y1:
                    continue
                valid.append({"roi": roi, "polygon": polygon,
                              "crop": frame[y1:y2, x1:x2]})

            preds = ([{"status": None, "confidence": None}] * len(valid) if too_dark
                     else (clf.predict_batch([v["crop"] for v in valid]) if valid else []))

            for idx, (v, pred) in enumerate(zip(valid, preds)):
                roi = v["roi"]
                status = pred.get("status")
                conf = pred.get("confidence")
                if too_dark:
                    bucket = "too_dark"
                elif conf is not None and conf >= conf_threshold and status in ("occupied", "vacant"):
                    bucket = status
                else:
                    bucket = "review"

                crop_id = f"{_safe(rel)}__roi{idx:02d}"
                rel_crop = f"crops/{bucket}/{crop_id}.jpg"
                cv2.imwrite(str(root / rel_crop), v["crop"])
                cx, cy, bw, bh = _quad_bbox(v["polygon"])
                records.append({
                    "crop_id": crop_id,
                    "source_image": rel,
                    "roi_id": roi.get("id"),
                    "roi_label": roi.get("label", "Slot"),
                    "polygon": v["polygon"],
                    "bbox": [round(cx, 6), round(cy, 6), round(bw, 6), round(bh, 6)],
                    "status": status,
                    "confidence": round(conf, 4) if conf is not None else None,
                    "bucket": bucket,
                    "crop_path": rel_crop,
                    "image_brightness": round(brightness, 1),
                })

            update_op_progress(op_id, (i + 1) / len(images) if images else 1.0)

        manifest = {
            "lot_id": lot_id,
            "image_dir": str(base),
            "model_name": model_name,
            "conf_threshold": conf_threshold,
            "brightness_threshold": brightness_threshold,
            "date_glob": date_glob,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "crops": records,
        }
        _save_manifest(lot_id, manifest)
        logger.info(f"Labeling done for '{lot_id}': {len(records)} crops from {len(images)} images")
    except Exception:
        logger.exception(f"Labeling batch failed for '{lot_id}'")
    finally:
        _running.discard(lot_id)
        finish_op(op_id)


@router.post("/api/label-batch/{lot_id}", dependencies=[Depends(verify_api_key)])
def label_batch(
    lot_id: str,
    model_name: str = "mobilenetv4s",
    conf_threshold: float = 0.7,
    brightness_threshold: float = 50.0,
    date_glob: str = "2026-*",
    image_dir: str = "",
):
    _validate_lot(lot_id)
    if model_name not in config.CLASSIFY_MODELS:
        raise HTTPException(400, f"model_name must be one of {config.CLASSIFY_MODELS}")
    if lot_id in _running:
        raise HTTPException(409, "A labeling run is already in progress for this lot.")

    rois = RoiStore.get_rois(lot_id)
    polys = [r.get("polygon", []) for r in rois if len(r.get("polygon", [])) >= 3]
    if not polys:
        raise HTTPException(400, f"No ROIs saved for '{lot_id}'. Draw and save ROIs first.")
    base = _resolve_base(lot_id, image_dir)
    images = _list_images(base, date_glob)
    if not images:
        raise HTTPException(400, f"No images found under {base} (date filter '{date_glob}').")

    _running.add(lot_id)
    op_id = register_op("label_batch", f"Labeling {lot_id}…")
    threading.Thread(
        target=_run_batch,
        args=(lot_id, base, rois, polys, model_name, conf_threshold,
              brightness_threshold, date_glob, op_id),
        daemon=True,
    ).start()
    return {"started": True, "op_id": op_id, "lot_id": lot_id,
            "image_count": len(images), "roi_count": len(polys)}


@router.get("/api/label-batch/{lot_id}/manifest", dependencies=[Depends(verify_api_key)])
def get_manifest(lot_id: str):
    _validate_lot(lot_id)
    return _load_manifest(lot_id)


@router.get("/api/label-batch/{lot_id}/crop/{crop_id}", dependencies=[Depends(verify_api_key)])
def get_crop(lot_id: str, crop_id: str):
    _validate_lot(lot_id)
    manifest = _load_manifest(lot_id)
    rec = next((c for c in manifest["crops"] if c["crop_id"] == crop_id), None)
    if rec is None:
        raise HTTPException(404, "Crop not found")
    path = _out_root(lot_id) / rec["crop_path"]
    if not path.exists():
        raise HTTPException(404, "Crop file missing")
    return FileResponse(str(path), media_type="image/jpeg")


@router.delete("/api/label-batch/{lot_id}/crop/{crop_id}", dependencies=[Depends(verify_api_key)])
def delete_crop(lot_id: str, crop_id: str):
    _validate_lot(lot_id)
    with _lock_for(lot_id):
        manifest = _load_manifest(lot_id)
        rec = next((c for c in manifest["crops"] if c["crop_id"] == crop_id), None)
        if rec is None:
            raise HTTPException(404, "Crop not found")
        (_out_root(lot_id) / rec["crop_path"]).unlink(missing_ok=True)
        manifest["crops"] = [c for c in manifest["crops"] if c["crop_id"] != crop_id]
        _save_manifest(lot_id, manifest)
        return {"deleted": crop_id, "counts": manifest["counts"]}


@router.post("/api/label-batch/{lot_id}/crop/{crop_id}/reassign", dependencies=[Depends(verify_api_key)])
def reassign_crop(lot_id: str, crop_id: str, status: str = Query(...)):
    _validate_lot(lot_id)
    if status not in ("occupied", "vacant"):
        raise HTTPException(400, "status must be 'occupied' or 'vacant'")
    with _lock_for(lot_id):
        manifest = _load_manifest(lot_id)
        rec = next((c for c in manifest["crops"] if c["crop_id"] == crop_id), None)
        if rec is None:
            raise HTTPException(404, "Crop not found")
        root = _out_root(lot_id)
        new_rel = f"crops/{status}/{crop_id}.jpg"
        old_path = root / rec["crop_path"]
        new_path = root / new_rel
        if old_path.exists():
            old_path.replace(new_path)
        rec["bucket"] = status
        rec["status"] = status
        rec["crop_path"] = new_rel
        _save_manifest(lot_id, manifest)
        return {"crop_id": crop_id, "status": status, "counts": manifest["counts"]}


# ── Detector export ──────────────────────────────────────
@router.post("/api/label-batch/{lot_id}/export-detector", dependencies=[Depends(verify_api_key)])
def export_detector(lot_id: str):
    """Reshape the current (post-curation) manifest into the converter's schema
    and build a YOLO detection dataset. Only confident occupied+vacant crops are
    included (review/ and too_dark/ are excluded)."""
    _validate_lot(lot_id)
    manifest = _load_manifest(lot_id)

    # Group confident crops by source image.
    by_img: dict[str, dict] = {}
    for c in manifest["crops"]:
        if c["bucket"] not in ("occupied", "vacant"):
            continue
        entry = by_img.setdefault(c["source_image"], {"rois": [], "occ": []})
        entry["rois"].append(c["polygon"])
        entry["occ"].append(c["bucket"] == "occupied")
    if not by_img:
        raise HTTPException(400, "No confident occupied/vacant crops to export.")

    # Deterministic train/val/test split over the unique source images.
    names = sorted(by_img.keys())
    random.Random(42).shuffle(names)
    n = len(names)
    n_tr = int(n * config.TRAIN_SPLIT)
    n_va = int(n * config.VAL_SPLIT)
    split_names = {"train": names[:n_tr], "valid": names[n_tr:n_tr + n_va], "test": names[n_tr + n_va:]}

    # Stage full frames (flat, basename) + annotations.json for the converter.
    staging = _out_root(lot_id) / "detector_src"
    img_out = staging / "images"
    if staging.exists():
        shutil.rmtree(staging)
    img_out.mkdir(parents=True, exist_ok=True)

    annotations: dict = {}
    src_base = Path(manifest.get("image_dir") or (config.DATA_DIR / lot_id))
    used: set[str] = set()  # flat basenames already taken in img_out (case-insensitive)

    def _unique_name(rel: str) -> str:
        """Flat basename for img_out; on collision append _1, _2, … to the stem so
        same-named frames from different date folders don't overwrite each other."""
        stem, suffix = Path(rel).stem, Path(rel).suffix
        name, i = f"{stem}{suffix}", 1
        while name.lower() in used:
            name, i = f"{stem}_{i}{suffix}", i + 1
        used.add(name.lower())
        return name

    for split, split_imgs in split_names.items():
        file_names, rois_list, occ_list = [], [], []
        for rel in split_imgs:
            src = src_base / rel
            if not src.exists():
                continue
            base = _unique_name(rel)
            shutil.copy2(src, img_out / base)
            file_names.append(base)
            rois_list.append(by_img[rel]["rois"])
            occ_list.append(by_img[rel]["occ"])
        annotations[split] = {"file_names": file_names, "rois_list": rois_list,
                              "occupancy_list": occ_list}
    with open(staging / "annotations.json", "w") as f:
        json.dump(annotations, f)

    out_dir = _out_root(lot_id) / "yolo_detect_dataset"
    yaml_path = build_yolo_detect_dataset(gopro_dir=staging, out_dir=out_dir, force=True)

    counts = {s: len(annotations[s]["file_names"]) for s in ("train", "valid", "test")}
    counts["total_images"] = sum(counts.values())
    counts["total_labels"] = sum(len(e["rois"]) for e in by_img.values())
    return {"dataset_yaml": str(yaml_path), "counts": counts}


# ── Read-only brightness calibration ─────────────────────
@router.get("/api/label-batch/{lot_id}/calibrate", dependencies=[Depends(verify_api_key)])
def calibrate(lot_id: str, date_glob: str = "2026-*", sample: int = 200, image_dir: str = ""):
    """Brightness distribution over the ROI area for a sample of images, to pick
    the threshold from real data. Read-only — writes nothing."""
    _validate_lot(lot_id)
    rois = RoiStore.get_rois(lot_id)
    polys = [r.get("polygon", []) for r in rois if len(r.get("polygon", [])) >= 3]
    if not polys:
        raise HTTPException(400, f"No ROIs saved for '{lot_id}'. Draw and save ROIs first.")

    base = _resolve_base(lot_id, image_dir)
    images = _list_images(base, date_glob)
    if not images:
        raise HTTPException(400, f"No images found under {base} (date filter '{date_glob}').")
    total_images = len(images)
    if sample and len(images) > sample:
        step = len(images) / sample
        images = [images[int(i * step)] for i in range(sample)]

    results = []  # (brightness, rel_path)
    for p in images:
        frame = cv2.imread(str(p))
        if frame is None:
            continue
        mask = _roi_mask(frame, polys)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        vals = gray[mask > 0]
        if vals.size:
            results.append((float(vals.mean()), p))
    if not results:
        raise HTTPException(400, "Could not read any sampled images.")

    lums = np.array([r[0] for r in results])
    thresholds = [20, 30, 40, 50, 60, 70]
    darkest = sorted(results, key=lambda r: r[0])[:6]
    thumbs = []
    for lum, p in darkest:
        frame = cv2.imread(str(p))
        if frame is None:
            continue
        h, w = frame.shape[:2]
        s = 160 / max(h, w)
        small = cv2.resize(frame, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 70])
        if ok:
            thumbs.append({"brightness": round(lum, 1),
                           "image": "data:image/jpeg;base64," + base64.b64encode(buf).decode()})

    return {
        "sampled": len(results),
        "total_images": total_images,
        "min": round(float(lums.min()), 1),
        "p05": round(float(np.percentile(lums, 5)), 1),
        "p10": round(float(np.percentile(lums, 10)), 1),
        "median": round(float(np.median(lums)), 1),
        "p90": round(float(np.percentile(lums, 90)), 1),
        "max": round(float(lums.max()), 1),
        "below": {str(t): int((lums < t).sum()) for t in thresholds},
        "darkest_thumbnails": thumbs,
    }
