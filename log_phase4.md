# Phase 4 Log

---

## 2026-06-02 — Streams metric card: replace FPS with connected-stream fill bar

**Files changed:** `frontend/src/components/MetricCards.jsx`, `frontend/src/pages/AdminView.jsx`

Replaced the "Stream FPS" metric card with a "Streams" card (📡) that shows `connected / total` cameras as the value and a green progress bar (fill ratio = active cameras ÷ total cameras). `AdminView` now passes `streams={{ connected, total }}` derived from `cameras.filter(c => c.active).length` / `cameras.length`.

---

## 2026-06-02 — Fix yolo26_classify Missing P/R/F1 + Document Metrics

**Files changed:** `backend/src/train/train_manager.py`, `LResearch.md`

### What changed
`train_manager.py` was silently swallowing the confusion matrix error for `yolo26_classify` with `except Exception: pass`, so P/R/F1 never appeared after Evaluate All. Fixed by:
- Trying `.matrix` then `.data` attributes on the confusion matrix object (YOLO26 API may differ from earlier Ultralytics versions)
- Logging the failure with `logger.warning` so the cause is visible in backend logs if it still fails

Added **Appendix A** to `LResearch.md` documenting: classification metrics (Acc/Prec/Rec/F1), detection metrics (mAP@50/P/R with IoU diagram), why they are not comparable, and the root cause of the missing P/R/F1 values.

---

## 2026-06-02 — Evaluation Chart: Separate Classifier vs Detector Metrics

**Files changed:** `frontend/src/components/ModelStatus.jsx`

### What changed
The comparison table was mixing classification accuracy (top-1 %) with detection mAP@50 in the same "Acc" column, making the numbers meaningless to compare. Split the display:
- **Classifier table** (`type !== 'detection'`): CNN, ResNet50, MobileNetV4, YOLO26 Classify — unchanged Acc/Prec/Rec/F1/Time columns.
- **Detect panel** (`type === 'detection'`): YOLO26 Detect shown as a separate pill below the table, labelled "mAP@50 / P / R" so the metric type is unambiguous.
- Accordion "Test Acc" label for the detect model row changed to "mAP@50".
- Footnote updated to explain the metric split.

---

## 2026-06-02 — Fix `yolo26` Classifier Route

**File changed:** `backend/src/inference/classifier.py`

### What changed
`classifier.py` routed `model_name == "yolo26"` to `_load_yolo_detect()`, giving a detect model individual slot crops. A detect model trained on full parking-lot images can't classify small crops — it fires random or no detections, yielding 0.1% accuracy. Changed the route to `_load_yolo_classify()` so `"yolo26"` in the slot-classifier is now an alias for `"yolo26_classify"`. The detect model itself is unchanged and still used exclusively in the anomaly detection path via `ParkingYOLO26`.

---

## 2026-06-02 — Fix YOLO Detect Model (3 issues)

**Files changed:** `backend/models/best_yolo26_detect.pt`, `backend/src/models/yolo_detector.py`, `backend/src/inference/classifier.py`

### What changed
1. **Deployed trained weights** — Copied `outputs/yolo26_detect/run/weights/best.pt` (20.7 MB, mAP50=66.2% @ epoch 52) to `models/best_yolo26_detect.pt`, replacing the stale 5.1 MB base model that was never updated because training was interrupted before the auto-copy in `train_manager.py:385` ran.
2. **Removed `classes=[1]` from anomaly detector** (`yolo_detector.py:57`) — Filtering to only class 1 (occupied) meant cars parked entirely outside defined ROI polygons were never detected. All detections are now returned and `classify_vehicle_parking` decides what is anomalous.
3. **Fixed hardcoded confidence** (`classifier.py:149`) — `_yolo_detect_to_dict` was returning `confidence=0.9` for vacant slots with no detections. Changed to `1.0 / 0.0` to be consistent with other model paths.

---

## 2026-06-02 — Smooth Video: Jitter Buffer for HLS Burst Absorption

**File changed:** `backend/src/inference/video_processor.py`

