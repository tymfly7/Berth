# Berth

AI-powered real-time parking detection using Computer Vision and Deep Learning.
Monitors parking occupancy via live camera or video, draws custom slot regions,
detects misparked vehicles, and surfaces everything through a two-view dashboard.

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
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Model Comparison](#model-comparison)
- [Common Errors](#common-errors)
- [Docker Deployment](#docker-deployment)
- [License](#license)
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
| 5 Model Architectures | CNN from scratch, ResNet-50, MobileNetV4, YOLO26 Classify, YOLO26 Detect |
| Real-Time Detection | WebSocket video stream at ~20 FPS with slot-wise occupancy overlay |
| ROI Editor | Draw, edit, and manage custom parking slot polygons per camera |
| Polygon Editing | Vertex drag, edge-midpoint insertion, duplicate, scale, undo/redo |
| Multi-Camera Registry | USB, RTSP, and YouTube stream sources; per-camera WebSocket feeds |
| Anomaly Detection | YOLO26 Detect flags misparked vehicles (straddling or outside markings) |
| Public / Admin Views | Public view shows live availability; Admin view is PIN-protected |
| ROI Proposals | Auto-propose candidate slot regions from an uploaded reference image |
| Lot Map | SVG canvas color-coded by occupancy (vacant = green, occupied = red, misparked = amber) |
| Analytics Chart | Occupancy trend over configurable time ranges (day / week / month) |
| Usage Heatmap | Per-slot occupancy frequency heatmap |
| Alerts System | Configurable thresholds (info 70%, warning 85%, critical 95%) |
| Model Comparison | Train all models, evaluate side-by-side, export to Excel |
| SQLite Persistence | Trends, alerts, and training runs stored across restarts |
| API Key Auth | Optional header auth (`X-API-Key`) for production |

---

## Architecture

```
┌─────────────────────────────┐
│   Browser                   │
│  /          → PublicView    │  REST polling (8 s interval)
│  /admin     → AdminView     │  WebSocket + REST
└────────────┬────────────────┘
             │ HTTP / WebSocket
             ▼
┌─────────────────────────────┐
│   FastAPI Backend (: 8000)  │
│   main.py  +  config.py     │
├─────────────────────────────┤
│  VideoProcessor             │  Frame loop per camera
│  CameraRegistry             │  Multi-source management
│  RoiStore                   │  Per-camera ROI JSON files
│  ParkingClassifier          │  CNN / MobileNet / YOLO classify
│  ParkingYOLO26              │  YOLO detect (anomaly)
│  SQLite (berth.db)      │  Trends, alerts, training runs
└─────────────────────────────┘
```

### Views

| Route | Access | Purpose |
|-------|--------|---------|
| `/` | Public | Live availability count, lot map, occupancy chart |
| `/admin` | PIN-gated | Full dashboard: video feed, ROI editor, camera manager, training panel, settings |

---

## Quick Start

### Prerequisites

- Python 3.10+
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
# API available at http://localhost:8000
```

**Terminal 2 — Frontend:**
```bash
cd "School Project/frontend"
npm run dev
# Dashboard at http://localhost:5173
```

Open `http://localhost:5173` for the public view, or `http://localhost:5173/admin` for the admin dashboard.

---

## Dataset Setup

The CNN/ResNet/MobileNet classifiers are trained on a binary `occupied` / `vacant` image dataset. YOLO26 Detect uses a separate annotated dataset.

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

### Option C: Upload via API

```bash
# Generate synthetic sample data
curl -X POST "http://localhost:8000/api/dataset/prepare?generate_sample=true&sample_count=500"

# Organize from a local PKLot path
curl -X POST "http://localhost:8000/api/dataset/prepare?source=D:/datasets/PKLotSegmented"
```

### Option D: Upload images directly from the Admin UI

Go to **Admin > Settings > Training** and use the dataset upload form to label and upload individual images as `occupied` or `vacant`.

---

## Training Models

Five model architectures are supported. Training is launched from the Admin UI or via REST.

| Model ID | Architecture | Notes |
|----------|-------------|-------|
| `cnn_scratch` | Custom CNN | Trained from scratch on the binary dataset |
| `resnet50` | ResNet-50 | Transfer learning, final layers fine-tuned |
| `mobilenetv4` | MobileNetV4 | Lightweight, fastest inference |
| `yolo26_classify` | YOLO26 Classify | NMS-free, edge-optimized; default active model |
| `yolo26_detect` | YOLO26 Detect | Object detector for anomaly / misparked vehicle detection |

### Train via API

```bash
# Start training a single model
curl -X POST "http://localhost:8000/api/train/start?model_name=cnn_scratch"
curl -X POST "http://localhost:8000/api/train/start?model_name=resnet50"
curl -X POST "http://localhost:8000/api/train/start?model_name=mobilenetv4"
curl -X POST "http://localhost:8000/api/train/start?model_name=yolo26_classify"
curl -X POST "http://localhost:8000/api/train/start?model_name=yolo26_detect"

# Check training progress
curl http://localhost:8000/api/train/status
```

### Evaluate all models and export comparison

```bash
# Run evaluation across all trained models
curl -X POST http://localhost:8000/api/evaluate/all

# Download Excel report
curl -o comparison.xlsx http://localhost:8000/api/evaluate/excel
```

### Training outputs (saved to `backend/outputs/`)

```
outputs/
├── history_cnn_scratch.json       # Epoch-level loss + accuracy logs
├── history_resnet50.json
├── history_mobilenetv4.json
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
| `BERTH_EPOCHS` | `30` | Max epochs for CNN models |
| `BERTH_YOLO_DETECT_EPOCHS` | `100` | Max epochs for YOLO detect |
| `BERTH_BATCH_SIZE` | `32` | Batch size |
| `BERTH_LR` | `0.001` | Learning rate |
| `BERTH_SUBSET` | `12000` | Subset size (0 = full dataset) |
| `BERTH_WORKERS` | `2` | DataLoader workers |
| `BERTH_YOLO_CLASSIFY_IMGSZ` | `64` | Input size for YOLO classify |

---

## ROI Editor

The ROI (Region of Interest) editor lets you define custom parking slot polygons directly on a reference image snapshot. ROIs are stored per camera and used for both occupancy classification and anomaly detection.

### How to use

1. Go to **Admin > Settings > Camera Manager** and activate a camera.
2. Open the **ROI Editor** tab.
3. Upload a reference snapshot from the live feed.
4. Draw slot polygons using **Polygon** or **Rectangle** draw mode.
5. Save — ROIs are stored in `backend/data/roi_configs/<camera_id>.json`.

### Editing tools

| Tool | Action |
|------|--------|
| Polygon | Click to place vertices; double-click to close |
| Rectangle | Click-drag to draw a rectangular slot |
| Edit | Drag vertices (white circles) or edge midpoints (white squares) to reshape; drag inside polygon to translate |
| Duplicate | Copy selected ROI with a 2% offset |
| Scale +/- | Resize selected polygon ±10% around its centroid |
| Undo / Redo | Ctrl+Z / Ctrl+Y |
| Delete | Delete key removes the selected ROI |

### Auto-propose ROIs

The backend can auto-detect candidate slot regions from an uploaded image:

```bash
curl -X POST "http://localhost:8000/api/roi/default/propose" \
  -F "file=@parking_lot_snapshot.jpg"
```

Proposals are based on vehicle detections (occupied spots). Review and edit all proposals before saving — empty spots may be missed.

---

## Camera Management

The system supports multiple simultaneous camera sources. Each camera runs its own `VideoProcessor` with its own ROI configuration.

### Supported source types

| Type | Example source |
|------|---------------|
| `usb` | `0` (device index) |
| `rtsp` | `rtsp://user:pass@192.168.1.10/stream` |
| `youtube` | YouTube video URL (resolved to HLS stream) |

### Connecting a camera

Pick the source type based on where the camera physically lives.

**USB — camera wired into the backend machine**

OpenCV reads the device **server-side**, so the camera must be plugged into the host running the backend (not the laptop where you open the browser).

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

Paste a YouTube live URL; the backend resolves it to an HLS stream (cached for `BERTH_YT_CACHE_TTL` seconds).

**Keeping RTSP credentials out of `cameras.json`**

Instead of saving the password in the stored source, set it as an environment variable named `BERTH_CAM_SOURCE_<CAMERA_ID>` (uppercase, hyphens → underscores). If present, the registry uses it at runtime and the on-disk config stays credential-free.

```
# camera id "lot-a-1f3c2d" →
BERTH_CAM_SOURCE_LOT_A_1F3C2D=rtsp://user:pass@192.168.1.10:554/Streaming/Channels/102
```

### Manage cameras via API

```bash
# List cameras
curl http://localhost:8000/api/cameras

# Add a camera
curl -X POST http://localhost:8000/api/cameras \
  -H "Content-Type: application/json" \
  -d '{"name": "Lot A", "source": "0", "type": "usb"}'

# Activate / deactivate
curl -X POST http://localhost:8000/api/cameras/<camera_id>/activate
curl -X POST http://localhost:8000/api/cameras/<camera_id>/deactivate

# Remove
curl -X DELETE http://localhost:8000/api/cameras/<camera_id>
```

Each active camera streams via its own WebSocket at `/ws/cameras/<camera_id>`.

---

## Anomaly Detection

When enabled, the system uses the YOLO26 Detect model to identify vehicles parked outside designated slot boundaries.

### Enable via UI

Admin > Settings > Anomalies > toggle ON

### Enable via API

```bash
curl -X POST http://localhost:8000/api/settings/anomaly \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

### Classification logic

| Status | Condition |
|--------|-----------|
| `ok` | Vehicle center falls inside exactly one ROI polygon |
| `straddling` | Vehicle bounding box overlaps more than one ROI |
| `outside_markings` | Vehicle detected but center is outside all ROI polygons |

Misparked vehicles are highlighted in orange on the video feed and lot map. The Misparked count appears as an additional metric card in the Admin dashboard.

Requires the YOLO26 Detect model (`backend/models/best_yolo26_detect.pt`) to be trained first.

---

## API Reference

### Core

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Service info |
| GET | `/api/health` | Health check + active model |
| GET | `/api/status` | Active background operations |

### Metrics and data

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/public/metrics` | Occupancy metrics (no auth) |
| GET | `/api/metrics` | Occupancy metrics (auth) |
| GET | `/api/heatmap` | Usage heatmap for active camera |
| GET | `/api/heatmap/{camera_id}` | Heatmap for a specific camera |
| GET | `/api/history` | Historical occupancy records |
| GET | `/api/trends` | Occupancy trends (`?range=day|week|month`) |
| GET | `/api/alerts` | Recent alerts |

### Prediction and analysis

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/predict` | Classify a single spot image |
| POST | `/api/analyze-lot` | Grid-based analysis of a full lot image |
| POST | `/api/analyze-roi` | ROI-polygon-based analysis of a lot image |
| POST | `/api/analyze-misparked` | Detect misparked vehicles in an image |

### Video and cameras

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload-video` | Upload a video file as source |
| POST | `/api/use-camera` | Switch default processor to webcam |
| GET | `/api/cameras` | List all cameras |
| POST | `/api/cameras` | Register a new camera |
| DELETE | `/api/cameras/{id}` | Remove a camera |
| POST | `/api/cameras/{id}/activate` | Start streaming from camera |
| POST | `/api/cameras/{id}/deactivate` | Stop camera stream |
| WS | `/ws/video` | Default video stream (frames + metrics) |
| WS | `/ws/cameras/{camera_id}` | Per-camera video stream |

### Models and training

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/model/info` | Available models + dataset stats + comparison |
| POST | `/api/use-model/{name}` | Switch active model |
| POST | `/api/train/start` | Start training (`?model_name=...`) |
| GET | `/api/train/status` | Training progress |
| POST | `/api/evaluate/all` | Evaluate all trained models |
| GET | `/api/evaluate/excel` | Download comparison as Excel file |
| GET | `/api/training-runs` | Training run history |

### ROI management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/roi/{camera_id}` | Get saved ROIs for a camera |
| POST | `/api/roi/{camera_id}` | Save ROIs for a camera |
| DELETE | `/api/roi/{camera_id}/{roi_id}` | Delete a single ROI |
| DELETE | `/api/roi/{camera_id}` | Delete all ROIs for a camera |
| GET | `/api/roi/{camera_id}/snapshot` | Get reference snapshot |
| POST | `/api/roi/{camera_id}/snapshot` | Upload reference snapshot |
| POST | `/api/roi/{camera_id}/propose` | Auto-propose candidate ROIs |

### Dataset

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/dataset/upload` | Upload labeled training images |
| POST | `/api/dataset/prepare` | Organize PKLot or generate sample dataset |

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings/anomaly` | Get anomaly detection state |
| POST | `/api/settings/anomaly` | Enable / disable anomaly detection |

---

## Project Structure

```
School Project/
├── backend/
│   ├── main.py                         # FastAPI app, all endpoints
│   ├── config.py                        # Centralized config (paths, env vars)
│   ├── requirements.txt
│   ├── train_all.py                     # CLI: train all models in sequence
│   ├── spots_config.json                # Legacy slot coordinates (superseded by ROI store)
│   ├── berth.db                     # SQLite — trends, alerts, training runs
│   ├── models/
│   │   ├── best_cnn_scratch.pth
│   │   ├── best_resnet50.pth
│   │   ├── best_mobilenetv4.pth
│   │   ├── best_yolo26_classify.pt
│   │   └── best_yolo26_detect.pt
│   ├── src/
│   │   ├── data_prep/
│   │   │   ├── dataset.py               # PyTorch Dataset + augmentation
│   │   │   ├── preprocessor.py          # Train/val/test split + DataLoaders
│   │   │   └── downloader.py            # PKLot organizer + sample generator
│   │   ├── models/
│   │   │   ├── cnn_scratch.py           # Custom CNN architecture
│   │   │   ├── cnn_transfer.py          # ResNet-50 + MobileNetV4 via transfer learning
│   │   │   ├── model_factory.py         # Model creation factory
│   │   │   └── yolo_detector.py         # YOLO26 detect wrapper (ParkingYOLO26)
│   │   ├── train/
│   │   │   ├── trainer.py               # Training loop + early stopping
│   │   │   └── train_manager.py         # Background training + evaluation
│   │   ├── eval/
│   │   │   ├── evaluator.py             # Metrics computation
│   │   │   └── visualizer.py            # Loss / accuracy plots
│   │   ├── inference/
│   │   │   ├── classifier.py            # ParkingClassifier (all CNN + YOLO classify models)
│   │   │   ├── video_processor.py       # Frame loop: classify slots, stream results
│   │   │   ├── parking_geometry.py      # Slot/vehicle overlap logic for anomaly detection
│   │   │   └── roi_proposer.py          # Auto-propose candidate ROI polygons
│   │   ├── roi/
│   │   │   └── roi_store.py             # Read/write per-camera ROI JSON configs
│   │   ├── cameras/
│   │   │   └── camera_registry.py       # Multi-camera lifecycle management
│   │   ├── db/
│   │   │   └── database.py              # SQLite helpers (trends, alerts, training runs)
│   │   └── utils/
│   │       └── helpers.py
│   ├── data/                            # Training images (occupied / vacant)
│   ├── outputs/                         # Training logs, plots, YOLO run artifacts
│   └── uploads/                         # User-uploaded video files
├── frontend/
│   ├── src/
│   │   ├── App.jsx                      # Router: / → PublicView, /admin → AdminView
│   │   ├── App.css                      # Design system (CSS variables, glass cards)
│   │   ├── pages/
│   │   │   ├── PublicView.jsx           # Public availability display (no auth)
│   │   │   └── AdminView.jsx            # Full operator dashboard (PIN-gated)
│   │   └── components/
│   │       ├── PinGate.jsx              # PIN prompt protecting /admin
│   │       ├── Header.jsx               # App header + connection indicator
│   │       ├── VideoFeed.jsx            # WebSocket video frame display
│   │       ├── MetricCards.jsx          # Total / available / occupied / misparked cards
│   │       ├── LotMap.jsx               # SVG polygon lot map, color-coded by status
│   │       ├── AnalyticsChart.jsx       # Recharts occupancy trend chart
│   │       ├── HeatmapView.jsx          # Per-slot usage heatmap
│   │       ├── ConfidenceGauge.jsx      # Average confidence arc gauge
│   │       ├── RoiEditor.jsx            # Full polygon ROI drawing + editing canvas
│   │       ├── RoiManager.jsx           # ROI list, labels, spot types, save/discard
│   │       ├── CameraManager.jsx        # Add / activate / remove cameras
│   │       ├── MultiCameraGrid.jsx      # Grid of CameraFeedCell for active cameras
│   │       ├── CameraFeedCell.jsx       # Single camera WebSocket feed tile
│   │       ├── ControlPanel.jsx         # Video source switcher + model selector
│   │       ├── TrainingPanel.jsx        # Dataset upload + training controls
│   │       ├── ModelStatus.jsx          # Per-model availability + metrics summary
│   │       ├── AnomalyPanel.jsx         # Anomaly detection toggle
│   │       ├── SettingsPanel.jsx        # Collapsible wrapper for all settings
│   │       ├── AlertBanner.jsx          # Occupancy threshold alert display
│   │       └── ServerStatus.jsx         # Backend connectivity indicator
│   ├── index.html
│   └── vite.config.js
├── configs/
│   └── model_configs.yaml
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## Configuration

All settings are centralized in `backend/config.py` and can be overridden via environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `BERTH_HOST` | `0.0.0.0` | Backend bind host |
| `BERTH_PORT` | `8000` | Backend port |
| `BERTH_API_KEY` | _(empty — auth off)_ | API key for protected endpoints |
| `BERTH_UPLOAD_RATE_LIMIT` | `10/minute` | Rate limit on upload endpoints |
| `BERTH_MODEL` | `yolo26_classify` | Default active model on startup |
| `PKLOT_ROOT` | _(empty)_ | Path to downloaded PKLot dataset |
| `BERTH_EPOCHS` | `30` | CNN training epochs |
| `BERTH_YOLO_DETECT_EPOCHS` | `100` | YOLO detect training epochs |
| `BERTH_BATCH_SIZE` | `32` | Training batch size |
| `BERTH_LR` | `0.001` | Learning rate |
| `BERTH_SUBSET` | `12000` | Training subset size (0 = all) |
| `BERTH_WORKERS` | `2` | DataLoader worker threads |
| `BERTH_YT_CACHE_TTL` | `240` | YouTube HLS URL cache lifetime (seconds) |

### Alert thresholds

| Level | Occupancy |
|-------|-----------|
| Info | >= 70% |
| Warning | >= 85% |
| Critical | >= 95% |

### Security model & limitations

Auth is intentionally coarse: a single shared `BERTH_API_KEY` gates every
protected REST endpoint and the WebSocket stream (there is no per-user identity,
roles, or audit trail). The `/admin` PIN gate is a client-side convenience, not
a security boundary — the API key is what actually protects the backend. When
`BERTH_API_KEY` is empty, **all** protected endpoints are open. Set it (and serve
over TLS via a reverse proxy) before any network-facing deployment.

---

## Model Comparison

| Model | Type | Params | Notes |
|-------|------|--------|-------|
| CNN Scratch | Classifier | ~1.5 M | Trained from scratch |
| ResNet-50 | Classifier | ~25 M | Transfer learning |
| MobileNetV4 | Classifier | ~3.5 M | Fastest inference |
| YOLO26 Classify | Classifier | — | NMS-free; default active model |
| YOLO26 Detect | Detector | — | Bounding-box detector; used for anomaly detection |

Run `POST /api/evaluate/all` from the Admin UI or API to compare all trained classifiers side-by-side. Download results as a formatted Excel file from `GET /api/evaluate/excel`.

---

## Common Errors

| Error | Fix |
|-------|-----|
| `torch` import error | Ensure Python 3.10+ is active in the venv |
| `cv2` import error | `pip install opencv-python` |
| `ultralytics` import error | `pip install ultralytics` |
| CUDA out of memory | Reduce `BERTH_BATCH_SIZE` or set CPU-only PyTorch |
| No images found | Run dataset preparation first |
| WebSocket won't connect | Start the backend before the frontend |
| YOLO26 weights not found | Train `yolo26_detect` or `yolo26_classify` via the Training panel first |
| Anomaly detection 400 error | YOLO26 Detect model weights are missing — train it first |
| YouTube stream errors | URL may have expired; HLS URLs are cached for `BERTH_YT_CACHE_TTL` seconds |
| Rate limit exceeded | Wait 1 minute or increase `BERTH_UPLOAD_RATE_LIMIT` |

---

## Docker Deployment

```bash
# Build image
docker build -t berth-ai .

# Run
docker run -p 8000:8000 berth-ai

# With docker-compose (backend + frontend)
docker-compose up -d

# With API key
docker run -p 8000:8000 -e BERTH_API_KEY=your-secret berth-ai
```

---

## License

This project is licensed under the MIT License and is for educational and portfolio purposes.

---

## Acknowledgements

- [PKLot Dataset](https://www.cnrpark.it/dataset/) — Parking lot occupancy dataset used for training CNN/ResNet/MobileNet classifiers ([Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/))
- [AI-Parking-Lot-Detection](https://github.com/Nandini60/AI-Parking-Lot-Detection/tree/main/parking_ai) — Reference implementation and architectural inspiration
- Ultralytics YOLO26 — State-of-the-art object detection and classification models

---

## Citations

```bibtex
@misc{marek2021imagebased,
      title={Image-Based Parking Space Occupancy Classification: Dataset and Baseline}, 
      author={Martin Marek},
      year={2021},
      eprint={2107.12207},
      archivePrefix={arXiv},
      primaryClass={cs.CV}
}
```
