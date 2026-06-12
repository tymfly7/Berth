"""Read-only analytics endpoints (metrics, heatmap, history, trends, alerts)
plus the edge→hub ingest endpoints."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from src.api.deps import verify_api_key
from src.api.processor_service import processor_service
from src.cameras.camera_registry import camera_registry
from src.db import database as db

logger = logging.getLogger("berth.analytics")
router = APIRouter()


# ── Public metrics (no auth) ─────────────────────────────
@router.get("/api/public/metrics")
def get_public_metrics():
    # Aggregate across active cameras (mirrors /api/history); fall back to the
    # default processor when no cameras are active.
    active_procs = [
        camera_registry.get_processor(c["id"])
        for c in camera_registry.get_all()
        if c.get("active")
    ]
    active_procs = [p for p in active_procs if p is not None]
    if not active_procs:
        return processor_service.get_processor().get_metrics()

    metrics = [p.get_metrics() for p in active_procs]
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


# ── Metrics / Heatmap / History ──────────────────────────
@router.get("/api/metrics", dependencies=[Depends(verify_api_key)])
def get_metrics():
    return processor_service.get_processor().get_metrics()


@router.get("/api/heatmap", dependencies=[Depends(verify_api_key)])
def get_heatmap():
    active = next((c for c in camera_registry.get_all() if c.get("active")), None)
    if active:
        proc = camera_registry.get_processor(active["id"])
        if proc and hasattr(proc, "get_heatmap"):
            return proc.get_heatmap()
    proc = processor_service.get_processor()
    return proc.get_heatmap() if hasattr(proc, "get_heatmap") else []


@router.get("/api/heatmap/{camera_id}", dependencies=[Depends(verify_api_key)])
def get_heatmap_camera(camera_id: str):
    proc = camera_registry.get_processor(camera_id)
    if proc and hasattr(proc, "get_heatmap"):
        return proc.get_heatmap()
    return []


@router.get("/api/history", dependencies=[Depends(verify_api_key)])
def get_history():
    # Prefer active camera processors; fall back to the default processor
    active_procs = [
        camera_registry.get_processor(c["id"])
        for c in camera_registry.get_all()
        if c.get("active")
    ]
    active_procs = [p for p in active_procs if p and hasattr(p, "get_history")]
    if active_procs:
        # Merge and sort all camera histories by timestamp
        merged = sorted(
            (entry for p in active_procs for entry in p.get_history()),
            key=lambda e: e.get("timestamp", "")
        )
        return merged[-100:]
    proc = processor_service.get_processor()
    return proc.get_history() if hasattr(proc, "get_history") else []


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
