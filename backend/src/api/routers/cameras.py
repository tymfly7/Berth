"""Video source control, anomaly-detection settings, and camera registry CRUD."""

import logging
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile

import config
from src.api.deps import limiter, validate_camera_source, verify_api_key
from src.api.operations import finish_op, register_op
from src.api.processor_service import processor_service
from src.cameras.camera_registry import camera_registry

logger = logging.getLogger("berth.cameras")
router = APIRouter()


# ── Video / Camera ───────────────────────────────────────
@router.post("/api/upload-video", dependencies=[Depends(verify_api_key)])
@limiter.limit(config.UPLOAD_RATE_LIMIT)
async def upload_video(request: Request, file: UploadFile = File(...)):
    op_id = register_op("video_upload", "Uploading video…")
    try:
        allowed = (".mp4", ".avi", ".mov", ".mkv", ".webm")
        if not file.filename.lower().endswith(allowed):
            raise HTTPException(400, "Unsupported video format")
        safe_name = Path(file.filename).name  # strip any directory components
        dest = config.UPLOAD_DIR / safe_name
        max_bytes = 500 * 1024 * 1024  # 500 MB
        written = 0
        try:
            with open(dest, "wb") as f_out:
                while chunk := await file.read(1 << 20):
                    written += len(chunk)
                    if written > max_bytes:
                        raise HTTPException(413, "Video exceeds 500 MB limit")
                    f_out.write(chunk)
        except HTTPException:
            dest.unlink(missing_ok=True)
            raise
        proc = processor_service.get_processor()
        proc.set_video_source(str(dest))
        return {"message": "Video uploaded", "path": safe_name}
    finally:
        finish_op(op_id)


@router.post("/api/use-camera", dependencies=[Depends(verify_api_key)])
def use_camera():
    proc = processor_service.get_processor()
    proc.set_video_source(0)
    return {"message": "Switched to live camera"}


# ── Anomaly detection settings ────────────────────────────
@router.get("/api/settings/anomaly", dependencies=[Depends(verify_api_key)])
def get_anomaly():
    return {"enabled": processor_service.anomaly_enabled, "park_thresh": processor_service.anomaly_park_thresh}


@router.post("/api/settings/anomaly", dependencies=[Depends(verify_api_key)])
async def set_anomaly(request: Request):
    body = await request.json()
    enabled = bool(body.get("enabled", False))
    if "park_thresh" in body:
        try:
            processor_service.anomaly_park_thresh = max(0.0, min(1.0, float(body["park_thresh"])))
        except (TypeError, ValueError):
            raise HTTPException(400, "park_thresh must be a number between 0 and 1")
    try:
        proc = processor_service.get_processor()
        proc.set_anomaly_detection(enabled)
        proc.set_anomaly_sensitivity(processor_service.anomaly_park_thresh)
    except FileNotFoundError:
        raise HTTPException(400, "YOLO26 detect model not found. Train it first via the Training panel.")
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    processor_service.anomaly_enabled = enabled
    for cam in camera_registry.get_all():
        if cam.get("active"):
            p = camera_registry.get_processor(cam["id"])
            if p:
                try:
                    p.set_anomaly_detection(enabled)
                    p.set_anomaly_sensitivity(processor_service.anomaly_park_thresh)
                except Exception as e:
                    logger.debug(f"Anomaly toggle skipped for camera {cam['id']}: {e}")
    return {"enabled": processor_service.anomaly_enabled, "park_thresh": processor_service.anomaly_park_thresh}


# ── Occupancy detection sensitivity ──────────────────────
@router.get("/api/settings/occupancy", dependencies=[Depends(verify_api_key)])
def get_occupancy_threshold():
    return {"threshold": config.OCCUPANCY_THRESHOLD}


