# Phase 4 Log

---

## 2026-06-01 — .gitignore Audit

**File changed:** `.gitignore`

### What changed
Added project-specific rules that were entirely missing from the generic Python template:

| Rule | What it blocks |
|---|---|
| `backend/uploads/` | User-uploaded videos — runtime files |
| `**/*.cache` | YOLO `train.cache` / `val.cache` — auto-regenerated |
| `.claude/` | Claude Code session data — local tooling only |
| `frontend/.env`, `frontend/.env.*` | Protects `VITE_API_KEY` from accidental commit |
| `backend/.vscode/` | IDE settings that leaked into the backend dir |

Untracked already-committed files: `.claude/` (3 files) and `backend/classify_yolo_data/train.cache` + `val.cache`. All removed from git index only — files remain on disk.

Already-tracked deployment files (`backend/models/`, `backend/outputs/`, `backend/smartpark.db*`, `roi_configs/`, `cameras.json`, base YOLO weights) intentionally left tracked for stakeholder demo purposes.

---

## 2026-06-01 — Security Audit Remediation

**Files changed:**
- `backend/src/roi/roi_store.py`
- `backend/src/db/database.py`
- `backend/src/cameras/camera_registry.py`
- `backend/main.py`
- `frontend/src/components/PinGate.jsx`
- `frontend/src/components/CameraFeedCell.jsx`
- `frontend/src/components/VideoFeed.jsx`
- `frontend/src/pages/AdminView.jsx`

### What changed

**Critical fixes**
- `roi_store.py`: Added `_SAFE_CAM_ID` regex allowlist to `_roi_path` and `_snapshot_path` — prevents path traversal via `camera_id` (e.g. `../../backend/config`).
- `main.py`: Stripped path components from uploaded filenames using `Path(file.filename).name` in both `upload_video` and `upload_dataset_images`.
- `main.py`: Added 500 MB streaming upload for video (chunked, no full in-memory buffer); added 20 MB guard on image endpoints.
- `main.py`: Added `dependencies=[Depends(verify_api_key)]` to all camera registry endpoints (`GET/POST/DELETE /api/cameras`, activate, deactivate) and anomaly settings endpoints.

**High severity**
- `main.py`: Replaced `key != API_KEY` with `hmac.compare_digest` — prevents timing-based API key brute-force.
- `main.py`: Replaced `allow_origins=["*"]` with explicit origin list; added `SMARTPARK_ALLOWED_ORIGIN` env-var escape hatch.
- `main.py`: Added `_ws_token_valid` guard to both WebSocket endpoints (`/ws/video`, `/ws/cameras/{id}`); accepts `?token=` query param, skips check when `API_KEY` is unset.
- `main.py`: Added `_validate_camera_source` SSRF guard — validates RTSP scheme, YouTube hostname allowlist, USB integer index, and file path within `UPLOAD_DIR`.
- `main.py`: Added `@limiter.limit("3/hour")` on `/api/train/start`.

**Medium severity**
- `main.py`: Lifespan logs a loud `WARNING` when `SMARTPARK_API_KEY` is unset.
- `main.py`: Removed absolute filesystem path from YOLO FileNotFoundError response.
- `database.py`: Replaced f-string SQL construction with `_TREND_CONFIG` lookup dict — eliminates risk of future SQL injection via the `group_expr` path.
- `camera_registry.py`: Added `_redact_url_credentials` — strips user:password from RTSP/YouTube URLs before writing to `cameras.json`. Added `_env_source_key` / env-var override (`SMARTPARK_CAM_SOURCE_<ID>`) so credentials can live in the environment instead.
- `PinGate.jsx`: Replaced `localStorage` with `sessionStorage` — auth token now clears on tab close, reducing XSS persistence window.

**Low severity / performance**
- `main.py`: Added `_clf_cache` module-level dict — `ParkingClassifier` instances are now reused across requests instead of reloaded from disk each time. Cache is cleared on model switch.
- `main.py`: Added 1-hour TTL eviction in `_register_op` to prevent the ops dict growing unbounded after crashes.

