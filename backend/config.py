"""
Smart Parking Lot Detection System — Centralized Configuration
===============================================================
All paths, hyperparameters, and runtime settings live here.
Override any setting via environment variables where noted.
"""

import os
from pathlib import Path

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
PKLOT_ROOT = os.getenv("PKLOT_ROOT", r"D:\PKLot\PKLotSegmented")

# Ensure directories exist
for d in (DATA_DIR, UPLOAD_DIR, MODEL_DIR, OUTPUT_DIR):
    d.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
HOST = os.getenv("SMARTPARK_HOST", "0.0.0.0")
PORT = int(os.getenv("SMARTPARK_PORT", "8000"))

# ---------------------------------------------------------------------------
# Security
# ---------------------------------------------------------------------------
API_KEY = os.getenv("SMARTPARK_API_KEY", "")           # empty = auth disabled
UPLOAD_RATE_LIMIT = os.getenv("SMARTPARK_UPLOAD_RATE_LIMIT", "10/minute")

# ---------------------------------------------------------------------------
# Active model  ("cnn_scratch", "resnet18", "mobilenetv2", "demo")
# ---------------------------------------------------------------------------
ACTIVE_MODEL = os.getenv("SMARTPARK_MODEL", "demo")

# ---------------------------------------------------------------------------
# Model paths
# ---------------------------------------------------------------------------
CNN_SCRATCH_PATH  = MODEL_DIR / "best_cnn_scratch.pth"
RESNET18_PATH     = MODEL_DIR / "best_resnet18.pth"
MOBILENET_PATH    = MODEL_DIR / "best_mobilenetv2.pth"
CNN_INPUT_SIZE    = 128
CNN_CONFIDENCE_THRESHOLD = 0.6

# ---------------------------------------------------------------------------
# Training Hyperparameters
# ---------------------------------------------------------------------------
TRAIN_SPLIT = 0.70
VAL_SPLIT   = 0.15
TEST_SPLIT  = 0.15

EPOCHS              = int(os.getenv("SMARTPARK_EPOCHS", "5"))
BATCH_SIZE           = int(os.getenv("SMARTPARK_BATCH_SIZE", "32"))
LEARNING_RATE        = float(os.getenv("SMARTPARK_LR", "1e-3"))
WEIGHT_DECAY         = 1e-4          # L2 regularization
EARLY_STOP_PATIENCE  = 4
LR_SCHEDULER_PATIENCE = 2
LR_SCHEDULER_FACTOR  = 0.1
NUM_WORKERS          = int(os.getenv("SMARTPARK_WORKERS", "2"))

# Subset size for quick testing (0 = use full dataset)
SUBSET_SIZE = int(os.getenv("SMARTPARK_SUBSET", "2000"))

# ---------------------------------------------------------------------------
# Inference / streaming
# ---------------------------------------------------------------------------
FRAME_WIDTH   = 900
FRAME_HEIGHT  = 500
STREAM_FPS    = 20
JPEG_QUALITY  = 80

# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------
ALERT_THRESHOLD_INFO     = 70   # % occupancy
ALERT_THRESHOLD_WARNING  = 85
ALERT_THRESHOLD_CRITICAL = 95
