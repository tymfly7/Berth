"""
Berth — Centralized Configuration
===============================================================
All paths, hyperparameters, and runtime settings live here.
Override any setting via environment variables where noted.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = BASE_DIR / "uploads"
MODEL_DIR = BASE_DIR / "models"
OUTPUT_DIR = BASE_DIR / "outputs"
SPOTS_CONFIG_PATH = BASE_DIR / "spots_config.json"

# PKLot dataset root — set this to your downloaded PKLot path
# Expected structure: PKLOT_ROOT/PKLotSegmented/{PUC,UFPR04,UFPR05}/.../Occupied|Empty
PKLOT_ROOT = os.getenv("PKLOT_ROOT", "")

# Ensure directories exist
for d in (DATA_DIR, UPLOAD_DIR, MODEL_DIR, OUTPUT_DIR):
    d.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
HOST = os.getenv("BERTH_HOST", "0.0.0.0")
PORT = int(os.getenv("BERTH_PORT", "8001"))  # 8000 left free for other local services (e.g. Docker)

# ---------------------------------------------------------------------------
# Security
# ---------------------------------------------------------------------------
API_KEY = os.getenv("BERTH_API_KEY", "")           # empty = auth disabled
UPLOAD_RATE_LIMIT = os.getenv("BERTH_UPLOAD_RATE_LIMIT", "10/minute")

# ---------------------------------------------------------------------------
# Active model  ("cnn_scratch", "resnet50", "mobilenetv4s", "yolo26_classify", "yolo26")
# ---------------------------------------------------------------------------
ACTIVE_MODEL = os.getenv("BERTH_MODEL", "yolo26_classify")

# ---------------------------------------------------------------------------
# Model paths
# ---------------------------------------------------------------------------
CNN_SCRATCH_PATH      = MODEL_DIR / "best_cnn_scratch.pth"
RESNET50_PATH         = MODEL_DIR / "best_resnet50.pth"
MOBILENETV4_PATH      = MODEL_DIR / "best_mobilenetv4.pth"
YOLO26_CLASSIFY_PATH  = MODEL_DIR / "best_yolo26_classify.pt"
YOLO26_DETECT_PATH    = MODEL_DIR / "best_yolo26_detect.pt"
YOLO_DATASET_DIR         = DATA_DIR  / "yolo_detect_dataset"
YOLO_GOPRO_DIR           = DATA_DIR  / "yolo_data" / "parking_rois_gopro"
CLASSIFY_YOLO_DATA_DIR   = BASE_DIR  / "classify_yolo_data"
CNN_INPUT_SIZE    = 224
CNN_CONFIDENCE_THRESHOLD = 0.6

# ---------------------------------------------------------------------------
# Training Hyperparameters
# ---------------------------------------------------------------------------
TRAIN_SPLIT = 0.70
VAL_SPLIT   = 0.15
TEST_SPLIT  = 0.15

EPOCHS              = int(os.getenv("BERTH_EPOCHS", "30"))
YOLO_DETECT_EPOCHS  = int(os.getenv("BERTH_YOLO_DETECT_EPOCHS", "30"))
BATCH_SIZE           = int(os.getenv("BERTH_BATCH_SIZE", "32"))
LEARNING_RATE        = float(os.getenv("BERTH_LR", "1e-3"))
WEIGHT_DECAY         = 1e-4          # L2 regularization
EARLY_STOP_PATIENCE  = 4
LR_SCHEDULER_PATIENCE = 2
LR_SCHEDULER_FACTOR  = 0.1
NUM_WORKERS          = int(os.getenv("BERTH_WORKERS", "2"))

# Subset size for CNN models (0 = full dataset)
SUBSET_SIZE = int(os.getenv("BERTH_SUBSET", "12000"))

# Smaller input size for YOLO classify — spots are pre-cropped so 64 px is
# enough and is ~10x faster than 224 px.
YOLO_CLASSIFY_IMG_SIZE = int(os.getenv("BERTH_YOLO_CLASSIFY_IMGSZ", "64"))

# YOLO detect — full-frame scenes pack ~30+ small parking spots, so 640 px
# starves them; 960 px recovers small-object recall. yolo26s gives more
# capacity than nano for the small (~230-image) annotated dataset.
YOLO_DETECT_IMG_SIZE = int(os.getenv("BERTH_YOLO_DETECT_IMGSZ", "960"))
YOLO_DETECT_MODEL    = os.getenv("BERTH_YOLO_DETECT_MODEL", "yolo26s.pt")

# ---------------------------------------------------------------------------
# Edge deployment
# ---------------------------------------------------------------------------
# "server" = full stack (default)  |  "edge" = inference-only (e.g. RPi5)
DEPLOYMENT_PROFILE = os.getenv("BERTH_DEPLOYMENT", "server")

# Hub URL for edge→hub occupancy sync (edge profile only).
# Example: "http://192.168.1.10:8000"
EDGE_HUB_URL = os.getenv("BERTH_EDGE_HUB_URL", "")

# ---------------------------------------------------------------------------
# Inference / streaming
# ---------------------------------------------------------------------------
# Edge profile uses lower resolution + FPS to stay within ARM CPU budget.
FRAME_WIDTH   = 640  if DEPLOYMENT_PROFILE == "edge" else 1280
FRAME_HEIGHT  = 480  if DEPLOYMENT_PROFILE == "edge" else 720
STREAM_FPS    = 6    if DEPLOYMENT_PROFILE == "edge" else 20
JPEG_QUALITY  = 92

# Live YouTube HLS URLs expire; cache resolved stream URLs for this long.
YOUTUBE_STREAM_CACHE_TTL = int(os.getenv("BERTH_YT_CACHE_TTL", "240"))  # seconds

# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------
ALERT_THRESHOLD_INFO     = 70   # % occupancy
ALERT_THRESHOLD_WARNING  = 85
ALERT_THRESHOLD_CRITICAL = 95
