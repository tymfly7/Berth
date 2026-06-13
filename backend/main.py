"""
Berth — FastAPI Backend
====================================
Application assembly: lifespan, middleware, WebSocket streaming, and the SPA
fallback. The REST endpoints live in src/api/routers/* and are mounted here via
include_router; shared state and helpers live in src/api/* (processor_service,
deps, operations).

Features:
  - /predict endpoint: upload image, get slot-wise availability
  - WebSocket video streaming at ~20 FPS (metrics JSON + binary JPEG frames)
  - API key auth (optional via BERTH_API_KEY)
  - Rate limiting on uploads
  - Training management endpoints
  - Model switching (cnn_scratch / resnet50 / mobilenetv4 / yolo26_classify / yolo26)
  - Multi-camera registry with persistent activation
"""

import asyncio
import hmac
import logging
import os
import sys
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

import config
from src.api.deps import limiter
from src.api.processor_service import processor_service
from src.api.routers import analytics, auth, cameras, inference, roi, training
from src.cameras.camera_registry import camera_registry
from src.db import database as db


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
)
logger = logging.getLogger("berth")
sys.path.insert(0, str(Path(__file__).parent))


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    if not config.API_KEY:
        logger.warning(
            "BERTH_API_KEY is not set — all protected endpoints are publicly accessible. "
            "Set this env var before any network-facing deployment."
        )
    if not config.ADMIN_PASSWORD:
        logger.warning(
            "BERTH_ADMIN_PASSWORD is not set — admin login is disabled (/api/auth/login returns 503). "
            "Set this env var to enable the admin area."
        )
    from src.sync.sync_worker import SyncWorker
    SyncWorker().start()
    # Restore active cameras and pre-warm the default processor in a background
    # thread so the server starts accepting connections immediately — model loading
    # is slow (5–15 s) and must not block the asyncio event loop.
    def _startup_warmup():
        camera_registry._restore_active()
        from src.inference.inference_pool import InferencePool
        InferencePool.get()
        try:
            processor_service.get_processor()
            logger.info("VideoProcessor pre-warmed")
        except Exception as e:
            logger.warning(f"Processor pre-warm skipped: {e}")
        # Pre-load only the active classifier. The others load lazily on first
        # use and stay cached after — pre-loading all five bloated startup time
        # and resident memory (and on edge dragged in the torch/ultralytics path
        # for the YOLO models, which the ncnn-only profile cannot satisfy).
        try:
            processor_service.get_classifier(processor_service.active_mode or config.ACTIVE_MODEL)
        except Exception as e:
            logger.warning(f"Classifier pre-warm skipped: {e}")
        logger.info("Active classifier pre-warmed")
    threading.Thread(target=_startup_warmup, daemon=True, name="startup-warmup").start()
    yield
    camera_registry.shutdown()


