"""Read-only analytics endpoints (metrics, heatmap, history, trends, alerts)
plus the edge→hub ingest endpoints."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from src.api.deps import verify_api_key
from src.cameras.camera_registry import camera_registry
from src.db import database as db
from src.inference.video_processor import default_metrics
from src.roi.roi_store import RoiStore

logger = logging.getLogger("berth.analytics")
router = APIRouter()


def _active_processors() -> list:
    """Running VideoProcessors for all active registry cameras."""
    procs = [
        camera_registry.get_processor(c["id"])
        for c in camera_registry.get_all()
        if c.get("active")
    ]
    return [p for p in procs if p is not None]


def _aggregate_metrics() -> dict:
    """Sum live metrics across active cameras. Returns the canonical empty
    shape when none are active (no live video system to query otherwise)."""
    procs = _active_processors()
    if not procs:
        return default_metrics()

    metrics = [p.get_metrics() for p in procs]
    total     = sum(m.get("total", 0)     for m in metrics)
    available = sum(m.get("available", 0) for m in metrics)
    occupied  = sum(m.get("occupied", 0)  for m in metrics)
    return {
        **metrics[0],
        "total": total,
        "available": available,
        "occupied": occupied,
        "occupancy_percent": round(100.0 * occupied / total, 1) if total else 0.0,
        "avg_confidence": round(sum(m.get("avg_confidence", 0.0) for m in metrics) / len(metrics), 4),
        "fps": round(sum(m.get("fps", 0.0) for m in metrics) / len(metrics), 1),
        "misparked_count": sum(m.get("misparked_count", 0) for m in metrics),
        "anomaly_enabled": any(m.get("anomaly_enabled") for m in metrics),
        "slots": [s for m in metrics for s in m.get("slots", [])],
    }


# ── Public metrics (no auth) ─────────────────────────────
@router.get("/api/public/metrics")
def get_public_metrics():
    return _aggregate_metrics()


@router.get("/api/public/lots")
def get_public_lots():
    """Unauthenticated per-lot view for the public page: slot geometry plus
    current occupancy for each active camera. Only non-sensitive fields are
    exposed (no camera source / credentials)."""
    out = []
    for cam in camera_registry.get_all():
        if not cam.get("active"):
            continue
        proc = camera_registry.get_processor(cam["id"])
        roi_cam_id = cam.get("roi_camera_id") or cam["id"]
        out.append({
            "cameraId": cam["id"],
            "name": cam.get("name"),
            "rois": RoiStore.get_rois(roi_cam_id),
            "metrics": proc.get_metrics() if proc else None,
        })
    return out


@router.get("/api/public/trends")
def get_public_trends(range: str = "day", camera_id: str = None):
    if range not in ("today", "day", "week", "month"):
        raise HTTPException(400, "range must be today, day, week, or month")
    return db.query_trends(range, camera_id)


# ── Metrics / Heatmap / History ──────────────────────────
@router.get("/api/metrics", dependencies=[Depends(verify_api_key)])
def get_metrics():
    return _aggregate_metrics()


@router.get("/api/heatmap", dependencies=[Depends(verify_api_key)])
def get_heatmap():
    proc = next(iter(_active_processors()), None)
    return proc.get_heatmap() if proc else []


@router.get("/api/heatmap/{camera_id}", dependencies=[Depends(verify_api_key)])
def get_heatmap_camera(camera_id: str):
    proc = camera_registry.get_processor(camera_id)
    if proc and hasattr(proc, "get_heatmap"):
        return proc.get_heatmap()
    return []


@router.get("/api/history", dependencies=[Depends(verify_api_key)])
def get_history():
    # Merge and sort all active camera histories by timestamp.
    procs = _active_processors()
    if not procs:
        return []
    merged = sorted(
        (entry for p in procs for entry in p.get_history()),
        key=lambda e: e.get("timestamp", "")
    )
    return merged[-100:]


@router.get("/api/trends", dependencies=[Depends(verify_api_key)])
def get_trends(range: str = "day", camera_id: str = None):
    if range not in ("today", "day", "week", "month"):
        raise HTTPException(400, "range must be today, day, week, or month")
    return db.query_trends(range, camera_id)


@router.get("/api/alerts", dependencies=[Depends(verify_api_key)])
def get_alerts(limit: int = 50):
    return db.get_alerts(limit)


@router.get("/api/training-runs", dependencies=[Depends(verify_api_key)])
def get_training_runs(limit: int = 20):
    return db.get_training_runs(limit)


# ── Edge → Hub ingest (hub side) ─────────────────────────
@router.post("/api/ingest/occupancy", dependencies=[Depends(verify_api_key)])
async def ingest_occupancy(request: Request):
    """Receive batched occupancy rows from an edge node and upsert into hub DB."""
    rows = await request.json()
    if not isinstance(rows, list):
        raise HTTPException(400, "Expected a JSON array of occupancy rows")
    inserted = db.upsert_occupancy_batch(rows)
    return {"inserted": inserted, "received": len(rows)}


@router.post("/api/ingest/alerts", dependencies=[Depends(verify_api_key)])
async def ingest_alerts(request: Request):
    """Receive batched alert rows from an edge node and upsert into hub DB."""
    rows = await request.json()
    if not isinstance(rows, list):
        raise HTTPException(400, "Expected a JSON array of alert rows")
    inserted = db.upsert_alerts_batch(rows)
    return {"inserted": inserted, "received": len(rows)}
