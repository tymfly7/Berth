"""Image inference endpoints — single-spot predict, lot/ROI/misparked analysis,
and the augmentation preview."""

import io
import json
import logging

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from PIL import Image
from typing import Optional

import config
from src.api.deps import (
    frame_to_b64, limiter, read_image, read_image_from_bytes, verify_api_key,
)
from src.api.operations import finish_op, register_op
from src.api.processor_service import processor_service
from src.roi.roi_store import RoiStore

logger = logging.getLogger("berth.inference")
router = APIRouter()


# ── Predict endpoint (single spot) ───────────────────────
@router.post("/api/predict", dependencies=[Depends(verify_api_key)])
@limiter.limit(config.UPLOAD_RATE_LIMIT)
async def predict(request: Request, file: UploadFile = File(...)):
    """
    Upload a parking space image and classify as occupied/vacant.
    Works best with cropped images of individual parking spots.
    """
    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(413, "Image exceeds 20 MB limit")

    # Validate extension and decode via shared helper
    frame = read_image_from_bytes(file.filename, content)
    pil_image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))

    model_name = processor_service.resolve_model_name()
    if model_name is None:
        raise HTTPException(400, "No trained model available. Train a model first.")
    try:
        clf = processor_service.get_classifier(model_name)
        result = clf.predict(pil_image)
        result["model"] = model_name
        result["type"] = "single_spot"
    except Exception as e:
        logger.error(f"Prediction error: {e}")
        result = {"status": "error", "message": str(e), "confidence": 0.0}

    return result


# ── Analyze full parking lot image ───────────────────────
@router.post("/api/analyze-lot", dependencies=[Depends(verify_api_key)])
@limiter.limit(config.UPLOAD_RATE_LIMIT)
async def analyze_lot(request: Request, file: UploadFile = File(...),
                      rows: int = 3, cols: int = 6):
    """
    Upload ANY parking lot image (aerial, Google, etc.) and analyze it.

    Splits the image into a grid of (rows x cols) cells, classifies each
    cell as occupied/vacant, and returns:
    - Slot-wise results with confidence
    - Summary stats (total, available, occupied)
    - Base64-encoded annotated image with green/red overlays

    Query params:
    - rows: number of grid rows (default: 3)
    - cols: number of grid columns (default: 6)
    """
    op_id = register_op("analysis", "Analyzing parking lot…")
    try:
        if not 1 <= rows <= 50 or not 1 <= cols <= 50:
            raise HTTPException(400, "rows and cols must each be between 1 and 50")

        frame = await read_image(file)

        model_name = processor_service.resolve_model_name()
        if model_name is None:
            raise HTTPException(400, "No trained model available. Train a model first.")
        try:
            clf = processor_service.get_classifier(model_name)
        except Exception as e:
            raise HTTPException(400, str(e))

        h, w = frame.shape[:2]
        cell_h = h // rows
        cell_w = w // cols

        cells = []
        slot_id = 1
        for r in range(rows):
            for c in range(cols):
                y1 = r * cell_h
                y2 = (r + 1) * cell_h if r < rows - 1 else h
                x1 = c * cell_w
                x2 = (c + 1) * cell_w if c < cols - 1 else w
                cells.append((slot_id, frame[y1:y2, x1:x2], x1, y1, x2, y2))
                slot_id += 1

        predictions = clf.predict_batch([c[1] for c in cells])

        annotated = frame.copy()
        slots = []
        available = 0
        occupied = 0
        total_conf = 0.0

        for (sid, _, x1, y1, x2, y2), pred in zip(cells, predictions):
            status = pred["status"]
            conf = pred["confidence"]
            total_conf += conf

            if status == "vacant":
                available += 1
                color = (0, 200, 0)
                overlay_color = (0, 255, 0)
            else:
                occupied += 1
                color = (0, 0, 220)
                overlay_color = (0, 0, 255)

            overlay = annotated.copy()
            cv2.rectangle(overlay, (x1, y1), (x2, y2), overlay_color, -1)
            cv2.addWeighted(overlay, 0.25, annotated, 0.75, 0, annotated)
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
            label = f"#{sid} {status[:3].upper()} {conf:.0%}"
            font_scale = max(0.35, min(cell_w, cell_h) / 200)
            cv2.putText(annotated, label, (x1 + 4, y1 + 18),
                        cv2.FONT_HERSHEY_SIMPLEX, font_scale, (255, 255, 255), 1)

            slots.append({
                "id": sid,
                "status": status,
                "confidence": round(conf, 4),
                "bbox": f"{x1} {y1} {x2-x1} {y2-y1}",
            })

        total = len(slots)
        avg_conf = total_conf / total if total > 0 else 0
        occ_pct = round(100.0 * occupied / total, 1) if total > 0 else 0

        return {
            "type": "lot_analysis",
            "model": processor_service.active_mode,
            "grid": f"{rows}x{cols}",
            "total": total,
            "available": available,
            "occupied": occupied,
            "occupancy_percent": occ_pct,
            "avg_confidence": round(avg_conf, 4),
            "slots": slots,
            "annotated_image": frame_to_b64(annotated),
        }
    finally:
        finish_op(op_id)


