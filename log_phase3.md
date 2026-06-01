# Phase 3 Log

## Metrics — Real Model Output (Unified Totals)
**Date:** 2026-06-01

### Problem
`MetricCards`, `LotMap` (slots), and `ConfidenceGauge` in `AdminView` were all driven by
`metrics` from the default `/ws/video` WebSocket (the fallback `VideoProcessor` with no
camera source). When a registered camera was activated via the camera registry its real
detection counts — total / available / occupied / occupancy% / confidence — were only
forwarded as `liveSlots` for colouring the lot map, never reaching the metric cards.

### Fix — `frontend/src/pages/AdminView.jsx`
- Added `cameraMetrics` state (`useState(null)`) alongside the existing `metrics` state.
- Derived `displayMetrics = cameraMetrics || metrics` (active camera wins; falls back to
  default WS when no camera is active).
- Updated the active-camera WS `useEffect`:
  - `onmessage` now calls `setCameraMetrics(d.metrics)` in addition to `setLiveSlots`.
  - Cleanup (`return`) now also calls `setCameraMetrics(null)` so stale data is cleared
    when the camera is deactivated.
  - Guard on the `!active` branch also calls `setCameraMetrics(null)`.
- Replaced all three JSX metric references:
  - `<MetricCards metrics={displayMetrics} />`
  - `LotMap` slots IIFE uses `displayMetrics.slots`
  - `<ConfidenceGauge confidence={displayMetrics.avg_confidence} />`

### Result
When a camera is active and running inference, `MetricCards` (Total, Available, Occupied,
Occupancy%, FPS), `LotMap` slot colours, and `ConfidenceGauge` all reflect the real model
output from that camera. When no camera is active the display falls back to the default
processor metrics (unchanged behaviour).

---

## YOLO Classify — Inverted Class Index Fix
**Date:** 2026-06-01

### Problem
`_yolo_result_to_dict` in `backend/src/inference/classifier.py` used `probs[1]` as the
probability of *occupied*, with a comment claiming class 0 = vacant and class 1 = occupied.

The YOLO classify dataset (`build_yolo_classify_dataset`) saves crops into
`{split}/occupied/` and `{split}/vacant/` folders. Ultralytics assigns class indices
**alphabetically**, so the trained model encodes:
- **Class 0 = occupied** (`o` < `v`)
- **Class 1 = vacant**

Reading `probs[1]` as `prob_occupied` therefore returned the *vacant* probability, causing
every occupied slot to be labelled "vacant" (green) and every vacant slot to be labelled
"occupied" (red) — exactly backwards.

### Fix — `backend/src/inference/classifier.py`
- Changed `prob_occupied = float(probs[1])` → `float(probs[0])`
- Updated the comment to reflect the actual alphabetical class ordering.

### Result
YOLO26 classify predictions now correctly show green for free spots and red for occupied spots.

---

## YOLO Evaluation — Run Real Inference Instead of Reading Training CSV
**Date:** 2026-06-01

### Problem
`_evaluate_all` in `backend/src/train/train_manager.py` never loaded or ran the YOLO
models during evaluation. Both YOLO branches just opened `results.csv` from the training
output directory and reported the **last training epoch's validation metrics** as
`test_accuracy`/`test_precision`/`test_recall`. Two consequences:
- Evaluation always succeeded without errors regardless of model quality, because it
  never touched the model weights or GPU.
- The reported "test" numbers were validation numbers from training, not a true held-out
  evaluation.

Additionally, the weight-copy step after both YOLO training runs used `if best_src.exists()`
to silently skip the copy when `best.pt` was missing, then reported "training complete"
anyway — masking the failure.

### Fix — `backend/src/train/train_manager.py`
**Evaluation (`_evaluate_all`)**:
- YOLO classify: loads `best_yolo26_classify.pt`, calls `model.val(data=classify_data_dir,
  split="val", imgsz=YOLO_CLASSIFY_IMG_SIZE, verbose=False)`, reads `val_res.top1` for
  `test_accuracy`. CSV is still read for supplementary `epochs` and `train_time` only.
- YOLO detect: loads `best_yolo26_detect.pt`, calls `model.val(data=yaml_path,
  split="test", verbose=False)`, reads `val_res.box.map50/.mp/.mr` for
  `test_accuracy/test_precision/test_recall`. CSV used for supplementary info only.
- Status messages updated from "Reading … metrics" → "Evaluating …".

**Training (`_train_yolo26_classify`, `_train_yolo26_detect`)**:
- Changed `if best_src.exists(): shutil.copy2(...)` → raises `FileNotFoundError` when
  `best.pt` is absent, so training reports error instead of silently succeeding with no
  saved weights.

### Result
YOLO evaluation now runs actual model inference and reports real metrics from a
held-out split (val for classify, test for detect). A missing or corrupt model now
surfaces as an error rather than a silent empty result.

---

## YOLO Classify — Precision/Recall/F1 Missing After Evaluation Fix
**Date:** 2026-06-01

### Problem
After the previous evaluation fix, `yolo26_classify` still showed `—` for precision,
recall, and F1. `ClassifyMetrics` (the object returned by `model.val()`) only exposes
`top1`/`top5` accuracy — it does not directly provide precision/recall/F1. The fix only
set `test_accuracy`; the three remaining metrics were never written to the entry.

Additionally, the evaluation table footer still read "YOLO: final validation epoch",
which was stale after the evaluation method changed.