@router.post("/api/settings/occupancy", dependencies=[Depends(verify_api_key)])
async def set_occupancy_threshold(request: Request):
    """Set the YOLO classify occupancy decision threshold live. Lower → more
    spots called 'occupied' (fewer false negatives). Read fresh per inference,
    so the change takes effect immediately across all cameras."""
    body = await request.json()
    try:
        val = max(0.05, min(0.95, float(body["threshold"])))
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, "threshold must be a number between 0.05 and 0.95")
    config.OCCUPANCY_THRESHOLD = val
    return {"threshold": config.OCCUPANCY_THRESHOLD}


# ── Camera registry endpoints ────────────────────────────
@router.get("/api/cameras", dependencies=[Depends(verify_api_key)])
def list_cameras():
    return camera_registry.get_all()


@router.post("/api/cameras", status_code=201, dependencies=[Depends(verify_api_key)])
async def add_camera(request: Request):
    body = await request.json()
    name = body.get("name", "").strip()
    source = body.get("source", "").strip()
    type_ = body.get("type", "usb")
    roi_camera_id = body.get("roi_camera_id", "").strip() or None

    if not name:
        raise HTTPException(400, "name is required")
    if not source:
        raise HTTPException(400, "source is required")
    if type_ not in ("usb", "rtsp", "file", "youtube"):
        raise HTTPException(400, "type must be usb, rtsp, file, or youtube")

    validate_camera_source(source, type_)

    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "cam"
    cam_id = f"{slug}-{uuid.uuid4().hex[:6]}"

    try:
        cam = camera_registry.add_camera(
            id=cam_id, name=name, source=source, type_=type_,
            roi_camera_id=roi_camera_id,
        )
    except ValueError as e:
        raise HTTPException(409, str(e))
    return cam


@router.patch("/api/cameras/{camera_id}", dependencies=[Depends(verify_api_key)])
async def update_camera(camera_id: str, request: Request):
    body = await request.json()
    name    = body.get("name",    "").strip() or None
    source  = body.get("source",  "").strip() or None
    type_   = body.get("type",    "").strip() or None
    roi_camera_id = body.get("roi_camera_id", "").strip() or None

    if type_ is not None and type_ not in ("usb", "rtsp", "file", "youtube"):
        raise HTTPException(400, "type must be usb, rtsp, file, or youtube")

    cam_current = camera_registry.get(camera_id)
    if cam_current is None:
        raise HTTPException(404, f"Camera '{camera_id}' not found")

    if source is not None:
        validate_camera_source(source, type_ or cam_current["type"])

    cam = camera_registry.update_camera(
        camera_id, name=name, source=source, type_=type_, roi_camera_id=roi_camera_id
    )
    return cam


@router.delete("/api/cameras/{camera_id}", dependencies=[Depends(verify_api_key)])
def remove_camera(camera_id: str):
    if not camera_registry.remove_camera(camera_id):
        raise HTTPException(404, f"Camera '{camera_id}' not found")
    return {"deleted": camera_id}


@router.post("/api/cameras/{camera_id}/activate", dependencies=[Depends(verify_api_key)])
def activate_camera(camera_id: str):
    if camera_registry.get(camera_id) is None:
        raise HTTPException(404, f"Camera '{camera_id}' not found")
    ok = camera_registry.activate(camera_id, model_name=processor_service.resolve_model_name())
    if not ok:
        raise HTTPException(500, "Failed to activate camera")
    if processor_service.anomaly_enabled:
        p = camera_registry.get_processor(camera_id)
        if p:
            try:
                p.set_anomaly_detection(True)
                p.set_anomaly_sensitivity(processor_service.anomaly_park_thresh)
            except Exception as e:
                logger.debug(f"Anomaly setup skipped for {camera_id}: {e}")
    return {"activated": camera_id}


@router.post("/api/cameras/{camera_id}/deactivate", dependencies=[Depends(verify_api_key)])
def deactivate_camera(camera_id: str):
    if camera_registry.get(camera_id) is None:
        raise HTTPException(404, f"Camera '{camera_id}' not found")
    camera_registry.deactivate(camera_id)
    return {"deactivated": camera_id}
