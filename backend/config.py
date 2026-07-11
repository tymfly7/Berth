"""
Berth — Centralized Configuration
===============================================================
All paths, hyperparameters, and runtime settings live here.
Override any setting via environment variables where noted.
"""

import os
import secrets
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
EDGE_MODEL_DIR = BASE_DIR / "edge_models"   # NCNN exports for edge deployment
OUTPUT_DIR = BASE_DIR / "outputs"
CONFIG_DIR = BASE_DIR / "configs"           # runtime config (ROIs + camera registry)
ROI_CONFIG_DIR = Path(os.getenv("BERTH_ROI_DIR", str(CONFIG_DIR / "roi")))
CAMERAS_FILE = Path(os.getenv("BERTH_CAMERAS_FILE", str(CONFIG_DIR / "cameras.json")))
DB_PATH = Path(os.getenv("BERTH_DB_PATH", str(BASE_DIR / "berth.db")))

# Source dataset root for the classifier organizer — set this to a segmented
# occupied/vacant dataset (e.g. the lot-t10lot crops from parking-lot-t10).
# Expected structure: DATASET_ROOT/<lot>/<condition>/<date>/{Occupied,Empty}
DATASET_ROOT = os.getenv("DATASET_ROOT", "")

# Ensure directories exist
for d in (DATA_DIR, UPLOAD_DIR, MODEL_DIR, EDGE_MODEL_DIR, CONFIG_DIR, ROI_CONFIG_DIR, OUTPUT_DIR):
    d.mkdir(parents=True, exist_ok=True)

# Run-history retention: max timestamped eval/train snapshots kept per
# dataset/model (see src/eval/history_store.py). 0 = keep everything.
HISTORY_MAX_SNAPSHOTS = int(os.getenv("BERTH_HISTORY_MAX", "0"))

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

# Admin login (server-side). The password is validated by the backend and never
# shipped to the browser; a successful login returns a short-lived signed token.
ADMIN_PASSWORD = os.getenv("BERTH_ADMIN_PASSWORD", "")   # empty = admin login disabled (503)
AUTH_SECRET = os.getenv("BERTH_AUTH_SECRET", "") or secrets.token_urlsafe(32)  # token signing key
AUTH_TOKEN_TTL = int(os.getenv("BERTH_AUTH_TTL", "315360000"))  # admin session length, seconds (~10 years — local logins don't expire; lower for network-facing deployments)

# ---------------------------------------------------------------------------
# Active model — an occupancy classifier from CLASSIFY_MODELS below.
# ---------------------------------------------------------------------------
ACTIVE_MODEL = os.getenv("BERTH_MODEL", "yolo26s_classify")

# Model identifiers — single source of truth. Endpoints validate against these
# instead of re-listing literals, so the membership never drifts. Every name
# maps 1:1 to its own trained checkpoint (paths below). The YOLO26 *detect*
# model is a separate audience: it is trainable ('yolo26_detect') and drives the
# misparked-vehicle pass + ROI proposer, but is NOT an occupancy classifier.
CLASSIFY_MODELS  = (
    "cnn_scratch", "resnet18", "resnet50", "mobilenetv4s", "mobilenetv4m",
    "yolo26n_classify", "yolo26s_classify", "yolo26m_classify",
)
SUPPORTED_MODELS = CLASSIFY_MODELS                       # selectable for inference
TESTABLE_MODELS  = CLASSIFY_MODELS                       # per-patch accuracy eval
TRAINABLE_MODELS = CLASSIFY_MODELS + ("yolo26_detect",)  # classifiers + the detector