**Frontend WebSocket auth**
- `AdminView.jsx`, `CameraFeedCell.jsx`, `VideoFeed.jsx`: Pass `?token=${VITE_API_KEY}` in WebSocket URLs when `VITE_API_KEY` is set in the frontend `.env`.

---

## 2026-06-01 — ROI Editor: polygon editing, duplicate, scale

**File changed:** `frontend/src/components/RoiEditor.jsx`

### What changed

**New "Edit" mode (toolbar button)**
- Activating Edit mode switches off polygon/rectangle drawing and enables direct polygon manipulation on any selected ROI.
- White circle handles rendered at every vertex of the selected polygon; dragging one repositions that vertex.
- White square handles rendered at each edge midpoint; dragging one inserts a new vertex at that point and moves it, allowing individual edges to be stretched or compressed to fit the parking layout.
- Dragging anywhere inside the polygon body (not on a handle) translates the whole polygon.
- Delete key in Edit mode removes the selected ROI.
- A short hint bar is shown below the toolbar while Edit mode is active.

**New "Duplicate" button**
- Copies the selected ROI with a 2 % normalized offset, assigning it the next color in the palette and appending " copy" to the label.
- Useful when many parking spots share the same shape.

**New "Scale +" / "Scale −" buttons**
- Each click scales the selected polygon ±10 % around its centroid, clamped to [0, 1].
- Allows quick resizing without re-drawing.

**Internal additions**
- `ptDistPx(ax, ay, bx, by, W, H)` — pixel-space distance helper for handle hit detection (10 px threshold).
- `dragRef` (ref) — stores active drag state (type, vertex index, original polygon, start point) without causing re-renders.
- `didDragRef` (ref) — prevents the post-drag `onClick` from firing selection logic after a handle/body drag completes.
- `editPolygon` (state) — holds the live polygon shape during a drag so the canvas redraws smoothly without committing on every frame.
- `duplicateSelected` / `scaleSelected` callbacks added.

**Preserved unchanged:** polygon draw mode, rectangle draw mode, proposals workflow (accept/discard), undo/redo (Ctrl+Z/Y), keyboard shortcuts, overlay mode, background image rendering.

### Why
User requested richer polygon editing: individual vertex/edge manipulation to match actual parking geometry, plus copy-paste and scale shortcuts for lots with repeated slot layouts.

### Build
`npm run build` — clean, 0 errors, 0 warnings (320 kB bundle).

---

## 2026-06-01 — Anomaly Detection: Wrong Parking Scenario

### Scenario
Detect vehicles parked outside designated ROI markings (outside lot boundaries or straddling two slots).

### Files changed

| File | Change |
|---|---|
| `backend/src/inference/video_processor.py` | Anomaly detection integration |
| `backend/main.py` | API endpoints + activate_camera propagation |
| `frontend/src/components/AnomalyPanel.jsx` | **New** — Anomalies settings component |
| `frontend/src/components/SettingsPanel.jsx` | Added Anomalies subsection |
| `frontend/src/components/MetricCards.jsx` | Conditional Misparked metric card |

### What changed

**`video_processor.py`**
- Added `_anomaly_enabled` (bool) and `_yolo_detector` (lazy-loaded) instance fields.
- `set_anomaly_detection(enabled)` — public method to toggle the feature; loads `ParkingYOLO26` from `YOLO26_DETECT_PATH` on first enable, raises `FileNotFoundError` if weights are missing.
- `_load_yolo_detector()` — lazy loader for the YOLO26 detect model.
- In `_process_frame`: when anomaly is enabled, runs YOLO26 detect on the resized frame, classifies each vehicle against the cached ROI polygons via `classify_vehicle_parking`, draws orange (`#FFA500`) bounding boxes labeled `STRADDLE` or `OUTSIDE` for misparked vehicles.
- `misparked_count` (int) and `anomaly_enabled` (bool) added to every metrics payload and `_default_metrics`.