### Fix
- `backend/src/train/train_manager.py` (`_evaluate_all`): after `model.val()`, reads
  `val_res.confusion_matrix.matrix` (shape `(nc, nc)`, `cm[actual][predicted]`).
  Treats class 0 (occupied, alphabetically first) as positive and computes:
  - `precision = TP / (TP + FP)`
  - `recall    = TP / (TP + FN)`
  - `f1        = 2·P·R / (P + R)`
  Wrapped in `try/except` to degrade gracefully if the attribute is unavailable in a
  future Ultralytics version.
- `frontend/src/components/ModelStatus.jsx`: updated footer text to
  "All models: held-out test set (CNN/ResNet/MobileNet: PKLot · YOLO: gopro val/test split)".

### Result
Re-running evaluation now populates precision, recall, and F1 for `yolo26_classify`
alongside accuracy.

## Video Resolution Increase
**Date:** 2026-06-01

### Change
- `backend/config.py`: `FRAME_WIDTH` 900 → 1280, `FRAME_HEIGHT` 500 → 720, `JPEG_QUALITY` 80 → 85.
- `frontend/src/components/VideoFeed.jsx`: `FRAME_W`/`FRAME_H` constants updated to 1280/720 to keep the ROI canvas coordinate system in sync with the backend frame size.

### Result
Streamed frames are rendered and transmitted at 1280×720 with higher JPEG fidelity. Backend restart required for the change to take effect.

---

## Testing Panel — Named ROI Sets + Clear Button
**Date:** 2026-06-01

### Change — `frontend/src/components/ControlPanel.jsx`
- Replaced the hardcoded `TESTING_CAMERA_ID = 'ctrl_testing'` with a named lot system stored in `localStorage` (`smartpark_test_lots`).
- A `DEFAULT_LOT = { name: 'LotB', id: 'ctrl_testing' }` is always seeded/migrated into the lot list on load, preserving any ROIs previously saved under `ctrl_testing`.
- After uploading an image, a lot selector (dropdown + `+ New` input) appears inline above the "Draw ROIs" button. Users can pick an existing named lot or create a new one on the spot.
- Each named lot stores its ROIs under its own `camera_id` on the backend, completely separate from live camera ROIs.
- ROI editor title shows the active lot name.
- `✕ Remove` button clears the uploaded image and result only — named lots and their ROI data are untouched.
- `✕ Remove` is also shown on the annotated result view alongside `← Back to image`.
- `loadLots` migration: if `ctrl_testing` exists in localStorage with a stale name, it is renamed in-place to match `DEFAULT_LOT.name` without requiring manual cache clearing.

### Result
Users can define multiple named parking lot ROI configurations in the testing panel. Uploading an image presents a lot selector; the chosen lot's saved ROIs are loaded and used for analysis. Old ROIs remain accessible under "LotB".

---

## LotMap — Real ROI Polygons from Live Feed
**Date:** 2026-06-01

### Changes
**`frontend/src/components/LotMap.jsx`**
- Removed `<rect>` fallback branch; only `<polygon>` renders now.
- ViewBox now computed from actual polygon point extents (`minX/minY → maxX/maxY`) instead of origin-to-max, eliminating the empty band above the ROI cluster.
- Added optional `title` prop — header reads `"CameraName — N slots"` when set.

**`frontend/src/pages/AdminView.jsx`**
- `roiSlots` (single-camera flat array) replaced with `allCameraSlots` (`{cameraId, name, active, slots}[]`), fetched for every camera in parallel.
- `liveSlots` (single WS) replaced with `liveSlotsMap` (`{[cameraId]: slots[]}`); `camWsRef` replaced with `camWsRefs` map — one WS per active camera.
- Added `lotMapIdx` state + clamp effect.
- LotMap block now renders `‹ dots ›` navigation (only when >1 camera has ROIs), with arrows positioned absolute left/right of the map and a hint text above.
- LotMap slot priority: `roiSlots` polygons always used; live status merged from per-camera WS on top.

**`frontend/src/pages/PublicView.jsx`**
- Added `CANVAS_W/H` constants and `roiToSlot` helper.
- Fetches all cameras + per-camera ROIs on mount (refresh every 30 s).
- Added `liveSlotsMap` + `camWsRefs` — subscribes to `ws/cameras/{id}` for every camera with ROIs, providing real-time slot status (identical pattern to AdminView).
- Falls back to polled `metrics.slots` until WS connects.
- Same `lotMapIdx` sliding navigation as AdminView.

### Result
Both AdminView and PublicView lot maps show actual ROI polygon shapes from the live feed config. AdminView is real-time via existing per-camera WS. PublicView is now also real-time via the same WS pattern. When multiple cameras have ROI configs, `‹ ›` arrows on the left/right of the map and dot indicators allow switching; a hint text informs the user. Single-camera layout is unchanged.

---

## Camera Auto-Resume on Page/Server Refresh
**Date:** 2026-06-01

### Problem
The FastAPI `lifespan` cleanup called `camera_registry.deactivate()` for every camera on
server shutdown. `deactivate()` stops the processor AND writes `active: false` to
`cameras.json`. On the next backend start, `_restore_active()` found no active cameras and
users had to manually turn cameras back on every time the server restarted.

### Fix
- `backend/src/cameras/camera_registry.py`: added `shutdown()` method that stops all
  VideoProcessor instances without modifying `cameras.json` active flags.
- `backend/main.py`: `lifespan` cleanup now calls `camera_registry.shutdown()` instead of
  `deactivate()` per camera.

### Result
`cameras.json` retains the `active: true` state across server restarts. On startup,
`_restore_active()` auto-starts any cameras that were on before shutdown. A plain browser
refresh (no backend restart) already worked; explicit deactivation by the user still
correctly persists `active: false`.