# ---------------------------------------------------------------------------
# Model paths — one checkpoint per model name.
# ---------------------------------------------------------------------------
CNN_SCRATCH_PATH      = MODEL_DIR / "best_cnn_scratch.pth"
RESNET18_PATH         = MODEL_DIR / "best_resnet18.pth"
RESNET50_PATH         = MODEL_DIR / "best_resnet50.pth"
MOBILENETV4S_PATH     = MODEL_DIR / "best_mobilenetv4s.pth"
MOBILENETV4M_PATH     = MODEL_DIR / "best_mobilenetv4m.pth"
# Per-scale YOLO26 classify checkpoints. yolo26m is the heaviest — it targets
# Pi 5 edge nodes; it is too heavy for the Pi Zero 2 W (use yolo26n there).
YOLO26N_CLASSIFY_PATH = MODEL_DIR / "best_yolo26n_classify.pt"
YOLO26S_CLASSIFY_PATH = MODEL_DIR / "best_yolo26s_classify.pt"
YOLO26M_CLASSIFY_PATH = MODEL_DIR / "best_yolo26m_classify.pt"
YOLO26_DETECT_PATH        = MODEL_DIR / "best_yolo26_detect.pt"
YOLO26N_CLASSIFY_NCNN_PATH = EDGE_MODEL_DIR / "best_yolo26n_classify_ncnn_model"
YOLO26S_CLASSIFY_NCNN_PATH = EDGE_MODEL_DIR / "best_yolo26s_classify_ncnn_model"
YOLO26M_CLASSIFY_NCNN_PATH = EDGE_MODEL_DIR / "best_yolo26m_classify_ncnn_model"
YOLO26_DETECT_NCNN_PATH   = EDGE_MODEL_DIR / "best_yolo26_detect_ncnn_model"
# Scale → checkpoint lookups so callers can resolve a yolo26{n,s,m}_classify
# name to its .pt / NCNN export without re-listing the literals.
YOLO26_CLASSIFY_PATHS = {"n": YOLO26N_CLASSIFY_PATH, "s": YOLO26S_CLASSIFY_PATH, "m": YOLO26M_CLASSIFY_PATH}
YOLO26_CLASSIFY_NCNN_PATHS = {"n": YOLO26N_CLASSIFY_NCNN_PATH, "s": YOLO26S_CLASSIFY_NCNN_PATH, "m": YOLO26M_CLASSIFY_NCNN_PATH}
YOLO_DATASET_DIR         = DATA_DIR  / "yolo_detect_dataset"
CLASSIFY_SPLIT_DIR       = DATA_DIR  / "classify_split"
CLASSIFY_SUBSET_DIR      = DATA_DIR  / "classify_subset"   # capped, class-balanced copy for YOLO classify
YOLO26_DETECT_RUN_DIR    = OUTPUT_DIR / "yolo26_detect"   / "run"

# One-time migration to the per-scale roster: the pre-split single classify
# checkpoint (best_yolo26_classify.pt) was the s-scale model, and the mobilenet
# checkpoint was the conv_small (s) model. Rename them (and the yolo NCNN export)
# to the scale-specific names so existing trained weights aren't orphaned.
def _migrate_checkpoint(old, new):
    try:
        if old.exists() and not new.exists():
            old.rename(new)
    except OSError:
        pass

_migrate_checkpoint(MODEL_DIR / "best_yolo26_classify.pt", YOLO26S_CLASSIFY_PATH)
_migrate_checkpoint(EDGE_MODEL_DIR / "best_yolo26_classify_ncnn_model", YOLO26S_CLASSIFY_NCNN_PATH)
_migrate_checkpoint(MODEL_DIR / "best_mobilenetv4.pth", MOBILENETV4S_PATH)
# Input resolution shared by all three PyTorch classifiers (cnn_scratch,
# resnet50, mobilenetv4s) for both training and inference. Kept at 224 because
# resnet50/mobilenetv4s are ImageNet-pretrained and expect ~224. A from-scratch
# cnn_scratch run can go faster at 64 px (subset test: 98.6% vs 99.6%); set
# BERTH_CNN_IMGSZ=64 for that ad-hoc experiment — but note it lowers all three.
CNN_INPUT_SIZE    = int(os.getenv("BERTH_CNN_IMGSZ", "224"))
CNN_CONFIDENCE_THRESHOLD = 0.6

# Occupancy decision threshold for the YOLO26 classify head: a spot is called
# "occupied" when P(occupied) exceeds this. Set below the neutral 0.5 to bias
# toward "occupied" and cut false negatives (taken spots reported as vacant).
# Lower it further to catch more occupied spots (at the cost of more false
# positives); raise toward 0.5 to be stricter. Override via env at runtime.
OCCUPANCY_THRESHOLD = float(os.getenv("BERTH_OCCUPANCY_THRESHOLD", "0.40"))

# Minimum continuous vacant duration before a slot is declared free.
# Prevents pedestrians or passing objects from triggering false vacancies.
VACANT_CONFIRM_SECS = float(os.getenv("BERTH_VACANT_CONFIRM_SECS", "0.5"))

# ---------------------------------------------------------------------------
# Training Hyperparameters
# ---------------------------------------------------------------------------
TRAIN_SPLIT = 0.70
VAL_SPLIT   = 0.15
TEST_SPLIT  = 0.15

EPOCHS               = int(os.getenv("BERTH_EPOCHS", "30"))
YOLO_CLASSIFY_EPOCHS = int(os.getenv("BERTH_YOLO_CLASSIFY_EPOCHS", "30"))
YOLO_DETECT_EPOCHS   = int(os.getenv("BERTH_YOLO_DETECT_EPOCHS", "30"))
BATCH_SIZE           = int(os.getenv("BERTH_BATCH_SIZE", "32"))
LEARNING_RATE        = float(os.getenv("BERTH_LR", "1e-3"))
WEIGHT_DECAY         = 1e-4          # L2 regularization
EARLY_STOP_PATIENCE  = 4
LR_SCHEDULER_PATIENCE = 2
LR_SCHEDULER_FACTOR  = 0.1
NUM_WORKERS          = int(os.getenv("BERTH_WORKERS", "2"))

