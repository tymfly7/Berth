# Berth

AI-powered real-time parking detection using Computer Vision and Deep Learning.
Monitors parking occupancy via live camera, RTSP, YouTube, or uploaded video,
draws custom slot regions, detects misparked vehicles, and surfaces everything
through a two-view dashboard. Runs as a full **server** stack or as an
inference-only **edge** node (e.g. Raspberry Pi 5) that syncs back to a hub.

---

## Table of Contents

- [Screenshots](#screenshots)
- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Dataset Setup](#dataset-setup)
- [Training Models](#training-models)
- [ROI Editor](#roi-editor)
- [Camera Management](#camera-management)
- [Anomaly Detection](#anomaly-detection)
- [Edge / Hub Deployment](#edge--hub-deployment)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Model Comparison](#model-comparison)
- [Common Errors](#common-errors)
- [Docker Deployment](#docker-deployment)
- [Contributing](#contributing)
- [Acknowledgements](#acknowledgements)

---

## Screenshots

### Admin View

![Admin View](docs/admin.png)

### Public View

![Public View](docs/public.png)

---

## Features

| Feature | Description |
|---------|-------------|
| 4 Classifier Architectures | CNN from scratch, ResNet-50, MobileNetV4-Small, YOLO26 Classify |
| YOLO26 Detector | Bounding-box vehicle detector used for misparked-vehicle (anomaly) detection |
| Real-Time Detection | Per-camera WebSocket video stream (~20 FPS server / ~6 FPS edge) with slot-wise occupancy overlay |
| ROI Editor | Draw, edit, and manage custom parking slot polygons per camera |
| Polygon Editing | Vertex drag, edge-midpoint insertion, duplicate, scale, undo/redo |
| Multi-Camera Registry | USB, RTSP, file, and YouTube sources; one WebSocket feed per camera; cameras can share an ROI config |
| Anomaly Detection | YOLO26 Detect flags misparked vehicles (straddling or outside markings) |
| Public / Admin Views | Public board shows live availability; Admin dashboard is PIN-protected |
| ROI Proposals | Auto-propose candidate slot regions from an uploaded reference image (optional line-snapping) |
| Lot Map | SVG canvas color-coded by occupancy (vacant = green, occupied = red, misparked = amber) |
| Analytics Chart | Occupancy trend over configurable time ranges (today / day / week / month) |
| Usage Heatmap | Per-slot occupancy frequency heatmap |
| Augmentation Preview | Live preview of training-time augmentations (shadow, night, flip, rotation, jitter) |
| Model Comparison | Train all models, evaluate side-by-side, export to Excel |
| Edge / Hub Mode | Inference-only edge nodes run NCNN models and sync occupancy/alerts to a central hub |
| SQLite Persistence | Trends, alerts, and training runs stored across restarts |
| API Key Auth | Optional header (`X-API-Key`) / WebSocket token auth for production |

---

## Architecture

```
┌─────────────────────────────┐
│   Browser                   │
│  /            → PublicView  │  REST polling (30 s) + per-camera WS (metrics only)
│  /admin       → AdminView   │  WebSocket + REST  (PIN-gated)
│  /admin/docs  → DocsPage    │
└────────────┬────────────────┘
             │ HTTP / WebSocket
             ▼
┌──────────────────────────────────────────────┐
│   FastAPI Backend (:8001)                     │
│   main.py — app assembly, WS, SPA fallback    │
├──────────────────────────────────────────────┤
│  src/api/routers/  inference · analytics ·    │  REST endpoints
│                    training · cameras · roi   │
│  src/api/          processor_service · deps · │  shared state + helpers
│                    operations                 │
├──────────────────────────────────────────────┤
│  CameraRegistry      Multi-source lifecycle   │
│  VideoProcessor      Frame loop per camera    │
│  InferencePool       Shared detection workers │
│  SlotDetector        ROI-crop classification  │
│  ParkingClassifier / NcnnClassifier           │  CNN / MobileNet / YOLO / NCNN
│  ParkingYOLO26       Detector (anomaly)       │
│  RoiStore            Per-camera ROI JSON       │
│  SyncWorker          edge → hub push (edge)   │
│  SQLite (berth.db)   Trends, alerts, runs     │
└──────────────────────────────────────────────┘
```

In production (Docker) the backend serves the built frontend from `static/`, so
the whole app runs on a single origin. In local dev, Vite serves the frontend on
`:5173` and talks to the backend on `:8001`.

### Views

| Route | Access | Purpose |
|-------|--------|---------|
| `/` | Public | Live availability count, per-lot breakdown, lot map, occupancy trend |
| `/admin` | PIN-gated | Full dashboard: video feed, ROI editor, camera manager, training, settings |
| `/admin/docs` | PIN-gated | In-app documentation page |

---

## Quick Start

### Prerequisites

- Python 3.10+ (Docker image uses 3.11)
- Node.js 18+
- (Optional) NVIDIA GPU with CUDA for faster training

### 1. Clone and set up the backend

```bash
cd "School Project/backend"

# Create virtual environment
python -m venv venv

# Activate — Windows
venv\Scripts\activate

# Activate — Linux / macOS
# source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 2. GPU setup (optional)

```bash
# Check your CUDA version
nvidia-smi

# Install PyTorch with CUDA 12.1
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121

# CPU-only fallback (default, ~10–20x slower for training)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
```

### 3. Set up the frontend

```bash
cd "School Project/frontend"
npm install
```

### 4. Run the application

**Terminal 1 — Backend:**
```bash
cd "School Project/backend"
python main.py
# API available at http://localhost:8001
```

**Terminal 2 — Frontend:**
```bash
cd "School Project/frontend"
npm run dev
# Dashboard at http://localhost:5173
```

Open `http://localhost:5173` for the public view, or `http://localhost:5173/admin` for the admin dashboard.

> **Port note:** the backend defaults to **8001** (8000 is left free for other
> local services / Docker). Override with `BERTH_PORT`.

---

## Dataset Setup

The CNN / ResNet / MobileNet / YOLO26-classify models are trained on a binary
`occupied` / `vacant` image dataset. The YOLO26 **Detect** model uses a separate
annotated full-scene dataset (`data/yolo_data/parking_rois_gopro/`).

### Option A: PKLot Dataset (recommended)

1. Download from [Kaggle — PKLot](https://www.kaggle.com/datasets/blanderbuss/parking-lot-dataset)
2. Extract to a local folder (e.g., `D:\datasets\PKLotSegmented`)
3. Organize into the `data/occupied` and `data/vacant` layout:

```bash
cd "School Project/backend"
python -m src.data_prep.downloader --source "D:\datasets\PKLotSegmented"
```

### Option B: Generate sample data (quick testing)

```bash
python -m src.data_prep.downloader --generate-sample --sample-count 500
```

### Option C: Prepare via API

```bash
# Generate synthetic sample data
curl -X POST "http://localhost:8001/api/dataset/prepare?generate_sample=true&sample_count=500"

# Organize from a local PKLot path
curl -X POST "http://localhost:8001/api/dataset/prepare?source=D:/datasets/PKLotSegmented"
```

### Option D: Upload images directly from the Admin UI

Go to **Admin > Settings > Model Training** and use the dataset upload form to
label and upload individual images as `occupied` or `vacant`. The **Training
Data** subsection browses on-disk dataset folders and counts.

---

## Training Models

Five model targets are supported. Training is launched from the Admin UI or via
REST. Note the naming: the detector is referred to as `yolo26` at **inference**
time and `yolo26_detect` at **training** time.

| Training ID | Architecture | Notes |
|-------------|-------------|-------|
| `cnn_scratch` | Custom CNN (SE blocks) | Trained from scratch on the binary dataset |
| `resnet50` | ResNet-50 | Transfer learning |
| `mobilenetv4s` | MobileNetV4-Small (timm) | Lightweight; default model on edge nodes |
| `yolo26_classify` | YOLO26 Classify | NMS-free, edge-optimized; **default active model** |
| `yolo26_detect` | YOLO26 Detect (`yolo26s.pt`) | Object detector for anomaly / misparked detection |

### Train via API

```bash
# Start training a single model
curl -X POST "http://localhost:8001/api/train/start?model_name=cnn_scratch"
curl -X POST "http://localhost:8001/api/train/start?model_name=resnet50"
curl -X POST "http://localhost:8001/api/train/start?model_name=mobilenetv4s"
curl -X POST "http://localhost:8001/api/train/start?model_name=yolo26_classify"
curl -X POST "http://localhost:8001/api/train/start?model_name=yolo26_detect"

# Check training progress
curl http://localhost:8001/api/train/status
```

Train every model in sequence from the CLI with `python train_all.py`.

### Evaluate all models and export comparison

```bash
# Run evaluation across all trained classifiers
curl -X POST http://localhost:8001/api/evaluate/all

# Download Excel report
curl -o comparison.xlsx http://localhost:8001/api/evaluate/excel
```

> Training and evaluation are **server-only** — they return `403` on edge nodes.

### Training outputs (saved to `backend/outputs/`)

```
outputs/
├── history_cnn_scratch.json       # Epoch-level loss + accuracy logs
├── history_resnet50.json
├── history_mobilenetv4s.json
├── model_comparison.json          # Cross-model metrics
├── yolo26_classify/run/           # YOLO classify training artifacts
│   ├── results.csv
│   └── weights/best.pt
└── yolo26_detect/run/             # YOLO detect training artifacts
    ├── results.csv
    └── weights/best.pt
```

### Training environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BERTH_EPOCHS` | `30` | Max epochs for CNN classifiers |
| `BERTH_YOLO_CLASSIFY_EPOCHS` | `30` | Max epochs for YOLO classify |
| `BERTH_YOLO_DETECT_EPOCHS` | `30` | Max epochs for YOLO detect |
| `BERTH_BATCH_SIZE` | `32` | Batch size |
| `BERTH_LR` | `0.001` | Learning rate |
| `BERTH_SUBSET` | `12000` | CNN subset size (0 = full dataset) |
| `BERTH_WORKERS` | `2` | DataLoader workers |
| `BERTH_YOLO_CLASSIFY_IMGSZ` | `64` | Input size for YOLO classify (spots are pre-cropped) |
| `BERTH_YOLO_DETECT_IMGSZ` | `960` | Input size for YOLO detect (recovers small-object recall) |
| `BERTH_YOLO_DETECT_MODEL` | `yolo26s.pt` | Base weights for YOLO detect fine-tuning |

---

## ROI Editor

The ROI (Region of Interest) editor lets you define custom parking slot polygons
directly on a reference image snapshot. ROIs are stored per camera and used for
both occupancy classification and anomaly detection.

### How to use

1. Go to **Admin > Settings > Camera Registry** and add/activate a camera.
2. Open the **ROI Editor**.
3. Upload a reference snapshot from the live feed.
4. Draw slot polygons using **Polygon** or **Rectangle** draw mode.
5. Save — ROIs are stored in `backend/roi_configs/<camera_id>.json`.

### Editing tools

| Tool | Action |
|------|--------|
| Polygon | Click to place vertices; double-click / snap to close |
| Rectangle | Click-drag to draw a rectangular slot |
| Edit | Drag vertices (white circles) or edge midpoints (white squares) to reshape; drag inside polygon to translate |
| Duplicate | Copy selected ROI with a small offset |
| Scale +/- | Resize selected polygon around its centroid |
| Undo / Redo | Ctrl+Z / Ctrl+Y |
| Delete | Delete key removes the selected ROI |

### Auto-propose ROIs

The backend can auto-detect candidate slot regions from an uploaded image (or the
saved snapshot):

```bash
curl -X POST "http://localhost:8001/api/roi/default/propose" \
  -F "file=@parking_lot_snapshot.jpg"

# Snap candidate boxes to painted line markings (Canny + HoughLinesP)
curl -X POST "http://localhost:8001/api/roi/default/propose?use_line_detection=true" \
  -F "file=@parking_lot_snapshot.jpg"
```

Proposals are based on vehicle detections (occupied spots). Empty spots are only
reliably detected with `use_line_detection=true` and visible markings. Review and
edit all proposals before saving — they are **not** persisted automatically.

---

## Camera Management

The system supports multiple simultaneous camera sources. Each camera runs its
own `VideoProcessor`; detection work is dispatched to a shared `InferencePool`.

### Supported source types

| Type | Example source |
|------|---------------|
| `usb` | `0` (device index) |
| `rtsp` | `rtsp://user:pass@192.168.1.10/stream` |
| `file` | path to an uploaded video file |
| `youtube` | YouTube video URL (resolved to an HLS stream) |

### Connecting a camera

Pick the source type based on where the camera physically lives.

**USB — camera wired into the backend machine**

OpenCV reads the device **server-side**, so the camera must be plugged into the
host running the backend (not the laptop where you open the browser).

- The Source is the integer **device index**: `0` for the first/built-in camera, `1`, `2`, … for additional ones.
- Add Camera → Type **USB** → Source `0` → **Activate**.
- If the index is wrong nothing opens and the camera shows offline — try the next index. Only one app can hold a given camera at a time.

**RTSP — CCTV / IP camera on the network**

Most CCTV and IP cameras expose an RTSP URL:

```
rtsp://user:pass@<camera-ip>:554/<stream-path>
```

- The `<stream-path>` is vendor-specific — e.g. Hikvision `/Streaming/Channels/101`, Dahua `/cam/realmonitor?channel=1&subtype=0`. Check the camera's manual or its ONVIF/app settings.
- Test the URL in **VLC** first (*Media → Open Network Stream*). If VLC plays it, the backend will too (both use FFmpeg).
- Add Camera → Type **RTSP** → Source the `rtsp://…` URL → **Activate**.
- **Tip:** prefer the camera's lower-resolution **sub-stream** (e.g. Hikvision `Channels/102`, Dahua `subtype=1`). Parking detection doesn't need full resolution, and it's far lighter on CPU and bandwidth.

**YouTube Live — public live feed**

Paste a YouTube live URL; the backend resolves it to an HLS stream (cached for
`BERTH_YT_CACHE_TTL` seconds).

**Sharing an ROI config across cameras**

When adding a camera you can set `roi_camera_id` to point at another camera's ROI
config — useful when several feeds cover the same lot layout.

**Keeping RTSP credentials out of `cameras.json`**

Instead of saving the password in the stored source, set it as an environment
variable named `BERTH_CAM_SOURCE_<CAMERA_ID>` (uppercase, hyphens → underscores).
If present, the registry uses it at runtime and the on-disk config stays
credential-free.

```
# camera id "lot-a-1f3c2d" →
BERTH_CAM_SOURCE_LOT_A_1F3C2D=rtsp://user:pass@192.168.1.10:554/Streaming/Channels/102
```

### Manage cameras via API

```bash
# List cameras
curl http://localhost:8001/api/cameras

# Add a camera
curl -X POST http://localhost:8001/api/cameras \
  -H "Content-Type: application/json" \
  -d '{"name": "Lot A", "source": "0", "type": "usb"}'

# Update a camera (partial)
curl -X PATCH http://localhost:8001/api/cameras/<camera_id> \
  -H "Content-Type: application/json" \
  -d '{"name": "Lot A — North"}'

# Activate / deactivate
curl -X POST http://localhost:8001/api/cameras/<camera_id>/activate
curl -X POST http://localhost:8001/api/cameras/<camera_id>/deactivate

# Remove
curl -X DELETE http://localhost:8001/api/cameras/<camera_id>
```

Each active camera streams via its own WebSocket at `/ws/cameras/<camera_id>`.

---

## Anomaly Detection

When enabled, the system uses the YOLO26 Detect model to identify vehicles parked
outside designated slot boundaries.

### Enable via UI

Admin > Settings > Controls > Anomaly toggle.

### Enable via API

```bash
curl -X POST http://localhost:8001/api/settings/anomaly \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "park_thresh": 0.5}'
```

`park_thresh` (0–1) tunes how much a vehicle must overlap a slot before it counts
as parked-in-bounds.

### Classification logic

| Status | Condition |
|--------|-----------|
| `ok` | Vehicle center falls inside exactly one ROI polygon |
| `straddling` | Vehicle bounding box overlaps more than one ROI |
| `outside_markings` | Vehicle detected but center is outside all ROI polygons |

Misparked vehicles are highlighted in orange on the video feed and lot map. The
Misparked count appears as an additional metric card in the Admin dashboard.

Requires the YOLO26 Detect model (`backend/models/best_yolo26_detect.pt`) to be
trained first.

### Occupancy sensitivity

The YOLO-classify occupancy decision threshold is tunable live (it biases toward
calling a spot "occupied" to cut false negatives):

```bash
curl -X POST http://localhost:8001/api/settings/occupancy \
  -H "Content-Type: application/json" \
  -d '{"threshold": 0.40}'
```

---

## Edge / Hub Deployment

Berth can run in two profiles, selected with `BERTH_DEPLOYMENT`:

| Profile | Value | Role |
|---------|-------|------|
| Server (default) | `server` | Full stack: training, evaluation, dashboard, inference |
| Edge | `edge` | Inference-only node (e.g. Raspberry Pi 5 / ARM64); training & evaluation disabled |

**Edge nodes** run lighter NCNN models at reduced resolution/FPS and buffer
occupancy + alerts in a local SQLite DB. A background `SyncWorker` pushes
unsynced rows to the hub every 60 s when `BERTH_EDGE_HUB_URL` is set; if the hub
is unreachable, rows stay buffered and retry on the next tick (no data lost).

The **hub** receives those rows via the ingest endpoints (`POST
/api/ingest/occupancy`, `POST /api/ingest/alerts`).

### Exporting models for the edge

Trained models are exported to NCNN (CNN models via `torch.jit.trace` + pnnx,
YOLO models via Ultralytics export). This happens automatically after a
successful training run, or run it manually:

```bash
cd backend
python export_models.py        # writes *_ncnn_model/ dirs into models/
```

Copy the resulting `*_ncnn_model/` directories into the edge node's `models/`
before its first run. See [Docker Deployment](#docker-deployment) for the RPi
image.

---

## API Reference

### Core / meta

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Service info (or the SPA in production) |
| GET | `/api/health` | Health check + active model + auth state |
| GET | `/api/status` | Active background operations |

### Metrics and data

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/public/metrics` | Aggregated occupancy metrics (no auth) |
| GET | `/api/metrics` | Default-processor metrics (auth) |
| GET | `/api/heatmap` | Usage heatmap for the active camera |
| GET | `/api/heatmap/{camera_id}` | Heatmap for a specific camera |
| GET | `/api/history` | Recent occupancy records (merged across active cameras) |
| GET | `/api/trends` | Occupancy trends (`?range=today\|day\|week\|month`, `?camera_id=`) |
| GET | `/api/alerts` | Recent alerts (`?limit=`) |
| GET | `/api/training-runs` | Training run history (`?limit=`) |

### Prediction and analysis

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/predict` | Classify a single spot image |
| POST | `/api/analyze-lot` | Grid-based analysis of a full lot image (`?rows=&cols=`) |
| POST | `/api/analyze-roi` | ROI-polygon-based analysis of a lot image |
| POST | `/api/analyze-misparked` | Detect misparked vehicles in an image |
| POST | `/api/augment/preview` | Preview augmented dataset samples |

### Video and cameras

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload-video` | Upload a video file as the default source |
| POST | `/api/use-camera` | Switch default processor to the local webcam |
| GET | `/api/cameras` | List all cameras |
| POST | `/api/cameras` | Register a new camera |
| PATCH | `/api/cameras/{id}` | Update a camera (partial) |
| DELETE | `/api/cameras/{id}` | Remove a camera |
| POST | `/api/cameras/{id}/activate` | Start streaming from camera |
| POST | `/api/cameras/{id}/deactivate` | Stop camera stream |
| WS | `/ws/video` | Default video stream (metrics JSON + binary JPEG) |
| WS | `/ws/cameras/{camera_id}` | Per-camera video stream |

### Models and training

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/model/info` | Available models + dataset stats + comparison (cached 60 s) |
| POST | `/api/use-model/{name}` | Switch active model |
| POST | `/api/test-model/{name}` | Per-patch accuracy eval of a trained classifier |
| POST | `/api/train/start` | Start training (`?model_name=&compare_all=`) — server only |
| GET | `/api/train/status` | Training progress |
| POST | `/api/evaluate/all` | Evaluate all trained models — server only |
| GET | `/api/evaluate/excel` | Download comparison as an Excel file |

### ROI management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/roi/{camera_id}` | Get saved ROIs for a camera |
| POST | `/api/roi/{camera_id}` | Save ROIs for a camera |
| DELETE | `/api/roi/{camera_id}/{roi_id}` | Delete a single ROI |
| DELETE | `/api/roi/{camera_id}` | Delete all ROIs + snapshot for a camera |
| GET | `/api/roi/{camera_id}/snapshot` | Get reference snapshot |
| POST | `/api/roi/{camera_id}/snapshot` | Upload reference snapshot |
| POST | `/api/roi/{camera_id}/propose` | Auto-propose candidate ROIs |

### Dataset

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/dataset/upload` | Upload labeled classifier training images |
| POST | `/api/dataset/upload-yolo` | Upload a YOLO detect dataset (images + annotations.json) |
| GET | `/api/dataset/browse` | List dataset folders and counts |
| POST | `/api/dataset/prepare` | Organize PKLot or generate a sample dataset |

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings/anomaly` | Get anomaly detection state |
| POST | `/api/settings/anomaly` | Enable / disable anomaly detection (`park_thresh`) |
| GET | `/api/settings/occupancy` | Get occupancy decision threshold |
| POST | `/api/settings/occupancy` | Set occupancy decision threshold |

### Edge → Hub ingest (hub side)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ingest/occupancy` | Receive batched occupancy rows from an edge node |
| POST | `/api/ingest/alerts` | Receive batched alert rows from an edge node |

---

## Project Structure

```
School Project/
├── backend/
│   ├── main.py                          # FastAPI app assembly, WebSockets, SPA fallback
│   ├── config.py                        # Centralized config (paths, env vars, profiles)
│   ├── requirements.txt
│   ├── train_all.py                     # CLI: train all models in sequence
│   ├── export_models.py                 # CLI: export trained models to NCNN for edge
│   ├── verify.py                        # CLI: environment / structure sanity check
│   ├── berth.db                         # SQLite — trends, alerts, training runs
│   ├── models/                          # Trained weights (*.pth / *.pt) + *_ncnn_model/ dirs
│   ├── src/
│   │   ├── api/
│   │   │   ├── routers/
│   │   │   │   ├── inference.py          # predict / analyze-lot|roi|misparked / augment
│   │   │   │   ├── analytics.py          # metrics, heatmap, history, trends, alerts, ingest
│   │   │   │   ├── training.py           # model info, train, evaluate, dataset
│   │   │   │   ├── cameras.py            # camera CRUD, video source, anomaly/occupancy settings
│   │   │   │   └── roi.py                # ROI CRUD, snapshots, proposals
│   │   │   ├── processor_service.py     # Default processor + active model/anomaly state
│   │   │   ├── operations.py            # Background operation registry (/api/status)
│   │   │   └── deps.py                  # Auth, rate limiter, image/source helpers
│   │   ├── data_prep/
│   │   │   ├── dataset.py               # PyTorch Dataset + augmentation
│   │   │   ├── preprocessor.py          # Train/val/test split + DataLoaders
│   │   │   ├── downloader.py            # PKLot organizer + sample generator
│   │   │   └── yolo_converter.py        # Build YOLO detect dataset from annotations
│   │   ├── models/
│   │   │   ├── cnn_scratch.py           # Custom CNN architecture
│   │   │   ├── cnn_transfer.py          # ResNet-50 + MobileNetV4-Small via transfer learning
│   │   │   ├── model_factory.py         # Model creation factory
│   │   │   └── yolo_detector.py         # YOLO26 detect wrapper (ParkingYOLO26)
│   │   ├── train/
│   │   │   ├── trainer.py               # Training loop + early stopping
│   │   │   └── train_manager.py         # Background training + evaluation
│   │   ├── eval/
│   │   │   ├── evaluator.py             # Metrics computation
│   │   │   └── visualizer.py            # Loss / accuracy plots
│   │   ├── inference/
│   │   │   ├── classifier.py            # ParkingClassifier (CNN + YOLO classify)
│   │   │   ├── ncnn_classifier.py       # NCNN edge classifier (ARM64)
│   │   │   ├── inference_pool.py        # Shared detection worker pool
│   │   │   ├── slot_detector.py         # ROI-crop occupancy detection
│   │   │   ├── video_processor.py       # Per-camera frame loop + metrics
│   │   │   ├── parking_geometry.py      # Slot/vehicle overlap logic (anomaly)
│   │   │   └── roi_proposer.py          # Auto-propose candidate ROI polygons
│   │   ├── roi/roi_store.py             # Read/write per-camera ROI JSON + snapshots
│   │   ├── cameras/
│   │   │   ├── camera_registry.py       # Multi-camera lifecycle management
│   │   │   └── youtube_resolver.py      # YouTube watch URL → cached HLS stream
│   │   ├── export/model_exporter.py     # Export models to NCNN
│   │   ├── sync/sync_worker.py          # Edge → hub occupancy/alert push
│   │   ├── reports/model_report.py      # Comparison Excel + training detail loader
│   │   ├── db/database.py               # SQLite helpers (trends, alerts, runs, ingest)
│   │   └── utils/helpers.py
│   ├── data/                            # Training images (occupied / vacant) + YOLO datasets
│   ├── outputs/                         # Training logs, plots, YOLO run artifacts
│   ├── roi_configs/                     # Per-camera ROI JSON + snapshots
│   └── uploads/                         # User-uploaded video files
├── frontend/
│   ├── src/
│   │   ├── App.jsx                      # Router: / · /admin · /admin/docs · 404
│   │   ├── api.js                       # apiFetch wrapper (injects API key)
│   │   ├── config.js                    # API_BASE / WS_BASE resolution (dev vs prod)
│   │   ├── pages/
│   │   │   ├── PublicView.jsx           # Public availability board (no auth)
│   │   │   ├── AdminView.jsx            # Full operator dashboard (PIN-gated)
│   │   │   ├── DocsPage.jsx             # In-app documentation
│   │   │   └── NotFoundPage.jsx         # 404
│   │   ├── components/
│   │   │   ├── PinGate.jsx              # PIN prompt protecting /admin
│   │   │   ├── Header.jsx               # App header + connection indicator
│   │   │   ├── VideoFeed.jsx            # WebSocket video frame display
│   │   │   ├── MultiCameraGrid.jsx      # Grid of CameraFeedCell for active cameras
│   │   │   ├── CameraFeedCell.jsx       # Single camera WebSocket feed tile
│   │   │   ├── MetricCards.jsx          # Total / available / occupied / misparked cards
│   │   │   ├── LotMap.jsx               # SVG polygon lot map, color-coded by status
│   │   │   ├── AnalyticsChart.jsx       # Occupancy trend chart
│   │   │   ├── HeatmapView.jsx          # Per-slot usage heatmap
│   │   │   ├── ConfidenceGauge.jsx      # Average confidence arc gauge
│   │   │   ├── RoiEditor.jsx            # Polygon ROI drawing + editing canvas
│   │   │   ├── RoiManager.jsx           # ROI list, labels, save/discard
│   │   │   ├── CameraManager.jsx        # Add / activate / remove cameras
│   │   │   ├── ControlPanel.jsx         # Video source switcher + model selector
│   │   │   ├── TrainingPanel.jsx        # Dataset upload + training controls
│   │   │   ├── DataAugmentPanel.jsx     # Augmentation preview controls
│   │   │   ├── ModelStatus.jsx          # Per-model availability + metrics summary
│   │   │   ├── AnomalyPanel.jsx         # Anomaly detection toggle + sensitivity
│   │   │   ├── OccupancyPanel.jsx       # Occupancy threshold control
│   │   │   ├── SettingsPanel.jsx        # Collapsible wrapper for all settings
│   │   │   ├── AlertBanner.jsx          # Occupancy threshold alert display
│   │   │   └── ServerStatus.jsx         # Backend operation/connectivity indicator
│   │   ├── utils/roiUtils.js            # ROI → slot helpers
│   │   └── tests/                       # Vitest component tests
│   ├── index.html
│   └── vite.config.js
├── configs/
│   └── model_configs.yaml
├── Dockerfile                           # Server image (frontend build + Python backend)
├── Dockerfile.rpi                       # ARM64 / Raspberry Pi 5 edge image
├── docker-compose.yml                   # Server stack
├── docker-compose.edge.yml              # Edge node
├── docker-compose.rpi.yml               # Raspberry Pi 5 edge node
└── README.md
```

---

## Configuration

All settings are centralized in `backend/config.py` and can be overridden via
environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `BERTH_HOST` | `0.0.0.0` | Backend bind host |
| `BERTH_PORT` | `8001` | Backend port |
| `BERTH_API_KEY` | _(empty — auth off)_ | API key for protected endpoints + WS token |
| `BERTH_ALLOWED_ORIGIN` | _(empty)_ | Extra explicit CORS origin (LAN ranges allowed by default) |
| `BERTH_UPLOAD_RATE_LIMIT` | `10/minute` | Rate limit on upload endpoints |
| `BERTH_MODEL` | `yolo26_classify` | Default active model on startup |
| `BERTH_DB_PATH` | `backend/berth.db` | SQLite database path |
| `BERTH_DEPLOYMENT` | `server` | `server` (full) or `edge` (inference-only) |
| `BERTH_EDGE_HUB_URL` | _(empty)_ | Hub URL for edge→hub sync (edge profile only) |
| `BERTH_INFERENCE_WORKERS` | `min(cpu-1, 4)` | Shared inference pool worker count |
| `BERTH_OCCUPANCY_THRESHOLD` | `0.40` | YOLO-classify "occupied" decision threshold |
| `PKLOT_ROOT` | _(empty)_ | Path to downloaded PKLot dataset |
| `BERTH_YT_CACHE_TTL` | `240` | YouTube HLS URL cache lifetime (seconds) |
| `BERTH_RELOAD` | `0` | Set `1` to enable uvicorn auto-reload (dev) |
| `BERTH_CAM_SOURCE_<ID>` | _(empty)_ | Per-camera runtime source override (keeps credentials off disk) |

Training-specific variables are listed under [Training Models](#training-models).

### Deployment-dependent stream settings

| Setting | Server | Edge |
|---------|--------|------|
| Frame size | 1280×720 | 640×480 |
| Stream FPS | 20 | 6 |

### Alert thresholds

| Level | Occupancy |
|-------|-----------|
| Info | ≥ 70% |
| Warning | ≥ 85% |
| Critical | ≥ 95% |

### Security model & limitations

Auth is intentionally coarse: a single shared `BERTH_API_KEY` gates every
protected REST endpoint and the WebSocket stream (there is no per-user identity,
roles, or audit trail). The `/admin` PIN gate is a client-side convenience, not a
security boundary — the API key is what actually protects the backend. When
`BERTH_API_KEY` is empty, **all** protected endpoints are open (the server logs a
warning on startup). CORS allows localhost and private LAN ranges by default. Set
the API key (and serve over TLS via a reverse proxy) before any network-facing
deployment.

---

## Model Comparison

| Model | Type | Params | Notes |
|-------|------|--------|-------|
| CNN Scratch | Classifier | ~1.5 M | Trained from scratch (SE blocks) |
| ResNet-50 | Classifier | ~25 M | Transfer learning |
| MobileNetV4-Small | Classifier | ~3 M | Lightweight; default on edge nodes |
| YOLO26 Classify | Classifier | — | NMS-free; default active model |
| YOLO26 Detect | Detector | — | Bounding-box detector; used for anomaly detection |

Run `POST /api/evaluate/all` from the Admin UI or API to compare all trained
classifiers side-by-side. Download results as a formatted Excel file from
`GET /api/evaluate/excel`.

---

## Common Errors

| Error | Fix |
|-------|-----|
| `torch` import error | Ensure Python 3.10+ is active in the venv |
| `cv2` import error | `pip install opencv-python` |
| `ultralytics` import error | `pip install ultralytics` |
| `ncnn` import error (edge) | Install the `ncnn` package on the ARM64 node |
| CUDA out of memory | Reduce `BERTH_BATCH_SIZE` or use CPU-only PyTorch |
| No images found | Run dataset preparation first |
| WebSocket won't connect | Start the backend before the frontend; check the `:8001` port |
| YOLO26 weights not found | Train `yolo26_detect` / `yolo26_classify` via the Training panel first |
| Anomaly detection 400 error | YOLO26 Detect weights are missing — train it first |
| Training/evaluation 403 | The node is in `edge` profile — use the hub server |
| YouTube stream errors | URL may have expired; HLS URLs are cached for `BERTH_YT_CACHE_TTL` seconds |
| Rate limit exceeded | Wait a minute or raise `BERTH_UPLOAD_RATE_LIMIT` |

---

## Docker Deployment

### Server stack

```bash
# Build image
docker build -t berth:1.0 .

# Run directly (container port 8000)
docker run -p 8000:8000 berth:1.0

# With API key
docker run -p 8000:8000 -e BERTH_API_KEY=your-secret berth:1.0

# With docker-compose (publishes 127.0.0.1:9000 → 8000)
docker-compose up -d
```

The server image builds the frontend and serves it from `static/`, so the whole
app is reachable on a single origin/port.

### Edge / Raspberry Pi 5

```bash
# Generic edge node
docker-compose -f docker-compose.edge.yml up -d

# Raspberry Pi 5 (ARM64) — uses Dockerfile.rpi, NCNN models, edge profile
docker-compose -f docker-compose.rpi.yml up -d
```

Pre-populate `backend/models/` with the exported `*_ncnn_model/` directories
(see [Edge / Hub Deployment](#edge--hub-deployment)) before the first edge run,
and set `BERTH_EDGE_HUB_URL` to point edge nodes at the hub.

> Inside the containers the backend listens on `8000`. The `8001` default applies
> to bare-metal `python main.py` runs.

---

## Contributing

Contributions are welcome — bug fixes, new model backends, UI improvements, and
documentation all help.

1. **Fork** the repository and create a feature branch off `main`:
   ```bash
   git checkout -b feature/your-change
   ```
2. **Make focused changes.** Keep the diff scoped to one concern; match the
   existing code style on both the backend (Python) and frontend (React).
3. **Run the test and lint suites** before opening a PR — the same checks run in
   CI (`.github/workflows/ci.yml`):

   **Backend** (from `backend/`):
   ```bash
   pytest
   ruff check . --select E,F,W --ignore E501
   ```

   **Frontend** (from `frontend/`):
   ```bash
   npm run test          # vitest
   npx eslint src --max-warnings 0
   ```
4. **Update docs** when behavior changes — README, the in-app `/admin/docs` page,
   and any affected env-var / API tables.
5. **Open a pull request** against `main` with a clear description of the change
   and how you verified it. CI must be green (all three jobs: pytest, vitest, lint).

For larger features or architectural changes, open an issue first to discuss the
approach.

---

## Acknowledgements
- [AI-Parking-Lot-Detection](https://github.com/Nandini60/AI-Parking-Lot-Detection/tree/main/parking_ai) — Reference implementation and architectural inspiration

- [PKLot Dataset](https://www.cnrpark.it/dataset/) — Parking lot occupancy dataset used for training the classifiers ([Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/))

- [Image-Based Parking Space Occupancy Classification: Dataset and Baseline](https://github.com/martin-marek/parking-space-occupancy) — Martin Marek ([arXiv:2107.12207](https://arxiv.org/abs/2107.12207)); occupancy-classification dataset and baseline for YOLO training

- Ultralytics YOLO26 — State-of-the-art object detection and classification models