**`main.py`**
- `_anomaly_enabled = False` global flag (in-memory, resets on server restart).
- `GET /api/settings/anomaly` — returns `{"enabled": bool}`.
- `POST /api/settings/anomaly` — toggles feature, propagates to default processor and all active camera processors. Returns 400 with clear message if YOLO26 detect model weights are missing.
- `activate_camera` endpoint now applies the current anomaly flag to newly activated camera processors.

**`AnomalyPanel.jsx`** (new)
- ON/OFF toggle button under Settings → Anomalies.
- Fetches current state on mount.
- Shows contextual status message: success (green/purple) or error (red) if model weights are missing.

**`SettingsPanel.jsx`**
- Added `import AnomalyPanel` and a new collapsible `SubSection title="Anomalies"` at the bottom of the Settings panel (collapsed by default).

**`MetricCards.jsx`**
- Added an orange **Misparked** card (⚠️) that renders only when `metrics.anomaly_enabled === true`.
- Displays live `misparked_count` from the WebSocket metrics stream.

### Logic summary
Wrong parking is determined per-vehicle using `classify_vehicle_parking` from `parking_geometry.py`:
- **outside_markings** — vehicle's IoU with every ROI polygon is below threshold (0.20).
- **straddling** — vehicle's IoU with two or more ROI polygons exceeds threshold (0.15).

### Constraints
- Requires `models/best_yolo26_detect.pt` to be trained; toggling ON returns a 400 error otherwise.
- Anomaly state is in-memory only; user must re-enable after server restart.
- Detection runs on every video frame alongside normal slot classification, so performance depends on GPU/CPU available for YOLO26.

---

## 2026-06-01 — CNN/ResNet/MobileNet: Fix vacant→occupied drift over time

### Problem
CNN classifiers (cnn_scratch, resnet50, mobilenetv4) perform well immediately after training but progressively misclassify vacant spaces as occupied as the day progresses. Root cause: **shadow drift** — as sun angle changes, partial shadows fall across empty spaces and the model fires "occupied" because it was never trained to see dark-banded vacant crops. Compounded by a tiny training set (2,000 images) and only 5 epochs.

### Files changed

| File | Change |
|---|---|
| `backend/config.py` | `EPOCHS` 5 → 30, `SUBSET_SIZE` 2,000 → 12,000 |
| `backend/src/data_prep/dataset.py` | Added `_RandomShadow` augmentation to train pipeline |
| `backend/src/inference/classifier.py` | Applied `self.threshold` (0.6) in `predict()` and `predict_batch()` |

### What changed

**`config.py`**
- `EPOCHS`: 5 → 30. Early stopping (patience=4) will halt early if needed; the increase gives models room to converge on the larger dataset.
- `SUBSET_SIZE`: 2,000 → 12,000. PKLot contains images from all times of day and weather conditions; more samples = natural lighting variety in training data.

**`dataset.py`**
- Added `_RandomShadow` transform class: with p=0.5, overlays a random dark vertical band (20–60% of crop width, 35–65% brightness) on the PIL image before `ToTensor`. Simulates partial shadows falling across vacant parking spaces, directly addressing the root cause.
- Inserted `_RandomShadow(p=0.5)` into the train-split transform pipeline after `ColorJitter`.

**`classifier.py`**
- `predict()`: after computing status/confidence from sigmoid output, returns `{"status": "unknown"}` when `confidence < self.threshold` (0.6) instead of committing to a wrong label.
- `predict_batch()`: same threshold gate applied per-item in the CNN output loop. YOLO paths are not affected.

### Why
`self.threshold = 0.6` was already set in `__init__` but was never read during inference — uncertain predictions (0.5–0.6 confidence) were returned as definitive statuses. Now marginal predictions surface as "unknown" and are counted as neither occupied nor vacant in aggregation.

---

## 2026-06-01 — YOLO Detect: Fix all-unoccupied bug + class filter

### Problem
YOLO detect model shows every slot as unoccupied. Three root causes found:

1. **5 epochs** — detection training shared `config.EPOCHS` with CNN training. YOLO detect needs ~100 epochs to converge; at 5 epochs mAP50 was 0.107. With no detections, `_yolo_detect_to_dict` always returns "vacant".
2. **`train_all.py` ignored `SUBSET_SIZE`** — `organize_pklot` was called with hardcoded `max_per_class=1000`, so setting `SUBSET_SIZE=12000` had no effect on how much data was copied to `data/`.
3. **No class filter in `predict_frame()`** — model detects two classes (0=vacant spot, 1=occupied spot). The anomaly code treated class 0 detections as vehicles, causing false misparked alarms.

### Files changed

| File | Change |
|---|---|
| `backend/config.py` | Added `YOLO_DETECT_EPOCHS = 100` (overridable via env var) |
| `backend/src/train/train_manager.py` | `_train_yolo26_detect` uses `config.YOLO_DETECT_EPOCHS` for `total_epochs`, epoch message, and `model.train(epochs=...)` |
| `backend/src/models/yolo_detector.py` | `predict_frame()` skips class 0 (vacant) detections — only class 1 (occupied) returned as vehicle proxies |
| `backend/train_all.py` | `max_per_class=1000` → `config.SUBSET_SIZE // 2` (6,000 per class with current setting) |

### Action required
Retrain YOLO detect via the Training panel to get the full 100-epoch run with correct data volume.

---

## 2026-06-01 — SQLite persistence + Occupancy Trends feature

### Added
- `backend/src/db/__init__.py` — package marker
- `backend/src/db/database.py` — SQLite layer (WAL mode, thread-local connections)
  - Tables: `occupancy_history`, `alert_events`, `training_runs`
  - `init_db()` called at server startup via FastAPI lifespan
  - `record_occupancy()` + `query_trends(range)` — history writes and Day/Week/Month aggregation (hourly for day, daily for week/month)
  - `maybe_record_alert()` — fires on 70/85/95% thresholds (info/warning/critical) with 10-min cooldown per camera per level
  - `start_training_run()` / `finish_training_run()` — training lifecycle tracking
  - `get_training_runs()` / `get_alerts()` — read helpers

### Modified
- `backend/src/inference/video_processor.py`
  - Added `_last_db_write` float; writes occupancy + checks alert threshold once per minute (throttled from ~20 fps frame loop)
- `backend/src/train/train_manager.py`
  - `_train_model`, `_train_yolo26_classify`, `_train_yolo26_detect` all call `start_training_run` at start and `finish_training_run` on success or failure
- `backend/main.py`
  - Import `db`; call `db.init_db()` in lifespan
  - `GET /api/trends?range=day|week|month&camera_id=` — returns aggregated occupancy rows
  - `GET /api/alerts?limit=` — returns recent alert events
  - `GET /api/training-runs?limit=` — returns training run history
- `frontend/src/components/AnalyticsChart.jsx`
  - Tab bar: Live / Day / Week / Month
  - Live tab uses existing in-memory `history` prop (last 60 points)
  - Day/Week/Month tabs fetch `/api/trends` on tab switch and auto-refresh every 60s
  - X-axis labels: HH:MM for day view, MM-DD for week/month view
  - Same 2-line canvas style: green = available, red = occupied

### Build
- Backend `python -c "from src.db import database"`: OK
- Frontend `npm run build`: 0 errors, 45 modules, 328 kB bundle

---

## 2026-06-01 — Fix: Trends chart empty with fresh data

### Problem
Day view returned 1 row when all data was within the same clock-hour (hourly grouping). Frontend required `data.length >= 2` to render, so the chart showed the empty-state placeholder even though data existed.

### Fix
- `backend/src/db/database.py`: Day view now uses 5-minute buckets (`datetime(epoch - epoch%300, 'unixepoch')`), Week uses hourly — both give more granular buckets so sparse/fresh data still produces visible chart points. Returned timestamps normalized to ISO 'T' separator.
- `frontend/src/components/AnalyticsChart.jsx`: Empty state guard changed from `< 2` to `=== 0`. `drawLine` fixed to handle 1-point case (draws a flat horizontal line across full plot width instead of NaN crash from `/0`).