### What changed
Added a `deque`-based jitter buffer (`_jitter_buffer`, maxlen = `STREAM_FPS * 3 = 60 frames`) between the source thread and the display thread to smooth out HLS segment-boundary stalls.

**Root cause:** YouTube HLS delivers a full segment (~60 frames) all at once, then stalls for 0.5–2 s while the next segment downloads. The display thread had no buffer to drain during the gap → periodic freeze.

**Fix:**
- `_ingest_raw_frame` now pushes every frame into `_jitter_buffer` as well as `_latest_raw`.
- `_display_loop` pops one frame per tick at `STREAM_FPS`; when the buffer is empty it repeats `_last_display_raw` so the screen stays live.
- `_frame_seq` only increments for genuinely new frames (buffer non-empty), so the WebSocket continues to skip resending repeated stills.
- `_latest_raw_seq` removed (replaced by jitter buffer approach).

**Effect:** A 3-second buffer window absorbs all typical HLS inter-segment gaps transparently, trading ~0–3 s of added latency (acceptable since live HLS is already 6–15 s behind real-time).

---

## 2026-06-02 — Smooth Video: Timer-Driven Display + Deduplicate WebSocket Frames

**Files changed:** `backend/src/inference/video_processor.py`, `backend/main.py`

### What changed

**video_processor.py**
- `_display_loop` changed from event-driven to **timer-driven at `STREAM_FPS`**. Tracks `_latest_raw_seq`; only re-encodes when a genuinely new raw frame has arrived. Sleeping to the next tick absorbs HLS segment bursts so the user sees smooth video instead of fast-then-freeze.
- Added `_latest_raw_seq` (increments on each `_ingest_raw_frame`) and `_frame_seq` (increments on each new JPEG encoded).
- Added `get_frame_seq()` public method.
- Removed `_display_event` (no longer needed; display loop drives itself by clock).
- `_ingest_raw_frame` now only sets `_infer_event`.

**main.py**
- Both WebSocket handlers (`/ws/video`, `/ws/cameras/{id}`) now track `last_frame_seq` and only include `frame` in the JSON payload when `_frame_seq` has changed. Metrics still send every tick. Eliminates resending the same 200 KB JPEG 20×/second.

---

## 2026-06-02 — Decouple Video Display from Inference

**File changed:** `backend/src/inference/video_processor.py`

### What changed
Replaced the single-threaded `_process_frame` pipeline with a three-thread architecture so model inference never blocks live video display:

- **Source thread** (`sp-source`): reads raw frames from the capture device/stream and writes to `_latest_raw`, then signals `_display_event` and `_infer_event`.
- **Display thread** (`sp-display`): wakes on `_display_event`, resizes the frame, draws ROI overlays using *cached* slot statuses, encodes JPEG, and stores `_frame_b64`. Never waits for inference.
- **Inference thread** (`sp-infer`): wakes on `_infer_event`, runs the slot detector and optional YOLO anomaly pass, updates `_metrics`/`_history`/`_heatmap`/DB, and writes results to `_cached_status_map` and `_cached_anomalies` for the display thread to use.

Removed: `_process_frame`, `_youtube_loop`, `_regular_loop`, `queue` import.
Added: `_ingest_raw_frame`, `_display_loop`, `_inference_loop`, `_youtube_source_loop`, `_regular_source_loop`.

`stop_processing` now sets both events before joining threads so they unblock cleanly.

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

---

## 2026-06-02 — WebSocket: feed_unavailable notification on camera toggle-off

### Problem
When a camera feed was toggled OFF in the Camera Registry, the backend removed the processor but the WebSocket handler silently slept in a loop, causing the connection to close without explanation. The frontend's `onclose` handler then rescheduled a reconnect every 3 seconds — infinite loop.

### Files changed

| File | Change |
|---|---|
| `backend/main.py` | `camera_ws` — sends `{"type": "feed_unavailable"}` and closes cleanly instead of looping |
| `frontend/src/components/CameraFeedCell.jsx` | Handles `feed_unavailable` message type — stops reconnecting, shows reason in placeholder |

### What changed