@router.post("/api/analyze-roi", dependencies=[Depends(verify_api_key)])
@limiter.limit(config.UPLOAD_RATE_LIMIT)
async def analyze_roi(
    request: Request,
    file: UploadFile = File(...),
    camera_id: str = "default",
    model_name: str = None,
    rois_json: Optional[str] = Form(default=None),
):
    """
    Analyze a parking lot image using saved ROI polygons for the given camera.
    Each ROI polygon is classified as occupied/vacant using the active model.

    Pass rois_json (JSON-encoded list) to bypass the disk read and eliminate
    the sequential save→analyze round-trip from the client.
    """
    op_id = register_op("roi_analysis", "Analyzing with ROIs…")
    try:
        frame = await read_image(file)

        # Prefer inline ROIs from the request body (eliminates save→analyze round-trip)
        rois = None
        if rois_json:
            try:
                rois = json.loads(rois_json) or None
            except (json.JSONDecodeError, ValueError):
                pass
        if not rois:
            rois = RoiStore.get_rois(camera_id)
        if not rois:
            raise HTTPException(400, "No ROIs saved for this camera. Draw and save ROIs first.")

        model_name = model_name if model_name in config.SUPPORTED_MODELS else processor_service.resolve_model_name()
        if model_name is None:
            raise HTTPException(400, "No trained model available. Train a model first.")
        try:
            clf = processor_service.get_classifier(model_name)
        except Exception as e:
            raise HTTPException(400, str(e))

        h, w = frame.shape[:2]
        annotated = frame.copy()
        available = 0
        occupied = 0
        total_conf = 0.0

        # Pass 1 — filter valid ROIs and collect crops (no inference yet)
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
            valid.append({"roi": roi, "crop": frame[y1:y2, x1:x2],
                          "xs": xs, "ys": ys, "polygon": polygon})

        # Single batched forward pass — all N crops classified in one model call
        predictions = clf.predict_batch([v["crop"] for v in valid]) if valid else []

        # Pass 2 — draw all semi-transparent fills in one blend (avoids N full-image copies)
        overlay = annotated.copy()
        for entry, pred in zip(valid, predictions):
            pts = np.array([[int(p[0] * w), int(p[1] * h)]
                            for p in entry["polygon"]], np.int32)
            overlay_color = (0, 255, 0) if pred["status"] == "vacant" else (0, 0, 255)
            cv2.fillPoly(overlay, [pts], overlay_color)
        cv2.addWeighted(overlay, 0.3, annotated, 0.7, 0, annotated)

        # Pass 3 — outlines, labels, slot data
        slots = []
        for entry, pred in zip(valid, predictions):
            roi = entry["roi"]
            xs, ys = entry["xs"], entry["ys"]
            status = pred["status"]
            conf = pred["confidence"]
            total_conf += conf

            if status == "vacant":
                available += 1
                color = (0, 200, 0)
            else:
                occupied += 1
                color = (0, 0, 220)

            pts = np.array([[int(p[0] * w), int(p[1] * h)]
                            for p in entry["polygon"]], np.int32)
            cv2.polylines(annotated, [pts], True, color, 2)
            cx, cy = sum(xs) // len(xs), sum(ys) // len(ys)
            cv2.putText(annotated,
                        f"{roi.get('label', 'Slot')} {status[:3].upper()} {conf:.0%}",
                        (cx - 20, cy), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
            slots.append({
                "id": roi.get("id"),
                "label": roi.get("label", "Slot"),
                "status": status,
                "confidence": round(conf, 4),
            })

        total = len(slots)
        occ_pct = round(100.0 * occupied / total, 1) if total > 0 else 0
        avg_conf = round(total_conf / total, 4) if total > 0 else 0

        # Cap output resolution — the result is shown in a narrow side panel, so a
        # full-res annotated image only bloats the base64 response payload.
        out_max = max(h, w)
        if out_max > 1280:
            s = 1280 / out_max
            annotated = cv2.resize(annotated, (int(w * s), int(h * s)),
                                   interpolation=cv2.INTER_AREA)
        annotated_b64 = frame_to_b64(annotated)

        return {
            "type": "roi_analysis",
            "model": processor_service.active_mode,
            "total": total,
            "available": available,
            "occupied": occupied,
            "occupancy_percent": occ_pct,
            "avg_confidence": avg_conf,
            "slots": slots,
            "annotated_image": annotated_b64,
        }
    finally:
        finish_op(op_id)


# ── Analyze misparked vehicles (YOLO + ROI geometry) ────
@router.post("/api/analyze-misparked", dependencies=[Depends(verify_api_key)])
@limiter.limit(config.UPLOAD_RATE_LIMIT)
async def analyze_misparked(
    request: Request,
    file: UploadFile = File(...),
    camera_id: str = "default",
):
    """
    Detect misparked vehicles in an uploaded parking lot image.

    Runs YOLO26 to locate all vehicles, loads the camera's ROI polygons,
    then classifies each vehicle as ok / straddling / outside_markings.

    Returns JSON with per-slot occupancy, a misparked-vehicle list, a
    misparked count (int) for the metrics shape, and a base64-encoded
    annotated image with misparked cars highlighted in orange.
    """
    op_id = register_op("misparked_analysis", "Detecting misparked vehicles…")
    try:
        frame = await read_image(file)

        rois = RoiStore.get_rois(camera_id)
        if not rois:
            raise HTTPException(
                400,
                f"No ROIs saved for camera '{camera_id}'. Draw and save ROIs first.",
            )

        # Load YOLO26 detector — surface a clear error if weights are missing
        try:
            from src.models.yolo_detector import ParkingYOLO26
            detector = ParkingYOLO26(str(config.YOLO26_DETECT_PATH))
        except FileNotFoundError:
            raise HTTPException(
                400,
                "YOLO26 detector weights not found. "
                "Train a YOLO26 detector first via the Training panel.",
            )
        except RuntimeError as exc:
            logger.error(f"YOLO26 detector failed to load: {exc}")
            raise HTTPException(400, f"YOLO26 detector failed to load: {exc}")

        h, w = frame.shape[:2]
        detections = detector.predict_frame(frame)
        cars = [{"bbox": d["bbox"], "confidence": d["confidence"]} for d in detections]

        from src.inference.parking_geometry import aggregate_lot, classify_vehicle_parking
        lot = aggregate_lot(cars, rois, w, h)

        # ── Annotate image ────────────────────────────────────────────────────
        annotated = frame.copy()

        # Draw slot outlines colour-coded by occupancy
        for slot in lot["slots"]:
            roi = next((r for r in rois if r.get("id") == slot["id"]), None)
            if roi is None:
                continue
            polygon = roi.get("polygon", [])
            if len(polygon) < 3:
                continue
            pts = np.array(
                [[int(p[0] * w), int(p[1] * h)] for p in polygon], np.int32
            )
            slot_color = (0, 200, 0) if slot["status"] == "vacant" else (0, 0, 200)
            overlay = annotated.copy()
            cv2.fillPoly(overlay, [pts], slot_color)
            cv2.addWeighted(overlay, 0.20, annotated, 0.80, 0, annotated)
            cv2.polylines(annotated, [pts], True, slot_color, 2)
            xs = [int(p[0] * w) for p in polygon]
            ys = [int(p[1] * h) for p in polygon]
            cx, cy = sum(xs) // len(xs), sum(ys) // len(ys)
            cv2.putText(
                annotated,
                slot.get("label", ""),
                (cx - 10, cy),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.4,
                (255, 255, 255),
                1,
            )

        # Draw each detected car — orange for misparked, light green for ok
        for car in cars:
            clf = classify_vehicle_parking(car["bbox"], rois, w, h)
            x1, y1, x2, y2 = (int(v) for v in car["bbox"])
            if clf["status"] == "misparked":
                color = (0, 165, 255)   # BGR orange
                reason_short = "STRADDLE" if clf["reason"] == "straddling" else "OUTSIDE"
                label = f"MISPK {reason_short}"
            else:
                color = (144, 238, 144)  # light green
                label = f"OK {car['confidence']:.0%}"
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
            cv2.putText(
                annotated,
                label,
                (x1 + 2, max(y1 - 4, 14)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.45,
                color,
                1,
            )

        return {
            "type": "misparked_analysis",
            "camera_id": camera_id,
            "total": lot["total"],
            "available": lot["available"],
            "occupied": lot["occupied"],
            "misparked": lot["misparked_count"],        # int for metrics shape
            "misparked_vehicles": lot["misparked"],     # detailed list
            "slots": lot["slots"],
            "annotated_image": frame_to_b64(annotated),
        }
    finally:
        finish_op(op_id)


# ── Data Augmentation Preview ─────────────────────────────
@router.post("/api/augment/preview", dependencies=[Depends(verify_api_key)])
async def augment_preview(request: Request):
    """Sample images from the dataset and return augmented versions as base64 JPEGs."""
    import random as _rnd

    body = await request.json()
    label    = body.get("label", "both")
    shadow_p = max(0.0, min(1.0, float(body.get("shadow_p", 0.5))))
    night    = bool(body.get("night", False))
    flip     = bool(body.get("flip", True))
    rotation = max(0, min(45, int(body.get("rotation", 15))))
    jitter   = max(0.0, min(1.0, float(body.get("jitter", 0.3))))
    count    = max(1, min(8, int(body.get("count", 6))))

    classes = ["occupied", "vacant"] if label == "both" else [label]
    candidates = []
    for cls in classes:
        cls_dir = config.DATA_DIR / cls
        if cls_dir.exists():
            for p in cls_dir.iterdir():
                if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".bmp"):
                    candidates.append((p, cls))

    if not candidates:
        raise HTTPException(400, "No dataset images found. Prepare the dataset first via the Controls panel.")

    chosen = _rnd.sample(candidates, min(count, len(candidates)))
    results = []

    for img_path, cls in chosen:
        try:
            img = Image.open(img_path).convert("RGB").resize((224, 224), Image.BILINEAR)
        except Exception:
            continue
        arr = np.array(img, dtype=np.float32)

        if flip and _rnd.random() < 0.5:
            arr = arr[:, ::-1, :].copy()

        if rotation > 0:
            angle = _rnd.uniform(-rotation, rotation)
            arr = np.array(
                Image.fromarray(arr.astype(np.uint8)).rotate(angle, expand=False),
                dtype=np.float32,
            )

        if jitter > 0:
            brightness = 1.0 + _rnd.uniform(-jitter, jitter)
            arr = np.clip(arr * brightness, 0, 255)
            contrast = 1.0 + _rnd.uniform(-jitter * 0.7, jitter * 0.7)
            mean = arr.mean()
            arr = np.clip((arr - mean) * contrast + mean, 0, 255)

        if shadow_p > 0 and _rnd.random() < shadow_p:
            _, w_s = arr.shape[:2]
            bw = _rnd.randint(w_s // 5, 3 * w_s // 5)
            x0 = _rnd.randint(0, w_s - bw)
            arr[:, x0:x0 + bw] *= _rnd.uniform(0.35, 0.65)

        if night:
            arr *= _rnd.uniform(0.15, 0.35)
            arr[:, :, 2] = np.clip(arr[:, :, 2] * 1.5, 0, 255)

        arr = np.clip(arr, 0, 255).astype(np.uint8)
        buf = io.BytesIO()
        Image.fromarray(arr).save(buf, format="JPEG", quality=85)
        import base64 as _b64
        results.append({"label": cls, "image": _b64.b64encode(buf.getvalue()).decode()})

    return {"images": results, "count": len(results)}