### Result
`query_trends('day')` with 5 rows across 20 minutes now returns 5 distinct buckets and the chart renders correctly.

---

## 2026-06-01 — YOLO Detect: Fix suppressed detections (conf/iou thresholds)

### Problem
`ParkingYOLO26.predict_frame()` was calling `self.model(frame_bgr, verbose=False)` with no confidence or IoU parameters, so YOLO fell back to its defaults (`conf=0.25`, `iou=0.45`). The detect model was trained on tight parking-space crops where scores are typically lower; the 0.25 threshold suppressed most valid detections, making anomaly detection appear broken.

### Root cause reference
Ultralytics `ParkingManagement` solution uses `conf=0.1`, `iou=0.7` for parking scenarios — much lower confidence threshold to avoid missed detections, stricter IoU for cleaner NMS.

### File changed
`backend/src/models/yolo_detector.py`

### What changed
- `__init__` accepts `conf: float = 0.1` and `iou: float = 0.7`, stored as `self._conf` / `self._iou`.
- `predict_frame()`: model call now passes `conf=self._conf`, `iou=self._iou`, and `classes=[1]` (pre-filter occupied class, replaces the post-loop `if int(box.cls[0]) != 1: continue` check).

---

## 2026-06-01 — README: Add license, acknowledgements, and dataset citation

### File changed
`README1.md`

### What changed
- **License section**: Updated to specify MIT license
- **New Acknowledgements section**: Lists PKLot dataset, AI-Parking-Lot-Detection GitHub repo, and Ultralytics YOLO26
- **New Citations section**: Added BibTeX citation for Marek's parking dataset (2021, arXiv:2107.12207)

### Why
Documentation completeness: proper attribution to data sources and inspirational projects, with academic citations for reproducibility.

---

## 2026-06-01 — Edge Deployment: Raspberry Pi 5 + ExecuTorch

### Goal
Run parking detection inference on a Raspberry Pi 5 (ARM64, 16 GB RAM, no CUDA) using ExecuTorch as the primary backend, with ONNX Runtime as an automatic fallback. Occupancy data syncs to the existing hub server every 60 s. Training, admin dashboard, and model comparison remain on the hub unchanged.

### Files changed

| File | Change |
|---|---|
| `backend/config.py` | Added `DEPLOYMENT_PROFILE` + `EDGE_HUB_URL` env vars; auto-tunes `FRAME_WIDTH/HEIGHT/STREAM_FPS` for edge profile |
| `backend/src/inference/classifier.py` | Added `get_classifier()` factory — returns `ExecuTorchClassifier` on edge for CNN models, `ParkingClassifier` otherwise |
| `backend/src/inference/slot_detector.py` | Updated `SlotDetector.__init__` to call `get_classifier()` instead of `ParkingClassifier()` directly |
| `backend/main.py` | Updated `_get_classifier` cache to use `get_classifier()`; gated `/api/train/start`, `/api/evaluate/all`, `/api/dataset/upload` with 403 on edge profile; added `POST /api/ingest/occupancy` + `/api/ingest/alerts` hub endpoints; started `SyncWorker` in lifespan |
| `backend/src/db/database.py` | Added `synced INTEGER DEFAULT 0` column to `occupancy_history` and `alert_events`; online migration for existing DBs; added `get_unsynced_occupancy/alerts`, `mark_synced_*`, `upsert_occupancy/alerts_batch` helpers |
| `backend/src/train/train_manager.py` | Added non-fatal export trigger after each successful training run (all 3 training paths) |

### New files