**`main.py` — `camera_ws`**
- At connect: if processor is `None` (camera inactive), sends `{"type": "feed_unavailable", "reason": "Camera is not active"}` and closes.
- In loop: if processor becomes `None` mid-stream (camera toggled off), sends `{"type": "feed_unavailable", "reason": "Camera feed stopped"}` and breaks.
- In loop: if no frames received for 600 ticks (~30 s), sends `{"type": "feed_unavailable", "reason": "Video stream unavailable or timed out"}` and breaks.
- Removed the `asyncio.sleep(0.5); continue` no-op loop for missing processor.

**`CameraFeedCell.jsx`**
- Added `stopReconnect` ref (avoids causing re-render/reconnect loop from state change in `useCallback` deps).
- On `feed_unavailable`: sets `stopReconnect.current = true`, sets `unavailable` display state, clears reconnect timer, closes WS. No reconnect scheduled.
- `ws.onclose`: only schedules reconnect if `!stopReconnect.current`.
- Placeholder now shows the reason string from the server instead of "Connecting…".
- Wake-up: `MultiCameraGrid` unmounts/remounts `CameraFeedCell` when `c.active` changes, so toggling back ON mounts a fresh cell with `stopReconnect = false` and reconnects immediately.

---

## 2026-06-02 — Fix: training rate limit raised to 20/hour

**File:** `backend/main.py`

`@limiter.limit` on `POST /api/train/start` raised from `"3/hour"` → `"20/hour"`.
Previous limit was hit during normal iterative training sessions on localhost.

---

## 2026-06-02 — Fix: mobilenetv4 → mobilenetv4s in frontend

### Problem
Three frontend components sent `model_name=mobilenetv4` to the backend, but the valid identifier is `mobilenetv4s`. Every training start returned `400 Bad Request`. `ModelStatus.jsx` also checked `available_models?.mobilenetv4` (always `undefined`) so the MobileNetV4 model always appeared unavailable.

### Files changed

| File | Line | Change |
|---|---|---|
| `frontend/src/components/TrainingPanel.jsx` | 7 | `'mobilenetv4'` → `'mobilenetv4s'` |
| `frontend/src/components/ControlPanel.jsx` | 8 | `'mobilenetv4'` → `'mobilenetv4s'` |
| `frontend/src/components/ModelStatus.jsx` | 86 | id + availability key both → `mobilenetv4s` |

---

## 2026-06-02 — Feature: Multi-camera focus mode

### What was added
Clicking any live camera cell in the multi-feed grid expands it to fill the full panel width. All other cameras move to a horizontally scrollable thumbnail strip below the main feed. Clicking a thumbnail switches focus to that camera. An "← All Feeds" button in the top-left corner of the focused feed returns to the grid.

### Files changed

| File | Change |
|---|---|
| `frontend/src/components/MultiCameraGrid.jsx` | Added `focusedId` state; focused layout with main feed + strip; auto-clears focus on camera deactivation |
| `frontend/src/components/CameraFeedCell.jsx` | Added `onClick` prop (cursor + handler); added `mini` prop (hides metric badges for compact strip thumbnails) |

### Behaviour details
- **Grid mode**: every cell is clickable (`cursor: pointer`). Click → sets `focusedId`.
- **Focus mode**: focused camera renders full-width (16:9). `← All Feeds` button overlaid top-left. Other cameras shown at 152 px wide in a scrollable flex row below.
- **Thumbnail strip**: clicking any thumbnail calls `setFocusedId(cam.id)` to switch the main feed without leaving focus mode.
- **Auto-clear**: `useEffect` watches `active` cameras list — if the focused camera is deactivated, `focusedId` resets to `null` automatically.
- **WebSocket connections**: all cameras remain connected in both modes; only the layout changes. No reconnects triggered by focus switching.
- **Totals row**: always visible in both grid and focus modes.

---

## 2026-06-02 — Code Quality Audit & Slop Fixes

**Files changed:**
- `backend/main.py`
- `backend/src/inference/classifier.py`
- `backend/src/inference/video_processor.py`
- `backend/src/inference/roi_proposer.py`
- `frontend/src/components/ControlPanel.jsx`
- `frontend/src/components/RoiEditor.jsx`

