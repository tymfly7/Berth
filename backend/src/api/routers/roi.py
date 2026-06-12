"""ROI (parking-slot polygon) CRUD, snapshots, and auto-proposal."""

import logging
from typing import Optional

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile

import config
from src.api.deps import limiter, verify_api_key
from src.roi.roi_store import RoiStore

logger = logging.getLogger("berth.roi")
router = APIRouter()


@router.get("/api/roi/{camera_id}", dependencies=[Depends(verify_api_key)])
def get_rois(camera_id: str):
    return RoiStore.get_rois(camera_id)


@router.get("/api/roi/{camera_id}/snapshot", dependencies=[Depends(verify_api_key)])
def get_snapshot(camera_id: str):
    snap_path = RoiStore.get_snapshot_path(camera_id)
    if snap_path is None:
        raise HTTPException(404, "No snapshot found for this camera")
    return Response(content=snap_path.read_bytes(), media_type="image/jpeg")


@router.post("/api/roi/{camera_id}/snapshot", dependencies=[Depends(verify_api_key)])
async def save_snapshot(camera_id: str, file: UploadFile = File(...)):
    allowed = (".jpg", ".jpeg", ".png")
    if not file.filename.lower().endswith(allowed):
        raise HTTPException(400, "Only JPG and PNG images are supported")
    content = await file.read()
    try:
        return RoiStore.save_snapshot(camera_id, content)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/api/roi/{camera_id}", dependencies=[Depends(verify_api_key)])
async def save_rois(camera_id: str, request: Request):
    body = await request.json()
    rois = body.get("rois", [])
    try:
        RoiStore.save_rois(camera_id, rois)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"saved": len(rois)}


@router.delete("/api/roi/{camera_id}/{roi_id}", dependencies=[Depends(verify_api_key)])
def delete_roi(camera_id: str, roi_id: str):
    if not RoiStore.delete_roi(camera_id, roi_id):
        raise HTTPException(404, f"ROI '{roi_id}' not found")
    return {"deleted": roi_id}


@router.delete("/api/roi/{camera_id}", dependencies=[Depends(verify_api_key)])
def delete_roi_config(camera_id: str):
    """Delete all ROIs and snapshot for a camera/lot config."""
    roi_path = RoiStore._roi_path(camera_id)
    snap_path = RoiStore._snapshot_path(camera_id)
    if not roi_path.exists():
        raise HTTPException(404, f"No ROI config found for '{camera_id}'")
    roi_path.unlink()
    if snap_path.exists():
        snap_path.unlink()
    return {"deleted": camera_id}


@router.post("/api/roi/{camera_id}/propose", dependencies=[Depends(verify_api_key)])
@limiter.limit(config.UPLOAD_RATE_LIMIT)
async def propose_rois(
    request: Request,
    camera_id: str,
    use_line_detection: bool = False,
    file: Optional[UploadFile] = File(default=None),
):
    """
    Auto-detect candidate parking-spot ROIs from an image.

    Accepts an uploaded image (multipart form field 'file'), or falls back to
    the saved snapshot for this camera if no file is provided.

    Returns PROPOSED ROIs — NOT persisted. The admin must accept proposals and
    save them via POST /api/roi/{camera_id} before they are stored.

    Query params:
      use_line_detection (bool): Snap candidate boxes to painted line markings
                                  via Canny + HoughLinesP (default: false).

    Honest constraints:
      Proposals reliably cover OCCUPIED spots. Empty spots are only detected
      when use_line_detection=True and markings are clearly visible. Always
      review proposals before accepting them.
    """
    if file is not None:
        allowed = (".jpg", ".jpeg", ".png", ".bmp")
        if not file.filename.lower().endswith(allowed):
            raise HTTPException(400, "Unsupported image format. Use JPG or PNG.")
        content = await file.read()
    else:
        snap_path = RoiStore.get_snapshot_path(camera_id)
        if snap_path is None:
            raise HTTPException(
                400,
                "No image uploaded and no snapshot found for this camera. "
                "Upload a reference image first.",
            )
        with open(snap_path, "rb") as fh:
            content = fh.read()

    nparr = np.frombuffer(content, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(400, "Could not decode image")

    try:
        from src.inference.roi_proposer import propose_from_frames
        proposals = propose_from_frames(
            frames=[frame],
            camera_id=camera_id,
            use_line_detection=use_line_detection,
        )
    except Exception as exc:
        logger.error(f"ROI proposal failed for camera '{camera_id}': {exc}")
        raise HTTPException(500, f"Proposal failed: {exc}")

    return {
        "camera_id": camera_id,
        "proposals": proposals,
        "count": len(proposals),
        "warning": (
            "Proposals are based on vehicle detections (occupied spots). "
            "Empty spots may be missed. Review and edit all proposals before saving."
        ),
    }