| File | Purpose |
|---|---|
| `backend/src/export/__init__.py` | Package marker |
| `backend/src/export/model_exporter.py` | Exports PyTorch CNNs → ExecuTorch `.pte` (XNNPACK delegate) or ONNX fallback; exports YOLO via Ultralytics API |
| `backend/src/inference/executorch_classifier.py` | `ExecuTorchClassifier` — drop-in for `ParkingClassifier`; auto-detects ExecuTorch vs ONNX Runtime at import time; same preprocessing/output interface |
| `backend/src/sync/__init__.py` | Package marker |
| `backend/src/sync/sync_worker.py` | Background thread pushing unsynced DB rows to hub every 60 s; offline-safe (retries on reconnect) |
| `backend/requirements.edge.txt` | Stripped deps: no torch/torchvision/timm/sklearn/matplotlib/openpyxl; adds onnxruntime + opencv-headless |
| `Dockerfile.edge` | ARM64 image; no Node/frontend stage; exposes port 8000 |
| `docker-compose.edge.yml` | Edge compose: USB camera passthrough, model/DB volume mounts, hub URL env var |

### Architecture summary

```
RPi5 (SMARTPARK_DEPLOYMENT=edge)       Hub (unchanged server)
────────────────────────────────       ──────────────────────────
USB/RTSP camera @ 640×480, 6 FPS      React Admin + PublicView
VideoProcessor → SlotDetector          Full training pipeline
ExecuTorchClassifier (.pte/.onnx)      Receives /api/ingest/* rows
SQLite buffer (synced=0 rows)  ──▶     Central analytics + trends
SyncWorker (60 s heartbeat)            Model export → .pte push
/api/train → 403 Forbidden             Hub docker-compose unchanged
```

### ExecuTorch ARM64 wheel note
Pre-built ARM64 `executorch` wheels may not be on PyPI at time of deployment. `requirements.edge.txt` installs `onnxruntime` as a guaranteed fallback. `ExecuTorchClassifier` detects the available runtime at import — no code change needed to switch between them.

### Recommended model for RPi5
`MobileNetV4` — designed for mobile ARM processors, ~5 M params. Set `SMARTPARK_MODEL=mobilenetv4` and copy `edge_mobilenetv4.pte` (or `.onnx`) from hub `backend/models/` to the RPi5's model volume before first run.