### backend/main.py
- Added `import base64` at top level (was imported inline 3× inside endpoint functions)
- Extracted `_read_image(file)` async helper — validates format, decodes to numpy array, raises `HTTPException` on failure
- Extracted `_frame_to_b64(frame)` helper — encodes annotated frame to base64 JPEG string
- Refactored `analyze_lot`, `analyze_roi`, `analyze_misparked` to use both helpers; eliminated ~20 lines of duplicated image decode + encode boilerplate
- Removed 5 decorative `# ── Label ──────` section dividers from the setup block (lines labelling 2–3 line expressions)
- Fixed 2 bare `except Exception: pass` in camera anomaly setup — now logs at `DEBUG` level

### backend/src/inference/classifier.py
- Added `self._loaded: bool = False` flag to `__init__`
- Replaced `self.model = True` sentinel (used in both YOLO load methods) with `self._loaded = True`; `self.model` is now always `None` for YOLO models or the actual PyTorch model for CNN models — semantically unambiguous
- Updated `is_loaded()` to `return self._loaded`; added `self._loaded = True` to the CNN model load success path
- Updated `predict()` and `predict_batch()` to check `if not self.is_loaded()` instead of `if self.model is None`
- Trimmed 14-line `predict` and 9-line `predict_batch` docstrings to one-liners

### backend/src/inference/video_processor.py
- Moved `_STATUS_COLOR` dict from inside `_process_frame()` (rebuilt on every frame) to a class-level constant
- Renamed local variable `_fps_elapsed` → `fps_elapsed` (underscore prefix is reserved for module-level private names, not locals)

### backend/src/inference/roi_proposer.py
- Expanded semicolon-chained assignments in `_iou()` lines 30–31 to one statement per line

### frontend/src/components/ControlPanel.jsx
- Extracted `showStatus(msg, delay=4000)` helper (mirrors existing `showRoiMsg` pattern) — eliminates 6× repeated `setStatus(...); setTimeout(() => setStatus(''), N)` pattern scattered across `handleAction`, `handleUpload`, and `handleTest`
- Extracted `roiIsError` boolean derived from `roiMsg` — eliminated duplicated `roiMsg.startsWith('Error') || roiMsg.startsWith('A lot')` condition that appeared in two separate JSX render blocks

### frontend/src/components/RoiEditor.jsx
- Replaced IIFE-in-JSX anti-pattern (`{selectedId && (() => { ... })()}`) in spot-type toolbar with pre-computed `selectedRoi`, `selectedSpotType`, and `typeBtnStyle` declared before `return (`, and a clean `{selectedRoi && (<div>...</div>)}` conditional render

**Verification:** Frontend `npm run build` — clean (0 errors, 0 warnings). All 4 modified Python files pass `ast.parse`.

---

## 2026-06-02 — Move Anomaly Detection Toggle into Controls

**File changed:** `frontend/src/components/SettingsPanel.jsx`

Moved `<AnomalyPanel>` from its own "Anomalies" subsection into the "Controls" subsection, placed below `<ControlPanel>` with a hairline divider separating them. Removed the standalone Anomalies subsection and its preceding divider.

---

## 2026-06-02 — UX: ROI lot controls visible on video upload + editable lots with ✎ icon

**File changed:** `frontend/src/components/ControlPanel.jsx`

- Added `videoUploaded` state: set `true` on video upload, reset on clear. Lot selector section now renders for both image and video uploads (`uploadedImage || videoUploaded`); image preview only shown when an image is present.
- Added `roiEditorBg` state as the ROI modal background. "Draw ROIs" sets it to the uploaded image; ✎ button fetches the server snapshot (`/api/roi/:id/snapshot`) as background fallback.
- Added `openLotRoiEditor(lotId)`: loads ROIs from server, resolves best background (uploaded image → server snapshot → blank), opens modal.
- Added ✎ edit button before delete button in lot selector row; opens ROI editor for selected lot.
- Replaced 🗑 (bin) with ✕ (cross) on the lot delete button.