app = FastAPI(
    title="Berth",
    description="Real-time parking detection powered by deep learning",
    version="1.0.0",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(404)
async def not_found_handler(request: Request, exc):
    return JSONResponse(
        status_code=404,
        content={"detail": "We looked everywhere and we couldn't find that!"},
    )


_allowed_origins = [o for o in [
    os.getenv("BERTH_ALLOWED_ORIGIN", ""),
] if o]

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    # localhost/127.0.0.1 plus private LAN ranges (10/8, 192.168/16, 172.16-31/12)
    # so the board works both locally and when viewed from another device on the network.
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_static_dir = Path("static")
if (_static_dir / "assets").exists():
    app.mount("/assets", StaticFiles(directory=_static_dir / "assets"), name="assets")

API_KEY = config.API_KEY

# REST endpoints live in routers; mount them before the SPA catch-all below.
app.include_router(inference.router)
app.include_router(analytics.router)
app.include_router(training.router)
app.include_router(cameras.router)
app.include_router(roi.router)
app.include_router(auth.router)


# ═══════════════════════════════════════════════════════════════
# App-level meta endpoints
# ═══════════════════════════════════════════════════════════════
@app.get("/")
def root():
    index = _static_dir / "index.html"
    if index.exists():
        return FileResponse(index)
    return {
        "service": "Berth",
        "version": "1.0.0",
        "status": "running",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/health")
def health():
    proc = processor_service.get_processor()
    return {
        "status": "ok",
        "processor": type(proc).__name__,
        "model": processor_service.active_mode,
        "auth_enabled": bool(API_KEY),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/status")
def get_status():
    from src.api.operations import list_ops
    ops = list_ops()
    return {"busy": len(ops) > 0, "operations": ops}


# ═══════════════════════════════════════════════════════════════
# WebSocket — streams metrics (JSON) + frames (binary JPEG) at ~20 FPS
# ═══════════════════════════════════════════════════════════════
def _ws_token_valid(token: str) -> bool:
    """Return True if the token is acceptable for WebSocket auth.
    When API_KEY is unset the check is skipped (open deployment).
    Set VITE_API_KEY in the frontend .env to pass the token automatically.
    """
    if not API_KEY:
        return True
    return hmac.compare_digest(token.encode(), API_KEY.encode())


@app.websocket("/ws/video")
async def video_ws(websocket: WebSocket, token: str = ""):
    if not _ws_token_valid(token):
        await websocket.close(code=4001)
        return
    await websocket.accept()
    # Offload the (potentially slow) model load + processor start to a worker
    # thread so a cold connect never blocks the event loop and freezes every
    # other request/WS.
    proc = await asyncio.to_thread(processor_service.get_processor)
    await asyncio.to_thread(proc.start_processing)
    logger.info("WebSocket client connected")
    last_frame_seq = -1
    try:
        while True:
            proc = processor_service.get_processor()
            metrics = proc.get_metrics()
            await websocket.send_json({"metrics": metrics})
            # New frames are sent as a separate binary message (raw JPEG bytes)
            # so we avoid base64 inflation (~33%) in the JSON payload.
            frame_jpeg, frame_seq = proc.get_frame_jpeg_and_seq()
            if frame_jpeg and frame_seq != last_frame_seq:
                last_frame_seq = frame_seq
                await websocket.send_bytes(frame_jpeg)
            await asyncio.sleep(0.05)
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")


@app.websocket("/ws/cameras/{camera_id}")
async def camera_ws(websocket: WebSocket, camera_id: str, token: str = ""):
    if not _ws_token_valid(token):
        await websocket.close(code=4001)
        return
    await websocket.accept()
    if camera_registry.get(camera_id) is None:
        await websocket.send_json({"error": "Camera not found"})
        await websocket.close()
        return
    if camera_registry.get_processor(camera_id) is None:
        await websocket.send_json({"type": "feed_unavailable", "reason": "Camera is not active"})
        await websocket.close()
        return
    logger.info(f"Camera WS connected: {camera_id}")
    no_frame_ticks = 0
    last_frame_seq = -1
    try:
        while True:
            proc = camera_registry.get_processor(camera_id)
            if proc is None:
                await websocket.send_json({"type": "feed_unavailable", "reason": "Camera feed stopped"})
                await websocket.close()
                break
            metrics = proc.get_metrics()
            await websocket.send_json({"metrics": metrics})
            frame_jpeg, frame_seq = proc.get_frame_jpeg_and_seq()
            if frame_jpeg is None:
                no_frame_ticks += 1
                if no_frame_ticks >= 600:  # ~30 s with 0.05 s sleep
                    await websocket.send_json({"type": "feed_unavailable", "reason": "Video stream unavailable or timed out"})
                    await websocket.close()
                    break
            else:
                no_frame_ticks = 0
                if frame_seq != last_frame_seq:
                    last_frame_seq = frame_seq
                    # Separate binary message — raw JPEG bytes, no base64.
                    await websocket.send_bytes(frame_jpeg)
            await asyncio.sleep(0.05)
    except WebSocketDisconnect:
        logger.info(f"Camera WS disconnected: {camera_id}")
    except Exception as e:
        logger.error(f"Camera WS error ({camera_id}): {e}")


# ── SPA fallback (registered last so it never shadows API/router routes) ──
@app.get("/{full_path:path}")
def spa_fallback(full_path: str):
    index = _static_dir / "index.html"
    if index.exists():
        return FileResponse(index)
    raise HTTPException(status_code=404, detail="Not found")


# ── Entry point ───────────────────────────────────────────
if __name__ == "__main__":
    # Reload is off by default: it spawns a child process (breaks Ctrl+C on
    # Windows) and watching the huge data/ + venv/ trees is wasteful and can
    # retrigger a full reload — which reloads every model — on each DB write.
    # Opt in with BERTH_RELOAD=1; even then, only watch *.py and skip the big
    # data/venv/db dirs.
    _reload = os.getenv("BERTH_RELOAD") == "1"
    uvicorn.run(
        "main:app",
        host=config.HOST,
        port=config.PORT,
        reload=_reload,
        reload_includes=["*.py"] if _reload else None,
        reload_excludes=["data/*", "venv/*", "*.db*", "roi_configs/*"] if _reload else None,
        ws_ping_interval=None,  # streaming at 20 FPS detects disconnects via send errors
    )
