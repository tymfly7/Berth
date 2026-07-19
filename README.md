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
- [Environment & Secrets (.env)](#environment--secrets-env)
- [Model Comparison](#model-comparison)
- [Common Errors](#common-errors)
- [Docker Deployment](#docker-deployment)
- [Contributing](#contributing)
- [Acknowledgements](#acknowledgements)

> Operator tips, camera/ROI field notes, and hardening recommendations live in
> [OPERATIONS.md](OPERATIONS.md).

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
| 8 Classifier Architectures | CNN from scratch, ResNet-18/50, MobileNetV4 Small/Medium, and per-scale YOLO26 Classify (n/s/m) |
| YOLO26 Detector | Bounding-box vehicle detector used for misparked-vehicle (anomaly) detection |
| Real-Time Detection | Per-camera WebSocket video stream (~20 FPS server / ~15 FPS edge) with slot-wise occupancy overlay |
| ROI Editor | Draw, edit, and manage custom parking slot polygons per camera |
| Orientation Layer | Display-only lot frame (outer perimeter, gates, flow arrows, anchor) drawn in the ROI editor and shown on the lot map |
| Polygon Editing | Vertex drag, edge-midpoint insertion, duplicate, scale, undo/redo |
| Multi-Camera Registry | USB, RTSP, and YouTube sources; one WebSocket feed per camera; cameras can share an ROI config |
| Anomaly Detection | YOLO26 Detect flags misparked vehicles (straddling or outside markings) |
| Public / Admin Views | Public board shows live availability (no auth); Admin dashboard requires server-side password login |
| ROI Proposals | Auto-propose candidate slot regions from an uploaded reference image (optional line-snapping) |
| Lot Map | SVG canvas color-coded by occupancy (vacant = green, occupied = red, misparked = amber) |
| Analytics Chart | Occupancy trend over configurable time ranges (today / day / week / month) |
| Usage Heatmap | Per-slot occupancy frequency heatmap |
| Augmentation Preview | Live preview of training-time augmentations (shadow, night, flip, rotation, jitter) |
| Model Comparison | Train all models, evaluate side-by-side, export to Excel |
| Run History | Timestamped snapshots of past evaluation and training runs, browsable by date/time |
| Edge / Hub Mode | Inference-only edge nodes run NCNN models and sync occupancy/alerts to a central hub |
| Snapshot Mode | Grab one frame every N seconds instead of continuous decode (`BERTH_SNAPSHOT_INTERVAL`) — for weak edge boards |
| Edge Eval CLI | Torch-free on-device benchmark: accuracy, latency, system stats, and PyTorch→NCNN parity |
| SQLite Persistence | Trends, alerts, and training runs stored across restarts |
| Backend Auth | Admin password validated server-side → short-lived signed Bearer token; static `X-API-Key` for machine clients (edge→hub sync) |

---

## Architecture

```
┌────────────────────────────┐
│ Browser                    │
│ /            → PublicView  │   REST poll (30 s) · per-camera WS
│ /admin       → AdminView   │   WebSocket · REST (Bearer token)
│ /admin/docs  → DocsPage    │
└─────────────┬──────────────┘
              │ HTTP / WebSocket
              ▼
┌──────────────────────────────────────────────────────┐
│ FastAPI Backend  (:8001)                             │
│ main.py — app assembly · WebSockets · SPA fallback   │
├──────────────────────────────────────────────────────┤
│ src/api/routers/   inference · analytics · training  │
│                    cameras · roi                     │
│ src/api/           processor_service · deps · ops    │
├──────────────────────────────────────────────────────┤
│ CameraRegistry      multi-source lifecycle           │
│ VideoProcessor      per-camera frame loop            │
│ InferencePool       shared detection workers         │
│ SlotDetector        ROI-crop classification          │
│ ParkingClassifier   CNN · MobileNet · YOLO           │
│ NcnnClassifier      torch-free NCNN (edge)           │
│ ParkingYOLO26       detector (anomaly)               │
│ RoiStore            per-camera ROI JSON              │
│ SyncWorker          edge → hub push (edge)           │
│ SQLite (berth.db)   trends · alerts · runs           │
└──────────────────────────────────────────────────────┘
```

In production (Docker) the backend serves the built frontend from `static/`, so
the whole app runs on a single origin. In local dev, Vite serves the frontend on
`:5173` and talks to the backend on `:8001`.

### Views

| Route | Access | Purpose |
|-------|--------|---------|
| `/` | Public (no auth) | Live availability count, per-lot breakdown, lot map, occupancy trend |
| `/admin` | Login required | Full dashboard: video feed, ROI editor, camera manager, training, settings |
| `/admin/docs` | Login required | In-app documentation page |

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

> **Admin login:** the dashboard requires a password. Set `BERTH_ADMIN_PASSWORD`
> (and ideally `BERTH_AUTH_SECRET`) in `backend/.env` before starting, or admin
> login returns `503`. See [Environment & Secrets](#environment--secrets-env).

> **Port note:** the backend defaults to **8001** (8000 is left free for other
> local services / Docker). Override with `BERTH_PORT`.

---

## Dataset Setup

The CNN / ResNet / MobileNet / YOLO26-classify models are trained on a binary
`occupied` / `vacant` image dataset. The YOLO26 **Detect** model uses a separate
annotated full-scene dataset (`backend/data/labeled/lot-t10lot/yolo_detect_dataset/`).

### Option A: Labeled lot-t10lot dataset (recommended)

The classifier trains on `occupied` / `vacant` slot crops under
`backend/data/labeled/<lot>/`. A labeled set for the **lot-t10lot** lot — cropped
and annotated from the [parking-lot-t10](https://github.com/tomas-fryza/parking-lot-t10)
time-lapse dataset — lives under `backend/data/labeled/lot-t10lot/`:

```
backend/data/labeled/lot-t10lot/
├── crops/{occupied,vacant}/   # cropped slot images → classifier training
├── detector_src/              # full frames + annotations.json
└── yolo_detect_dataset/       # YOLO detect images/labels + dataset.yaml
```

At training time the backend builds a leakage-safe train/val/test split from these
crops into `backend/data/classify_split/{train,val,test}/{occupied,vacant}/`
automatically (split by source frame), so no manual organizing step is needed.

### Option B: Generate sample data (quick testing)

```bash
python -m src.data_prep.downloader --generate-sample --sample-count 500
```

### Option C: Prepare via API

```bash
# Generate synthetic sample data
curl -X POST "http://localhost:8001/api/dataset/prepare?generate_sample=true&sample_count=500"

# Organize from a local source dataset path
curl -X POST "http://localhost:8001/api/dataset/prepare?source=/path/to/dataset"
```

### Option D: Upload images directly from the Admin UI

Go to **Admin > Settings > Model Training** and use the dataset upload form to
label and upload individual images as `occupied` or `vacant`. The **Training
Data** subsection browses on-disk dataset folders and counts.

---

## Training Models

Nine model targets are supported — eight occupancy classifiers plus the detector.
Training is launched from the Admin UI or via REST. Note the naming: the detector
is referred to as `yolo26` at **inference** time and `yolo26_detect` at
**training** time.

| Training ID | Architecture | Notes |
|-------------|-------------|-------|
| `cnn_scratch` | Custom CNN (SE blocks) | Trained from scratch on the binary dataset |
| `resnet18` | ResNet-18 | Transfer learning; lighter ResNet |
| `resnet50` | ResNet-50 | Transfer learning |
| `mobilenetv4s` | MobileNetV4-Small (timm) | Lightweight; default model on edge nodes |
| `mobilenetv4m` | MobileNetV4-Medium (timm) | Higher-capacity MobileNet variant |
| `yolo26n_classify` | YOLO26 Classify (nano) | NMS-free; smallest — targets the Pi Zero 2 W |
| `yolo26s_classify` | YOLO26 Classify (small) | NMS-free, edge-optimized; **default active model** |
| `yolo26m_classify` | YOLO26 Classify (medium) | NMS-free; heaviest classify scale — targets the Pi 5 |
| `yolo26_detect` | YOLO26 Detect (`yolo26s.pt`) | Object detector for anomaly / misparked detection |

The three YOLO26 classify scales share one training path and fine-tune the
ImageNet-pretrained `yolo26{n,s,m}-cls.pt` checkpoint (downloaded on first use).
Pick the scale to match the target edge board — nano for the Pi Zero 2 W, medium
for the Pi 5.

### Train via API

```bash
# Start training a single model
curl -X POST "http://localhost:8001/api/train/start?model_name=cnn_scratch"
curl -X POST "http://localhost:8001/api/train/start?model_name=resnet18"
curl -X POST "http://localhost:8001/api/train/start?model_name=resnet50"
curl -X POST "http://localhost:8001/api/train/start?model_name=mobilenetv4s"
curl -X POST "http://localhost:8001/api/train/start?model_name=mobilenetv4m"
curl -X POST "http://localhost:8001/api/train/start?model_name=yolo26n_classify"
curl -X POST "http://localhost:8001/api/train/start?model_name=yolo26s_classify"
curl -X POST "http://localhost:8001/api/train/start?model_name=yolo26m_classify"
curl -X POST "http://localhost:8001/api/train/start?model_name=yolo26_detect"

# Check training progress
curl http://localhost:8001/api/train/status

# Cancel an in-progress training run
curl -X POST http://localhost:8001/api/train/cancel
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
├── history_<model>.json           # Epoch-level loss + accuracy logs (one per torch classifier)
├── model_comparison.json          # Cross-model metrics (latest evaluate-all)
├── eval_history/                  # Timestamped evaluate-all snapshots (see Run History)
├── train_history/                 # Timestamped per-model training snapshots
├── yolo26s_classify/run/          # YOLO classify training artifacts (one dir per trained scale)
│   ├── results.csv
│   └── weights/best.pt
└── yolo26_detect/run/             # YOLO detect training artifacts
    ├── results.csv
    └── weights/best.pt
```

### Run history

Evaluate-all overwrites `model_comparison.json` and each training run overwrites
its `history_<model>.json`, so only the latest result was ever kept. Every run is
now additionally archived as a timestamped JSON snapshot under
`outputs/eval_history/` and `outputs/train_history/`, so past runs stay browsable
by date/time (via the Admin UI or the history endpoints below). Snapshots are
small, so retention defaults to "keep everything"; cap it with `BERTH_HISTORY_MAX`.

### Training environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BERTH_EPOCHS` | `30` | Max epochs for CNN classifiers |
| `BERTH_YOLO_CLASSIFY_EPOCHS` | `30` | Max epochs for YOLO classify |
| `BERTH_YOLO_DETECT_EPOCHS` | `30` | Max epochs for YOLO detect |
| `BERTH_BATCH_SIZE` | `32` | Batch size |
| `BERTH_LR` | `0.001` | Learning rate |
| `BERTH_SUBSET` | `25000` | CNN subset size (0 = full dataset) |
| `BERTH_WORKERS` | `2` | DataLoader workers |
| `BERTH_CACHE_DATASET` | `1` | Cache decoded/resized images in RAM after first read (`0` to disable) |
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

### Orientation layer

Besides slot ROIs, the editor can draw a display-only **orientation layer** — an
outer perimeter, entry/exit gates, traffic-flow arrows, and an anchor marker. It
is rendered on the lot map (admin and public views) to make the map easier to
read at a glance. The layer is stored separately from the slot ROIs and is never
fed to inference.

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

Proposals are returned for review and are **not** persisted automatically — saving
is a separate step. See [OPERATIONS.md](OPERATIONS.md#roi-editor-workflow) for
when auto-propose works well.

---

## Camera Management

The system supports multiple simultaneous camera sources. Each camera runs its
own `VideoProcessor`; detection work is dispatched to a shared `InferencePool`.

### Supported source types

| Type | Example source |
|------|---------------|
| `usb` | `0` (device index) |
| `rtsp` | `rtsp://user:pass@192.168.1.10/stream` |
| `youtube` | YouTube video URL (resolved to an HLS stream) |

### Connecting a camera

Add a camera from **Admin > Settings > Camera Registry** (or via the API below),
choosing the source type for where the camera physically lives:

| Type | Source value | Notes |
|------|--------------|-------|
| `usb` | device index (`0`, `1`, …) | Read server-side; camera must be on the backend host |
| `rtsp` | `rtsp://user:pass@<camera-ip>:554/<stream-path>` | `<stream-path>` is vendor-specific |
| `youtube` | YouTube live URL | Resolved to an HLS stream, cached `BERTH_YT_CACHE_TTL` s |

A camera's `roi_camera_id` can point at another camera's ROI config to share one
layout across feeds.

**Keeping RTSP credentials out of `cameras.json`** — set the source as an
environment variable named `BERTH_CAM_SOURCE_<CAMERA_ID>` (uppercase, hyphens →
underscores). If present, the registry uses it at runtime and the on-disk config
stays credential-free:

```
# camera id "lot-a-1f3c2d" →
BERTH_CAM_SOURCE_LOT_A_1F3C2D=rtsp://user:pass@192.168.1.10:554/Streaming/Channels/102
```

> Camera selection tips (VLC testing, sub-streams, USB index troubleshooting) are
> in [OPERATIONS.md](OPERATIONS.md#camera-connection-tips).

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

On very weak boards (e.g. the Pi Zero 2 W) set `BERTH_SNAPSHOT_INTERVAL=<seconds>`
to enable **snapshot mode**: the processor grabs a single frame every N seconds
instead of decoding the stream continuously, freeing the CPU for inference.

The **hub** receives those rows via the ingest endpoints (`POST
/api/ingest/occupancy`, `POST /api/ingest/alerts`).

### Exporting models for the edge

Trained models are exported to NCNN (CNN models via `torch.jit.trace` + pnnx,
YOLO models via Ultralytics export). This happens automatically after a
successful training run, or run it manually — via the CLI or the export endpoint:

```bash
cd backend
python export_models.py        # writes *_ncnn_model/ dirs into edge_models/

# Or trigger an export over REST and poll its progress
curl -X POST http://localhost:8001/api/export/ncnn
curl http://localhost:8001/api/export/status
```

Exports land in `backend/edge_models/`. Copy the resulting `*_ncnn_model/`
directories into the edge node's `edge_models/` before its first run — pick the
YOLO26 classify scale that matches the board (nano for the Pi Zero 2 W, medium for
the Pi 5). See [Docker Deployment](#docker-deployment) for the RPi image.

### Evaluating models on the edge

`backend/edge_eval/` benchmarks exported models directly on an edge device —
no FastAPI, torch-free by default — against a crops dataset (`occupied/` +
`vacant/` folders):

| Script | Runs on | Purpose |
|--------|---------|---------|
| `eval_edge.py` | edge / laptop | Classify every crop; writes a timestamped session of `predictions.csv`, `summary.csv` (metrics + latency stats), and `system.csv` (CPU / RAM / temperature / throttling) |
| `run_eval.sh` | edge | Wrapper that stops the `berth` systemd service so the eval gets the full CPU/RAM budget, then restarts it on exit |
| `make_goldens.py` | hub / dev | Run a fixed crop set through the full torch classifier and save golden probabilities |
| `edge_check.py` | edge | Post-deploy smoke check: NCNN model loads + one sane inference (exit 0 = pass) |

```bash
# On the edge device (service auto-stopped / restarted; args passed through)
./edge_eval/run_eval.sh --dataset data/t12lot_subset --model yolo26n_classify

# Direct, e.g. on a dev laptop — pick the runtime to benchmark
python edge_eval/eval_edge.py --dataset data/t12lot_subset --runtime ncnn
python edge_eval/eval_edge.py --dataset data/t12lot_subset --runtime torch

# PyTorch → NCNN conversion drift: goldens on the hub, --parity on the edge
python edge_eval/make_goldens.py --dataset data/t12lot_subset --model yolo26n_classify
python edge_eval/eval_edge.py --dataset data/t12lot_subset \
  --parity eval_results/goldens_yolo26n_classify.json
```

`--runtime` selects the inference backend — `ncnn` (default, torch-free) or
`torch` (imported lazily; for benchmarking the same model with PyTorch on a dev
laptop or Pi 5). Results land in
`backend/eval_results/<device>_<model>_<runtime>_<timestamp>/` (gitignored).

---

## API Reference

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Validate admin password → returns `{token, expires_in}` (Bearer session token); `503` if `BERTH_ADMIN_PASSWORD` is unset, `401` if wrong |

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
| GET | `/api/public/lots` | Per-camera lot geometry + live occupancy for the public board (no auth) |
| GET | `/api/public/trends` | Occupancy trends for the public board (`?range=`, no auth) |
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
| POST | `/api/train/cancel` | Cancel an in-progress training run — server only |
| POST | `/api/evaluate/all` | Evaluate all trained models — server only |
| GET | `/api/eval/datasets` | List datasets available for evaluation |
| GET | `/api/evaluate/excel` | Download comparison as an Excel file (`?file=` for an archived snapshot) |
| POST | `/api/export/ncnn` | Export trained models to NCNN for the edge — server only |
| GET | `/api/export/status` | NCNN export progress |

### Run history

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/eval/history` | List archived evaluation snapshots (`?dataset=`) |
| GET | `/api/eval/history/item` | Fetch one evaluation snapshot (`?file=`) |
| GET | `/api/train/history` | List archived training snapshots (`?model=`) |
| GET | `/api/train/history/item` | Fetch one training snapshot (`?file=`) |

### ROI management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/roi/{camera_id}` | Get saved ROIs for a camera |
| POST | `/api/roi/{camera_id}` | Save ROIs for a camera |
| GET | `/api/roi/{camera_id}/orientation` | Get the display-only orientation layer (perimeter / gates / flow / anchor) |
| POST | `/api/roi/{camera_id}/orientation` | Save the orientation layer |
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
| POST | `/api/dataset/prepare` | Organize a source dataset or generate a sample dataset |

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
│   ├── .env                             # Local secrets (gitignored) — loaded by config.py
│   ├── requirements.txt                 # Full server deps
│   ├── requirements.edge.txt            # Slim edge deps (used by Dockerfile.rpi)
│   ├── train_all.py                     # CLI: train all models in sequence
│   ├── export_models.py                 # CLI: export trained models to NCNN for edge
│   ├── verify.py                        # CLI: environment / structure sanity check
│   ├── edge_eval/                       # On-device eval pipeline (see Edge / Hub Deployment)
│   │   ├── eval_edge.py                 # Torch-free eval CLI (accuracy + latency + system CSVs)
│   │   ├── make_goldens.py              # Hub-side torch goldens for NCNN parity checks
│   │   ├── edge_check.py                # Post-deploy model load / inference smoke check
│   │   └── run_eval.sh                  # Stops/restarts the berth service around a run
│   ├── berth.db                         # SQLite — trends, alerts, training runs
│   ├── models/                          # Trained weights (*.pth / *.pt)
│   ├── edge_models/                     # NCNN exports (*_ncnn_model/ dirs) for edge deployment
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
│   │   │   ├── downloader.py            # dataset organizer + sample generator
│   │   │   └── yolo_converter.py        # Build YOLO detect dataset from annotations
│   │   ├── models/
│   │   │   ├── cnn_scratch.py           # Custom CNN architecture
│   │   │   ├── cnn_transfer.py          # ResNet-50 + MobileNetV4-Small via transfer learning
│   │   │   ├── model_factory.py         # Model creation factory
│   │   │   ├── yolo_detector.py         # YOLO26 detect wrapper (ParkingYOLO26)
│   │   │   └── yolo_detector_ncnn.py    # Torch-free NCNN detect wrapper (ARM64 edge)
│   │   ├── train/
│   │   │   ├── trainer.py               # Training loop + early stopping
│   │   │   └── train_manager.py         # Background training + evaluation
│   │   ├── eval/
│   │   │   ├── evaluator.py             # Metrics computation
│   │   │   ├── history_store.py         # Timestamped eval/train run snapshots
│   │   │   └── visualizer.py            # Loss / accuracy plots
│   │   ├── inference/
│   │   │   ├── classifier.py            # Torch-free classifier dispatcher (profile → backend)
│   │   │   ├── torch_classifier.py      # ParkingClassifier — full torch path (server)
│   │   │   ├── ncnn_classifier.py       # NCNN edge classifier (ARM64)
│   │   │   ├── inference_pool.py        # Shared detection worker pool
│   │   │   ├── slot_detector.py         # ROI-crop occupancy detection
│   │   │   ├── video_processor.py       # Per-camera frame loop + metrics
│   │   │   ├── parking_geometry.py      # Slot/vehicle overlap logic (anomaly)
│   │   │   └── roi_proposer.py          # Auto-propose candidate ROI polygons
│   │   ├── roi/
│   │   │   ├── roi_store.py             # Read/write per-camera ROI JSON + snapshots
│   │   │   └── roi_crop.py              # Shared ROI crop logic (training + both inference paths)
│   │   ├── cameras/
│   │   │   ├── camera_registry.py       # Multi-camera lifecycle management
│   │   │   └── youtube_resolver.py      # YouTube watch URL → cached HLS stream
│   │   ├── export/model_exporter.py     # Export models to NCNN
│   │   ├── sync/sync_worker.py          # Edge → hub occupancy/alert push
│   │   ├── reports/model_report.py      # Comparison Excel + training detail loader
│   │   └── db/database.py               # SQLite helpers (trends, alerts, runs, ingest)
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
│   │   │   ├── AdminView.jsx            # Full operator dashboard (login-gated)
│   │   │   ├── DocsPage.jsx             # In-app documentation
│   │   │   └── NotFoundPage.jsx         # 404
│   │   ├── components/
│   │   │   ├── PinGate.jsx              # Login form; password verified server-side via /api/auth/login
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
│   │   │   ├── RoiToolbar.jsx           # ROI editor toolbar (tools, layers, save/discard)
│   │   │   ├── roiDraw.js               # Pure canvas draw pass for the editor scene
│   │   │   ├── roiGeometry.js           # Polygon geometry + color helpers (hit-testing, centroids)
│   │   │   ├── CameraManager.jsx        # Add / activate / remove cameras
│   │   │   ├── ControlPanel.jsx         # Video source switcher + model selector
│   │   │   ├── TrainingPanel.jsx        # Dataset upload + training controls
│   │   │   ├── DataAugmentPanel.jsx     # Augmentation preview controls
│   │   │   ├── ModelStatus.jsx          # Per-model availability + metrics summary
│   │   │   ├── AnomalyPanel.jsx         # Anomaly detection toggle + sensitivity
│   │   │   ├── OccupancyPanel.jsx       # Occupancy threshold control
│   │   │   ├── SettingsPanel.jsx        # Collapsible wrapper for all settings
│   │   │   └── ServerStatus.jsx         # Backend operation/connectivity indicator
│   │   ├── utils/roiUtils.js            # ROI → slot helpers
│   │   └── tests/                       # Vitest component tests
│   ├── index.html
│   └── vite.config.js
├── configs/
│   └── model_configs.yaml
├── Dockerfile                           # Server image (frontend build + Python backend)
├── Dockerfile.rpi                       # ARM64 / Raspberry Pi edge image
├── docker-compose.yml                   # Server stack (127.0.0.1:9000 → 8000)
├── docker-compose.rpi.yml               # Raspberry Pi edge node (8001 → 8000)
├── .env_edge                            # Secrets template for compose (gitignored)
├── OPERATIONS.md                        # Operator tips, field notes, hardening
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
| `BERTH_ADMIN_PASSWORD` | _(empty — login returns 503)_ | Admin password, validated server-side by `/api/auth/login` |
| `BERTH_AUTH_SECRET` | _(random per start)_ | Signing key for session tokens; set it to keep logins valid across restarts |
| `BERTH_AUTH_TTL` | `315360000` | Admin session token lifetime in seconds (~10 years by default, so local logins don't expire; lower it for network-facing deployments) |
| `BERTH_API_KEY` | _(empty — static-key path open)_ | Static service key (`X-API-Key`) for machine clients (edge→hub sync) + WS token |
| `BERTH_ALLOWED_ORIGIN` | _(empty)_ | Extra explicit CORS origin (LAN ranges allowed by default) |
| `BERTH_UPLOAD_RATE_LIMIT` | `10/minute` | Rate limit on upload endpoints |
| `BERTH_MODEL` | `yolo26s_classify` | Default active model on startup |
| `BERTH_DB_PATH` | `backend/berth.db` | SQLite database path |
| `BERTH_DEPLOYMENT` | `server` | `server` (full) or `edge` (inference-only) |
| `BERTH_EDGE_HUB_URL` | _(empty)_ | Hub URL for edge→hub sync (edge profile only) |
| `BERTH_INFERENCE_WORKERS` | `min(cpu-1, 4)` | Shared inference pool worker count |
| `BERTH_MAX_ACTIVE_CAMERAS` | `8` server / `2` edge | Max cameras allowed active at once |
| `BERTH_OCCUPANCY_THRESHOLD` | `0.40` | YOLO-classify "occupied" decision threshold |
| `BERTH_INFER_FPS` | `8` server / `4` edge | Inference rate, decoupled from stream FPS |
| `BERTH_NCNN_THREADS` | `1` server / `3` edge | Cores one NCNN inference spreads across (keep workers × threads within the core count) |
| `BERTH_SNAPSHOT_INTERVAL` | `0` | Snapshot mode: grab one frame every N seconds instead of continuous decode (`0` = off) — for weak edge boards |
| `BERTH_ANOMALY_FPS` | `0.2` | Anomaly (YOLO detect) pass cadence — one pass every 5 s by default |
| `BERTH_HISTORY_MAX` | `0` | Max run-history snapshots kept per dataset/model (`0` = keep all) |
| `BERTH_API_THREADS` | `8` edge / `0` server | Cap on the anyio threadpool for sync endpoints (`0` = anyio default) |
| `BERTH_CAPTURE_DIR` | `~/berth_captures` | Base directory for per-camera data-gathering captures |
| `BERTH_CAPTURE_INTERVAL` | `600` | Seconds between capture frames when a camera has gathering enabled |
| `BERTH_YT_CACHE_TTL` | `240` | YouTube HLS URL cache lifetime (seconds) |
| `BERTH_RELOAD` | `0` | Set `1` to enable uvicorn auto-reload (dev) |
| `BERTH_CAM_SOURCE_<ID>` | _(empty)_ | Per-camera runtime source override (keeps credentials off disk) |

Training-specific variables are listed under [Training Models](#training-models).

### Deployment-dependent stream settings

| Setting | Server | Edge |
|---------|--------|------|
| Frame size | 1280×720 | 960×540 |
| Stream FPS | 20 | 15 |
| Inference FPS | 8 | 4 |
| JPEG quality | 80 | 90 |

### Alert thresholds

| Level | Occupancy |
|-------|-----------|
| Info | ≥ 70% |
| Warning | ≥ 85% |
| Critical | ≥ 95% |

### Authentication

All authentication is handled by the backend; the frontend holds no secrets.

- **Admin login.** The `/admin` password is sent to `POST /api/auth/login`, which
  compares it (constant-time) against `BERTH_ADMIN_PASSWORD`. On success the
  backend returns a short-lived HMAC-signed Bearer token (signed with
  `BERTH_AUTH_SECRET`, valid `BERTH_AUTH_TTL` seconds). The frontend sends it as
  `Authorization: Bearer <token>` on REST calls and as `?token=` on the admin
  WebSocket. If `BERTH_ADMIN_PASSWORD` is unset, login returns `503` and the
  dashboard is unreachable.
- **Service key.** Protected endpoints also accept a static `X-API-Key` equal to
  `BERTH_API_KEY`. This is for machine-to-machine clients — chiefly the edge→hub
  sync worker — not the browser. When `BERTH_API_KEY` is empty, the static-key
  path is open (any request without a valid Bearer token still passes); set it for
  network-facing deployments.
- **Public endpoints** (`/api/public/*`) require no auth, so the public board
  works without logging in. They expose whitelisted fields only — never camera
  sources or credentials.
- **CORS** allows localhost and private LAN ranges by default; add a public origin
  with `BERTH_ALLOWED_ORIGIN`.

For hardening recommendations (TLS, strong secrets) see
[OPERATIONS.md](OPERATIONS.md#security-hardening).

---

## Environment & Secrets (.env)

There are **two separate `.env` mechanisms** — don't confuse them:

| File | Used by | When it's read |
|------|---------|----------------|
| `backend/.env` | bare-metal `python main.py` | Loaded by `python-dotenv` in `config.py` at startup |
| `.env` in the compose dir (project root) | `docker compose` | Interpolated into `${BERTH_*}` placeholders in the compose files, then passed to the container |

All `.env*` files are **gitignored** (`.env`, `frontend/.env`, `.env_edge`) — they
hold secrets and must never be committed. `.env_edge` (project root) is a tracked-
*intent*, untracked-*content* template you copy to `.env` and fill in.

### Bare-metal: `backend/.env`

```ini
# backend/.env
BERTH_ADMIN_PASSWORD=choose-a-strong-pin     # REQUIRED — without it admin login returns 503
BERTH_AUTH_SECRET=paste-a-long-random-string # keeps login tokens valid across restarts
BERTH_API_KEY=                               # only needed for machine clients (edge→hub sync)
```

### Docker: compose-dir `.env`

Compose reads variables for `${BERTH_API_KEY:-}`, `${BERTH_ADMIN_PASSWORD:-}`, and
`${BERTH_AUTH_SECRET:-}` from a `.env` next to the compose file (the project root)
or from your shell. Copy the template and fill it in:

```bash
cp .env_edge .env        # then edit .env with real values
docker compose -f docker-compose.rpi.yml up -d
```

To keep the template under a different name, point compose at it explicitly:

```bash
docker compose --env-file .env_edge -f docker-compose.rpi.yml up -d
```

`frontend/.env` no longer holds any secret — the browser authenticates with the
session token from login, so there is nothing to bake into the bundle.

---

## Model Comparison

| Model | Type | Params | Notes |
|-------|------|--------|-------|
| CNN Scratch | Classifier | ~1.5 M | Trained from scratch (SE blocks) |
| ResNet-18 | Classifier | ~11 M | Transfer learning; lighter ResNet |
| ResNet-50 | Classifier | ~25 M | Transfer learning |
| MobileNetV4-Small | Classifier | ~3 M | Lightweight; default on edge nodes |
| MobileNetV4-Medium | Classifier | ~10 M | Higher-capacity MobileNet variant |
| YOLO26 Classify (n/s/m) | Classifier | — | NMS-free, per-scale; `yolo26s_classify` is the default active model |
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
| YOLO26 weights not found | Train `yolo26_detect` / `yolo26{n,s,m}_classify` via the Training panel first |
| Anomaly detection 400 error | YOLO26 Detect weights are missing — train it first |
| Training/evaluation 403 | The node is in `edge` profile — use the hub server |
| YouTube stream errors | URL may have expired; HLS URLs are cached for `BERTH_YT_CACHE_TTL` seconds |
| Rate limit exceeded | Wait a minute or raise `BERTH_UPLOAD_RATE_LIMIT` |

---

## Docker Deployment

Both images build the frontend and serve it from `static/`, so the whole app is
reachable on a single origin/port. **Inside every container the backend listens on
`8000`** (the `8001` default applies only to bare-metal `python main.py`).

Secrets are passed as container env, never baked into the image. With compose,
`${BERTH_*}` placeholders are interpolated from a `.env` file **in the compose
directory** (the project root) or from your shell — this is a *different* file from
`backend/.env`. See [Environment & Secrets](#environment--secrets-env).

### 1. Server, on a normal machine (x86-64)

```bash
# Build the image
docker build -t berth:1.0 .

# Run it directly (host 8000 → container 8000)
docker run -p 8000:8000 \
  -e BERTH_ADMIN_PASSWORD=your-pin \
  -e BERTH_AUTH_SECRET=your-long-random-string \
  berth:1.0

# Or with compose (reads ./.env; publishes 127.0.0.1:9000 → 8000)
docker compose up -d --build
```

`docker-compose.yml` binds to `127.0.0.1:9000`, so the app is reachable at
`http://localhost:9000` and not exposed on the network — put a reverse proxy in
front for remote access. It bind-mounts `backend/{data,models,outputs,uploads}` so
datasets, weights, and runs persist on the host.

### 2. Edge node, on a Raspberry Pi (ARM64)

The edge image (`Dockerfile.rpi`) installs CPU-only torch, runs the `edge` profile
(inference-only), and reads camera `/dev/video0` plus persistent volumes for the
SQLite DB and ROI/camera config.

```bash
# On the Pi — build locally and start (host 8001 → container 8000)
docker compose -f docker-compose.rpi.yml up -d --build
```

The app is then reachable at `http://<pi-ip>:8001`. Required env (set via the
compose `.env`): `BERTH_ADMIN_PASSWORD` (else login → `503`); recommended:
`BERTH_AUTH_SECRET`, `BERTH_API_KEY`, and `BERTH_EDGE_HUB_URL` to point the node at
the hub. Pre-populate `backend/edge_models/` with the exported `*_ncnn_model/`
directories (see [Edge / Hub Deployment](#edge--hub-deployment)) before the first
run.

### 3. Baking the edge image on x86 and shipping it to the Pi

Building on the Pi is slow. Cross-compile on a faster x86 machine, save the image
to a tarball, copy it over, and load it on the Pi:

```bash
# On the x86 build machine — cross-compile for ARM64
docker buildx build --platform linux/arm64 \
  -t berth-rpi:latest -f Dockerfile.rpi . --load

# Save the image to a compressed tarball
docker save berth-rpi:latest | gzip > berth-rpi.tar.gz

# Copy it to the Pi
scp berth-rpi.tar.gz pi@raspberrypi.local:~/

# On the Pi — load the image, then start with the prebuilt image
docker load < berth-rpi.tar.gz
docker compose -f docker-compose.rpi.yml up -d   # no --build: uses the loaded image
```

`docker-compose.rpi.yml` references `image: berth-rpi:latest`, so once the image is
loaded the compose run picks it up without rebuilding. (Native build on the Pi —
`docker build -t berth-rpi:latest -f Dockerfile.rpi .` — also works, just slower.)

> The `.tar`/`.tar.gz` artifacts are gitignored; don't commit them. Rebuild after
> any frontend/backend change so the image isn't stale.

---

## Contributing

Branch off `main`, run the checks below, and open a PR against `main`. CI
(`.github/workflows/ci.yml`) runs the same three jobs — all must be green.

```bash
git checkout -b feature/your-change
```

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

Contribution etiquette (scope, docs, when to open an issue first) is in
[OPERATIONS.md](OPERATIONS.md#contributing-etiquette).

---

## Acknowledgements
- [AI-Parking-Lot-Detection](https://github.com/Nandini60/AI-Parking-Lot-Detection/tree/main/parking_ai) — Reference implementation and architectural inspiration

- [parking-lot-t10](https://github.com/tomas-fryza/parking-lot-t10) — Tomas Fryza — time-lapse parking lot (lot T10) dataset used to build the occupied/vacant classifier crops and the YOLO detect set

- Ultralytics YOLO26 — State-of-the-art object detection and classification models

