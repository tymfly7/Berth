"""
Smart Parking AI — FastAPI Backend
====================================
REST + WebSocket endpoints for real-time parking detection.

Features:
  - /predict endpoint: upload image, get slot-wise availability
  - WebSocket video streaming at ~20 FPS
  - API key auth (optional via SMARTPARK_API_KEY)
  - Rate limiting on uploads
  - Training management endpoints
  - Model switching (demo / cnn_scratch / resnet18 / mobilenetv2)
  - Demo mode fallback when no model/camera available
"""

import os
import sys
import json
import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path
import cv2
import numpy as np
import uvicorn
from fastapi import (
    FastAPI, WebSocket, WebSocketDisconnect,
    UploadFile, File, HTTPException, Request, Depends,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
import io
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from src.inference.video_processor import VideoProcessor
import config


# ── Logging ───────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
)
logger = logging.getLogger("smartpark")
sys.path.insert(0, str(Path(__file__).parent))

# ── Rate limiter ──────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

# ── FastAPI app ───────────────────────────────────────────────
app = FastAPI(
    title="Smart Parking AI",
    description="Real-time parking detection powered by deep learning",
    version="1.0.0",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API key auth ──────────────────────────────────────────────
API_KEY = config.API_KEY

async def verify_api_key(request: Request):
    if not API_KEY:
        return
    key = request.headers.get("X-API-Key", "")
    if key != API_KEY:
        raise HTTPException(401, "Invalid or missing API key")

# ── Processor (lazy loaded) ──────────────────────────────────
_processor = None
_active_mode = config.ACTIVE_MODEL

def _get_processor():
    global _processor, _active_mode
    if _processor is None:
        mode = _active_mode
        if mode in ("cnn_scratch", "resnet18", "mobilenetv2"):
            try:
                _processor = VideoProcessor(model_name=mode)
                logger.info(f"{mode} VideoProcessor initialised")
            except Exception as e:
                logger.warning(f"{mode} unavailable ({e}), falling back to demo")
                mode = "demo"

        if mode == "demo" or _processor is None:
            from src.inference.demo_processor import DemoProcessor
            _processor = DemoProcessor()
            _active_mode = "demo"
            logger.info("DemoProcessor initialised")
    return _processor

def _reset_processor():
    global _processor
    if _processor is not None:
        try:
            _processor.stop_processing()
        except Exception:
            pass
    _processor = None

def _resolve_model_name():
    """Resolve active model name for prediction — if 'demo', find best trained model."""
    if _active_mode in ("cnn_scratch", "resnet18", "mobilenetv2"):
        return _active_mode
    # In demo mode, try to find a trained model
    for name, path in [
        ("cnn_scratch", config.CNN_SCRATCH_PATH),
        ("resnet18", config.RESNET18_PATH),
        ("mobilenetv2", config.MOBILENET_PATH),
    ]:
        if path.exists():
            return name
    return None

# ═══════════════════════════════════════════════════════════════
# REST Endpoints
# ═══════════════════════════════════════════════════════════════

@app.get("/")
def root():
    return {
        "service": "Smart Parking AI",
        "version": "1.0.0",
        "status": "running",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.get("/api/health")
def health():
    proc = _get_processor()
    return {
        "status": "ok",
        "processor": type(proc).__name__,
        "model": _active_mode,
        "auth_enabled": bool(API_KEY),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

# ── Predict endpoint (single spot) ───────────────────────────
@app.post("/api/predict", dependencies=[Depends(verify_api_key)])
@limiter.limit(config.UPLOAD_RATE_LIMIT)
async def predict(request: Request, file: UploadFile = File(...)):
    """
    Upload a parking space image and classify as occupied/vacant.
    Works best with cropped images of individual parking spots.
    """
    allowed = (".jpg", ".jpeg", ".png", ".bmp")
    if not file.filename.lower().endswith(allowed):
        raise HTTPException(400, "Unsupported image format. Use JPG or PNG.")

    content = await file.read()
    pil_image = Image.open(io.BytesIO(content)).convert("RGB")

    # Single spot classification using the trained model
    model_name = _resolve_model_name()
    if model_name is None:
        raise HTTPException(400, "No trained model available. Train a model first.")
    try:
        from src.inference.classifier import ParkingClassifier
        clf = ParkingClassifier(model_name=model_name)
        clf.load()
        if not clf.is_loaded():
            raise Exception("Model not loaded")
        result = clf.predict(pil_image)
        result["model"] = model_name
        result["type"] = "single_spot"
    except Exception as e:
        logger.error(f"Prediction error: {e}")
        result = {"status": "error", "message": str(e), "confidence": 0.0}

    return result


# ── Analyze full parking lot image ───────────────────────────
@app.post("/api/analyze-lot", dependencies=[Depends(verify_api_key)])
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
    allowed = (".jpg", ".jpeg", ".png", ".bmp")
    if not file.filename.lower().endswith(allowed):
        raise HTTPException(400, "Unsupported image format. Use JPG or PNG.")

    content = await file.read()
    nparr = np.frombuffer(content, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if frame is None:
        raise HTTPException(400, "Could not decode image")

    # Load classifier
    model_name = _resolve_model_name()
    if model_name is None:
        raise HTTPException(400, "No trained model available. Train a model first.")
    try:
        from src.inference.classifier import ParkingClassifier
        clf = ParkingClassifier(model_name=model_name)
        clf.load()
        if not clf.is_loaded():
            raise Exception(f"Model '{model_name}' not loaded.")
    except Exception as e:
        raise HTTPException(400, str(e))

    h, w = frame.shape[:2]
    cell_h = h // rows
    cell_w = w // cols
    
    # Split into grid cells and classify each
    cells = []
    slot_id = 1
    for r in range(rows):
        for c in range(cols):
            y1 = r * cell_h
            y2 = (r + 1) * cell_h if r < rows - 1 else h
            x1 = c * cell_w
            x2 = (c + 1) * cell_w if c < cols - 1 else w
            cell_img = frame[y1:y2, x1:x2]
            cells.append((slot_id, cell_img, x1, y1, x2, y2))
            slot_id += 1

    # Batch classify
    cell_images = [c[1] for c in cells]
    predictions = clf.predict_batch(cell_images)

    # Build annotated image
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
            color = (0, 200, 0)       # Green
            overlay_color = (0, 255, 0)
        else:
            occupied += 1
            color = (0, 0, 220)       # Red (BGR)
            overlay_color = (0, 0, 255)

        # Semi-transparent overlay
        overlay = annotated.copy()
        cv2.rectangle(overlay, (x1, y1), (x2, y2), overlay_color, -1)
        cv2.addWeighted(overlay, 0.25, annotated, 0.75, 0, annotated)
        
        # Border
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
        
        # Label
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

    # Encode annotated image as base64
    import base64
    _, buffer = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 90])
    img_b64 = base64.b64encode(buffer).decode("utf-8")

    return {
        "type": "lot_analysis",
        "model": _active_mode,
        "grid": f"{rows}x{cols}",
        "total": total,
        "available": available,
        "occupied": occupied,
        "occupancy_percent": occ_pct,
        "avg_confidence": round(avg_conf, 4),
        "slots": slots,
        "annotated_image": img_b64,
    }

# ── Metrics / Heatmap / History ──────────────────────────────
@app.get("/api/metrics", dependencies=[Depends(verify_api_key)])
def get_metrics():
    return _get_processor().get_metrics()

@app.get("/api/heatmap", dependencies=[Depends(verify_api_key)])
def get_heatmap():
    proc = _get_processor()
    return proc.get_heatmap() if hasattr(proc, "get_heatmap") else []

@app.get("/api/history", dependencies=[Depends(verify_api_key)])
def get_history():
    proc = _get_processor()
    return proc.get_history() if hasattr(proc, "get_history") else []

# ── Video / Camera ───────────────────────────────────────────
@app.post("/api/upload-video", dependencies=[Depends(verify_api_key)])
@limiter.limit(config.UPLOAD_RATE_LIMIT)
async def upload_video(request: Request, file: UploadFile = File(...)):
    allowed = (".mp4", ".avi", ".mov", ".mkv", ".webm")
    if not file.filename.lower().endswith(allowed):
        raise HTTPException(400, "Unsupported video format")
    dest = config.UPLOAD_DIR / file.filename
    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)
    proc = _get_processor()
    proc.set_video_source(str(dest))
    return {"message": "Video uploaded", "path": str(dest)}

@app.post("/api/use-camera", dependencies=[Depends(verify_api_key)])
def use_camera():
    proc = _get_processor()
    proc.set_video_source(0)
    return {"message": "Switched to live camera"}

@app.post("/api/use-demo", dependencies=[Depends(verify_api_key)])
def use_demo():
    global _active_mode
    _reset_processor()
    _active_mode = "demo"
    proc = _get_processor()
    proc.start_processing()
    return {"message": "Switched to demo mode"}

# ── Model switching ──────────────────────────────────────────
@app.post("/api/use-model/{model_name}", dependencies=[Depends(verify_api_key)])
def use_model(model_name: str):
    global _active_mode
    valid = ["cnn_scratch", "resnet18", "mobilenetv2", "demo"]
    if model_name not in valid:
        raise HTTPException(400, f"Invalid model. Choose from: {valid}")
    _reset_processor()
    _active_mode = model_name
    proc = _get_processor()
    proc.start_processing()
    return {"message": f"Switched to {model_name}"}

@app.get("/api/model/info", dependencies=[Depends(verify_api_key)])
def model_info():
    data_dir = config.DATA_DIR
    occ_dir = data_dir / "occupied"
    vac_dir = data_dir / "vacant"
    dataset_ready = occ_dir.exists() and vac_dir.exists()
    dataset_count = 0
    if dataset_ready:
        dataset_count = len(list(occ_dir.glob("*"))) + len(list(vac_dir.glob("*")))

    comparison_path = config.OUTPUT_DIR / "model_comparison.json"
    comparison = None
    if comparison_path.exists():
        with open(comparison_path) as f:
            comparison = json.load(f)

    return {
        "active_model": _active_mode,
        "available_models": {
            "cnn_scratch": config.CNN_SCRATCH_PATH.exists(),
            "resnet18": config.RESNET18_PATH.exists(),
            "mobilenetv2": config.MOBILENET_PATH.exists(),
        },
        "dataset_ready": dataset_ready,
        "dataset_count": dataset_count,
        "comparison": comparison,
    }

# ── Training ─────────────────────────────────────────────────
@app.post("/api/train/start", dependencies=[Depends(verify_api_key)])
def start_training(request: Request, model_name: str = "cnn_scratch",
                   compare_all: bool = False):
    from src.train.train_manager import TrainManager
    mgr = TrainManager()
    if mgr.is_training():
        raise HTTPException(409, "Training already in progress")
    occ = config.DATA_DIR / "occupied"
    vac = config.DATA_DIR / "vacant"
    if not occ.exists() or not vac.exists():
        raise HTTPException(400, "Dataset not found. Prepare it first.")
    return mgr.start_training(model_name, compare_all=compare_all)

@app.get("/api/train/status", dependencies=[Depends(verify_api_key)])
def train_status():
    from src.train.train_manager import TrainManager
    return TrainManager().get_status()

@app.post("/api/dataset/prepare", dependencies=[Depends(verify_api_key)])
def prepare_dataset(source: str = None, max_per_class: int = 0,
                    generate_sample: bool = False, sample_count: int = 200):
    from src.data_prep.downloader import organize_pklot, generate_sample_dataset
    if generate_sample:
        generate_sample_dataset(num_per_class=sample_count)
        return {"message": f"Generated {sample_count} synthetic images per class"}
    result = organize_pklot(source_root=source, max_per_class=max_per_class)
    return {"message": "Dataset prepared", **result}

# ═══════════════════════════════════════════════════════════════
# WebSocket — streams frames + metrics at ~20 FPS
# ═══════════════════════════════════════════════════════════════
@app.websocket("/ws/video")
async def video_ws(websocket: WebSocket):
    await websocket.accept()
    proc = _get_processor()
    proc.start_processing()
    logger.info("WebSocket client connected")
    try:
        while True:
            frame_b64 = proc.get_latest_frame_base64()
            metrics = proc.get_metrics()
            if frame_b64:
                await websocket.send_json({
                    "frame": frame_b64,
                    "metrics": metrics,
                })
            await asyncio.sleep(0.05)
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        proc.stop_processing()

# ── Entry point ───────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run("main:app", host=config.HOST, port=config.PORT, reload=True)