# Cache decoded+resized images in RAM after first read. On Windows the web-UI
# training path runs with num_workers=0 (single process), so disk decode is the
# main bottleneck; caching removes it from every epoch after the first.
# Set BERTH_CACHE_DATASET=0 to disable if RAM is tight (~3.7 GB at 25k imgs).
CACHE_DATASET = os.getenv("BERTH_CACHE_DATASET", "1") == "1"

# Subset size for CNN models (0 = full dataset)
SUBSET_SIZE = int(os.getenv("BERTH_SUBSET", "25000"))

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

# Data-gathering capture is toggled per-camera (registry flag), not globally.
# CAPTURE_DIR is the base; each gathering camera writes to CAPTURE_DIR/<name>/<day>/.
CAPTURE_DIR           = Path(os.getenv("BERTH_CAPTURE_DIR", str(Path.home() / "berth_captures")))
CAPTURE_INTERVAL_SECS = float(os.getenv("BERTH_CAPTURE_INTERVAL", "300"))  # 5 min

# ---------------------------------------------------------------------------
# Inference / streaming
# ---------------------------------------------------------------------------
# Edge profile uses lower resolution + FPS to stay within ARM CPU budget. The
# per-profile values are defaults only — override per board via env so a single
# arm64 image can run on both a Pi 5 and a much weaker Pi Zero 2 W (separate
# compose files supply the tuning).
FRAME_WIDTH   = int(os.getenv("BERTH_FRAME_WIDTH",  "960" if DEPLOYMENT_PROFILE == "edge" else "1280"))
FRAME_HEIGHT  = int(os.getenv("BERTH_FRAME_HEIGHT", "540" if DEPLOYMENT_PROFILE == "edge" else "720"))
STREAM_FPS    = int(os.getenv("BERTH_STREAM_FPS",   "10"  if DEPLOYMENT_PROFILE == "edge" else "20"))
JPEG_QUALITY  = 90   if DEPLOYMENT_PROFILE == "edge" else 80  # edge raised for sharpness; server keeps bandwidth-optimised 80

# Inference rate, decoupled from STREAM_FPS. Parking occupancy changes slowly, so
# running the model on every decoded frame wastes CPU; the display loop reuses the
# last result between inferences. Lower on edge to keep ARM cores free for the API.
INFER_FPS = float(os.getenv("BERTH_INFER_FPS", "3" if DEPLOYMENT_PROFILE == "edge" else "8"))

# Cadence for the poorly-parked anomaly pass (YOLO26 detect), decoupled from
# INFER_FPS. The detect pass is far heavier than the per-slot classify and
# mis-parking changes slowly, so run it sparingly to keep ARM cores free for the
# API and the occupancy loop. 0.2 = one detect pass every 5 s.
ANOMALY_FPS = float(os.getenv("BERTH_ANOMALY_FPS", "0.2"))

# Cap on concurrent active cameras. Each active camera runs its own decode +
# inference loop; too many saturate a few-core edge box and starve the API.
MAX_ACTIVE_CAMERAS = int(os.getenv("BERTH_MAX_ACTIVE_CAMERAS", "2" if DEPLOYMENT_PROFILE == "edge" else "8"))

# Cap the anyio threadpool FastAPI uses for sync endpoints. Each pooled thread
# lives forever and pins its own SQLite connection, page cache, stack, and
# malloc arena — on a low-RAM edge box the default 40 threads is a slow leak.
# 0 = leave anyio's default untouched (dev/server behavior unchanged).
API_THREADS = int(os.getenv("BERTH_API_THREADS", "8" if DEPLOYMENT_PROFILE == "edge" else "0"))

# Live YouTube HLS URLs expire; cache resolved stream URLs for this long.
YOUTUBE_STREAM_CACHE_TTL = int(os.getenv("BERTH_YT_CACHE_TTL", "240"))  # seconds

# Cap YouTube stream height: full-quality (1080p) decode overwhelms low-RAM
# edge boxes. Pick the best rendition at or below this height.
YOUTUBE_MAX_HEIGHT = int(os.getenv("BERTH_MAX_STREAM_HEIGHT", "480"))

# Cap ingested frame height for every source (file / USB / RTSP / YouTube):
# raw frames fill the jitter buffer and the inference slot, so a native-
# resolution upload (e.g. 3200x1800 ≈ 17 MB/frame) blows the edge RAM budget.
# ROIs are normalized, so downscaling is safe for slot crops. 0 = no cap.
MAX_FRAME_HEIGHT = int(os.getenv("BERTH_MAX_FRAME_HEIGHT", "720" if DEPLOYMENT_PROFILE == "edge" else "0"))

# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------
ALERT_THRESHOLD_INFO     = 70   # % occupancy
ALERT_THRESHOLD_WARNING  = 85
ALERT_THRESHOLD_CRITICAL = 95