### Upgrade path
Install the [Hailo-8L AI HAT+](https://www.raspberrypi.com/products/ai-hat/) (~$70 M.2 NPU, 13 TOPS). Architecture unchanged — swap `CPUExecutionProvider` for Hailo's execution provider in `executorch_classifier.py` to get 30+ FPS YOLO inference.

---

## 2026-06-01 — Fix: API key auth + unified multi-camera metrics

### Problem
After `load_dotenv()` was added to `config.py` and `SMARTPARK_API_KEY` was set via `.env`, all protected frontend endpoints returned 401. Additionally, the metrics panel showed zeros and the total spot count did not aggregate across multiple cameras.

### Root causes
1. All `fetch()` calls across 12 frontend files sent no `X-API-Key` header.
2. Camera WebSocket URLs (`/ws/cameras/{id}`) were missing the `?token=` query param, so they were rejected silently — `cameraMetrics` never received data.
3. Only the first active camera's metrics were stored (`if (i === 0) setCameraMetrics(d.metrics)`), so multi-camera setups showed one lot's numbers rather than a unified total.

### Files changed

| File | Change |
|---|---|
| `frontend/src/api.js` | **New** — `apiFetch` wrapper: injects `X-API-Key` header from `VITE_API_KEY` on every request |
| `frontend/src/pages/AdminView.jsx` | Import `apiFetch`; replace all `fetch(`; add `?token=` to camera WS URLs; replace single `cameraMetrics` state with `allCameraMetrics` map; aggregate total/available/occupied/occupancy_percent/fps/slots across all active cameras |
| `frontend/src/pages/PublicView.jsx` | Import + use `apiFetch` |
| `frontend/src/components/HeatmapView.jsx` | Import + use `apiFetch` (was missed in first pass — caused /api/roi and /api/heatmap 401s) |
| `frontend/src/components/CameraManager.jsx` | Import + use `apiFetch` |
| `frontend/src/components/AnomalyPanel.jsx` | Import + use `apiFetch` |
| `frontend/src/components/AnalyticsChart.jsx` | Import + use `apiFetch` |
| `frontend/src/components/ModelStatus.jsx` | Import + use `apiFetch` |
| `frontend/src/components/ControlPanel.jsx` | Import + use `apiFetch` |
| `frontend/src/components/VideoFeed.jsx` | Import + use `apiFetch` |
| `frontend/src/components/TrainingPanel.jsx` | Import + use `apiFetch` |
| `frontend/src/components/ServerStatus.jsx` | Import + use `apiFetch` |
| `frontend/src/components/RoiManager.jsx` | Import + use `apiFetch` |

### Aggregation logic
`displayMetrics` now computes a live aggregate across all active camera WebSocket streams:
- `total / available / occupied` — summed across all cameras
- `occupancy_percent` — `occupied / total × 100` (not averaged, derived)
- `avg_confidence / fps` — averaged across cameras
- `slots` — concatenated from all cameras
Falls back to the default `/ws/video` metrics when no named cameras are active.

---

## 2026-06-02 — Fix: MobileNetV4 pretrained download + model renamed to mobilenetv4s

### Problem
On every server start, timm was downloading ImageNet pretrained weights from Hugging Face for MobileNetV4 even when loading locally trained `.pth` weights. The download was wasted: `load_model()` constructed the model with `pretrained=True` (the class default), then immediately overwrote the weights with `model.load_state_dict(state_dict)`. Additionally, the timm model string used the short alias `'mobilenetv4_conv_small'` which timm resolves dynamically — a different checkpoint could be pulled on a future timm update. The model identifier `"mobilenetv4"` also gave no indication it was specifically the small variant.

### Files changed

| File | Change |
|---|---|
| `backend/src/models/model_factory.py` | `load_model()` now sets `pretrained=False` before constructing; registry key renamed `"mobilenetv4"` → `"mobilenetv4s"` |
| `backend/src/models/cnn_transfer.py` | timm model string changed from `'mobilenetv4_conv_small'` → `'mobilenetv4_conv_small.e2400_r224_in1k'` (pinned variant) |
| `backend/config.py` | Comment updated: `"mobilenetv4"` → `"mobilenetv4s"` |
| `backend/main.py` | All 10 string occurrences of `"mobilenetv4"` → `"mobilenetv4s"` |
| `backend/src/inference/classifier.py` | `_EDGE_CNN_MODELS` and `_INFERENCE_MODELS` sets updated |
| `backend/src/inference/executorch_classifier.py` | `_EDGE_MODEL_NAMES` set updated |
| `backend/src/train/train_manager.py` | Both dict key references updated |
| `backend/src/export/model_exporter.py` | Set and docstring comment updated |
| `backend/train_all.py` | `model_names` list updated |

### What changed

**`model_factory.py` — stop pretrained download**
- `load_model()` now calls `kwargs.setdefault("pretrained", False)` before `create_model()`. Since `load_model` is always followed by `load_state_dict` from disk, downloading ImageNet weights first was pure overhead.

**`cnn_transfer.py` — pin exact timm variant**
- `timm.create_model(...)` now uses `'mobilenetv4_conv_small.e2400_r224_in1k'` — the exact variant trained against, preventing silent checkpoint drift on future timm upgrades.

**Model identifier rename: `"mobilenetv4"` → `"mobilenetv4s"`**
- Propagated to all 9 backend files. Makes it unambiguous the small (S) variant is in use.

---

## 2026-06-02 — Fix: YOLO detect inference bugs + config cleanup

### Problems
1. `predict_batch()` for the `"yolo26"` detect path was missing `classes=[1]` — class 0 (vacant) detections also triggered the "occupied" return, making every slot appear occupied regardless of actual state.
2. `predict()` (single-image) had no `_yolo_detect` handler — fell through to `self.model(tensor)` where `self.model = True` (sentinel), causing a `TypeError` crash.
3. `on_batch_end` progress callback in `_train_yolo26_detect` displayed `config.EPOCHS` (30) as the epoch ceiling instead of `config.YOLO_DETECT_EPOCHS` (100).
4. `config.py` still declared three dead model paths: `RESNET18_PATH` (`best_resnet18.pth`), `MOBILENET_PATH` (`best_mobilenetv2.pth`), and `YOLO26_PATH` (duplicate alias for `best_yolo26_detect.pt`).

### Files changed

| File | Change |
|---|---|
| `backend/src/inference/classifier.py` | Added `_yolo_detect` handler to `predict()`; added `classes=[1]` to both `predict()` and `predict_batch()` yolo_detect calls |
| `backend/src/train/train_manager.py` | `on_batch_end` epoch display fixed: `config.EPOCHS` → `config.YOLO_DETECT_EPOCHS` |
| `backend/config.py` | Removed `RESNET18_PATH`, `MOBILENET_PATH`, `YOLO26_PATH` |
| `backend/main.py` | Updated `YOLO26_PATH` reference → `YOLO26_DETECT_PATH` |
| `backend/src/inference/roi_proposer.py` | Updated `YOLO26_PATH` reference → `YOLO26_DETECT_PATH` |

### Action required
Retrain the YOLO detect model — weights on disk were produced under the broken inference (no `classes=[1]` filter). Training itself was unaffected; a fresh run will produce correct weights.

---

## 2026-06-02 — Fix: MobileNetV4 pretrained download + model renamed to mobilenetv4s

### Problem
On every server start, timm was downloading ImageNet pretrained weights from Hugging Face for MobileNetV4 even when loading locally trained `.pth` weights. The download was wasted: `load_model()` constructed the model with `pretrained=True` (the class default), then immediately overwrote the weights with `model.load_state_dict(state_dict)`. Additionally, the timm model string used the short alias `'mobilenetv4_conv_small'` which timm resolves dynamically — a different checkpoint could be pulled on a future timm update. The model identifier `"mobilenetv4"` also gave no indication it was specifically the small variant.

### Files changed

| File | Change |
|---|---|
| `backend/src/models/model_factory.py` | `load_model()` now sets `pretrained=False` before constructing; registry key renamed `"mobilenetv4"` → `"mobilenetv4s"` |
| `backend/src/models/cnn_transfer.py` | timm model string changed from `'mobilenetv4_conv_small'` → `'mobilenetv4_conv_small.e2400_r224_in1k'` (pinned variant) |
| `backend/config.py` | Comment updated: `"mobilenetv4"` → `"mobilenetv4s"` |
| `backend/main.py` | All 10 string occurrences of `"mobilenetv4"` → `"mobilenetv4s"` |
| `backend/src/inference/classifier.py` | `_EDGE_CNN_MODELS` and `_INFERENCE_MODELS` sets updated |
| `backend/src/inference/executorch_classifier.py` | `_EDGE_MODEL_NAMES` set updated |
| `backend/src/train/train_manager.py` | Both dict key references updated |
| `backend/src/export/model_exporter.py` | Set and docstring comment updated |
| `backend/train_all.py` | `model_names` list updated |

### What changed

**`model_factory.py` — stop pretrained download**
- `load_model()` now calls `kwargs.setdefault("pretrained", False)` before `create_model()`. Since `load_model` is always followed by `load_state_dict` from disk, downloading ImageNet weights first was pure overhead. Callers can still pass `pretrained=True` explicitly if they need a fresh backbone.

**`cnn_transfer.py` — pin exact timm variant**
- `timm.create_model(...)` now uses `'mobilenetv4_conv_small.e2400_r224_in1k'` instead of the ambiguous `'mobilenetv4_conv_small'`. This is the exact variant trained against and matches what the Hugging Face log reported at runtime, preventing silent checkpoint drift on future timm upgrades.

**Model identifier rename: `"mobilenetv4"` → `"mobilenetv4s"`**
- Propagated to all 9 backend files. The rename makes it unambiguous in the API, UI, and logs that the small (S) variant is in use — not medium or large.

### Why
Eliminate the startup network hit (>300 ms HF HTTP request per boot), pin the exact architecture used during training, and surface the model size in the identifier.
