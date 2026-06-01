# Phase 4 Log

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
