# Smart Parking Project — Master Change Log

Consolidated summary of all development phases (1–16).

---

## Phase 1 — Admin-Configurable ROI System

Replaced the hardcoded 18-slot parking grid with an admin-configurable Region of Interest (ROI) system. Admins draw arbitrary polygons or rectangles over a reference image to define parking slots.

**Backend:**
- `backend/src/roi/roi_store.py` (`RoiStore`) — CRUD for ROI polygons stored in `roi_configs/<id>.json`; snapshot save/load.
- `backend/main.py` — Added `GET/POST /api/roi/{camera_id}`, `DELETE /api/roi/{camera_id}/{roi_id}`, `POST /api/roi/{camera_id}/snapshot`.
- `backend/src/inference/slot_detector.py` — Added `camera_id` param; routes to `_detect_from_rois()` (polygon bbox crop → classify) when ROIs exist, falls back to `spots_config.json` grid otherwise.
- `backend/src/inference/video_processor.py` — Propagates `camera_id` through to detector.

**Frontend:**
- `RoiEditor.jsx` — Canvas polygon/rectangle drawing tool with snap-close, color cycling, undo support.
- `RoiManager.jsx` — Admin panel: upload reference image, save/delete ROIs, table view.
- `HeatmapView.jsx` — Canvas minimap rendering ROI polygons color-coded by occupancy rate.
- `App.jsx` — Added `<RoiManager />` to side column.

---

## Phase 2 — Model Architecture Upgrades

**Date:** 2026-05-29

Upgraded CNN architectures and added new model classes.

- `cnn_scratch.py` — Expanded to 6 conv blocks (3→32→64→128→256→512→512), added nested `SEBlock` (Squeeze-and-Excitation) after block 5, new 3-layer classifier head.
- `cnn_transfer.py` — Swapped ResNet18 → ResNet50 (`ParkingResNet`); added `ParkingMobileNetV4` (timm `mobilenetv4_conv_small`); added `ParkingYOLO26` detector wrapper (Ultralytics, plain class not `nn.Module`).
- `model_factory.py` — Added `resnet50`, `mobilenetv4` to registry; kept `resnet18` alias with `DeprecationWarning`.
- `config.py` — Added `RESNET50_PATH`, `MOBILENETV4_PATH`.
- `main.py` — Added new model names to valid lists and `model_info` response.
- `requirements.txt` — Added `timm>=1.0.0`, `ultralytics>=8.3.0`.

---

## Phase 3 — Dataset Image Upload

Added browser-based labeled image upload to the training panel.

**Backend:**
- `POST /api/dataset/upload` — Multipart form (`files` + `label`); validates label as `occupied`/`vacant`; max 50 files/request; collision-safe filenames; returns `{saved, skipped, label}`.
- `GET /api/model/info` — Added `occupied_count` and `vacant_count` fields.

**Frontend:**
- `TrainingPanel.jsx` — Added `DropZone` sub-component (drag-and-drop + click), upload flow with `Promise.all`, dataset count display.
- `App.jsx` — Passed `modelInfo` and `fetchModelInfo` props to `TrainingPanel`.

---

## Phase 4 — Server Busy Indicator

Shows the admin when the server is busy (uploading, training, analyzing).

**Backend:**
- `_active_operations` dict + `_ops_lock` globals; `_register_op`, `_update_op_progress`, `_finish_op` helpers.
- `GET /api/status` — No auth; returns `{busy, operations[]}` with progress and label.
- Wrapped `POST /api/upload-video`, `POST /api/train/start`, `POST /api/analyze-lot`, `POST /api/dataset/upload` with op tracking.

**Frontend:**
- `ServerStatus.jsx` — Polls every 2s; animated 28px status bar with 4px progress strip; visible only when busy.
- `App.css` — Added server status bar styles + `server-status-pulse` keyframe.

---

## Phase 5 — Multi-Camera Registry

**Date:** 2026-05-29

Multiple cameras registered, persisted, and viewed simultaneously.

**Backend:**
- `backend/src/cameras/camera_registry.py` — `CameraRegistry` singleton; persists to `cameras.json`; lazy `VideoProcessor` creation on `activate()`; `_restore_active()` on module load.
- `main.py` — Added `GET/POST /api/cameras`, `DELETE /api/cameras/{id}`, `POST /api/cameras/{id}/activate|deactivate`; `WS /ws/cameras/{id}`; lifespan context manager for clean shutdown.

**Frontend:**
- `CameraManager.jsx` — Table of cameras with activate/deactivate/delete; collapsible add form.
- `CameraFeedCell.jsx` — Individual camera WebSocket feed with metrics badges and auto-reconnect.
- `MultiCameraGrid.jsx` — Responsive grid (1/2/3 cols) of active camera feeds; unified totals bar.
- `App.jsx` — Added `cameras` state, camera components inserted between VideoFeed and AnalyticsChart.

---

## Phase 6 — Public Board + PIN-Protected Admin Dashboard

Split into public parking board (`/`) and PIN-protected admin dashboard (`/admin`).

**Backend:**
- `GET /api/public/metrics` — No auth; serves metrics for 8s polling by PublicView.

**Frontend:**
- `react-router-dom ^7.0.0` added.
- `App.jsx` — Replaced with `BrowserRouter` + `Routes` shell only.
- `PinGate.jsx` — Username+password auth gate (default `admin`/`password`); `localStorage` persistence; env-var override via `VITE_ADMIN_PASSWORD`.
- `PublicView.jsx` — Live clock, available-spots count, `<MetricCards>`, poll every 8s; no controls.
- `AdminView.jsx` — Full admin UI (all former `App.jsx` state and components).
- `Header.jsx` — Added nav links (Public/Admin), logout button.

---

## Phase 7 — Automated Tests + CI Pipeline

Pytest backend tests, Vitest frontend tests, GitHub Actions CI.

**Backend tests (`backend/tests/`):**
- `conftest.py` — `TestClient`, `tmp_data_dir`, `mock_processor`, `patch_get_processor` (autouse), `patch_roi_dir` (autouse).
- `test_api.py` — One test per endpoint covering all routes.
- `test_roi_store.py` — Unit tests for `RoiStore` (save/get, delete, invalid coords, camera isolation).
- `test_models.py` — Forward-pass and parameter count for `ParkingCNN`, `ParkingResNet`, `ParkingMobileNetV4` (all `pretrained=False`).

**Frontend tests:**
- `PinGate.test.jsx`, `PublicView.test.jsx`, `RoiEditor.test.jsx`.
- Vitest added with jsdom; `vite.config.js` recreated with test block.

**CI (`.github/workflows/ci.yml`):** Three parallel jobs — backend (pytest), frontend (vitest), lint (ruff + eslint). Triggers on push to `main` and all PRs.

---

## Phase 8 — Demo Mode Explanation + UI Polish

- **Demo Mode:** Documented that `DemoProcessor` runs when no model/camera is available; random slot toggling is intentional.
- **Metric Cards:** Reduced sizes (padding 20px→12px, icon 40px→30px, number 2rem→1.5rem).
- **AlertBanner removed** from `AdminView.jsx` and `PublicView.jsx`.
- **Occupancy progress bar:** Replaced 3-step hard color switch with smooth HSL interpolation (hue 120→0 green→red, saturation and lightness shift with occupancy).

---

## Phase 9 — ROI Editor Polish + CNN Loss Fix

**ROI Editor (`RoiEditor.jsx`):**
- Escape key discards in-progress polygon.
- Auto-close polygon when click lands within 15px of first vertex.
- Snap indicator: first vertex grows to green circle when within snap range.
- Undo/Redo (`Ctrl+Z`/`Ctrl+Y`) via `past`/`future` stacks; `commitChange()` routes all mutations; fixed TDZ crash by hoisting `useCallback` declarations.

**Settings UI:** Collapsible `SettingsPanel` with Controls, ROI Manager, Training sections; ROI modal enlarged on image upload; model Test buttons added.

**CNN Classifier fixes (`cnn_scratch.py`, `trainer.py`, `classifier.py`):**
- Added `BatchNorm1d(64)` after second FC layer (later removed — see Phase 11).
- Removed `nn.Sigmoid()` from classifier head; switched to raw logits.
- `trainer.py`: `BCELoss` → `BCEWithLogitsLoss`; explicit `.float()` cast on labels.
- `classifier.py`: Applied `torch.sigmoid()` at inference.

---

## Phase 10 — Model UI Overhaul + API Alignment

1. **ControlPanel** — Replaced 10 Load+Test buttons with `<select>` dropdown + **Load** + **Test** buttons. Model list corrected: CNN Scratch, ResNet-50, MobileNetV2, MobileNetV4, YOLO26.
2. **TrainingPanel** — Replaced 5 Train buttons with dropdown + **Train** + **Compare All**. Added MobileNetV4 and YOLO26 entries; active-model highlight follows dropdown selection.
3. **`ParkingYOLO26`** — Removed auto-download of pretrained weights; raises `FileNotFoundError` if no local weights.
4. **`POST /api/test-model/{model_name}`** — New endpoint: loads model, runs `evaluate_model()`, returns accuracy/precision/recall/F1; 400 for YOLO26 (detection interface).
5. **`YOLO26_PATH`** — Added to `config.py` and `model_factory.get_model_path()`.
6. **`ModelStatus.jsx`** — Updated to show all 5 current models.
7. **YOLO26 training guard** — `POST /api/train/start` returns 400 immediately for `yolo26`.
8. **MobileNetV4 feature dim fix** — Replaced `backbone.num_features` (reports wrong pre-pool size) with a dummy forward pass to read actual pooled output dim.
9. **`.panel-select` CSS class** — Shared dropdown style matching ghost buttons; applied to both ControlPanel and TrainingPanel.
10. **`/api/analyze-roi`** — New endpoint: classify per ROI polygon crop; returns same shape as `analyze-lot`.
11. **ROI Manager merged into ControlPanel** — Upload → Draw ROIs modal → Save & Close flow; context-aware Test button.

---

## Phase 11 — ParkingCNN Architecture Fix & ROI Editor Fullscreen

1. **`cnn_scratch.py`** — Removed spurious `BatchNorm1d(64)` that was added after training, causing state_dict key mismatch. Classifier reverted to 9-layer form (indices 0–8) matching saved checkpoint.
2. **ROI Editor modal** — Changed from centred `90vw×90vh` card to full-screen `position:fixed; inset:0` overlay for accurate ROI placement visibility.

---

## Phase 12 — Model Set Rework + ML Pipeline Bug Fixes

### Model Set Rework

Restored 4-model set after prior over-cleanup: `cnn_scratch`, `resnet50`, `mobilenetv4`, `yolo26`. Removed `mobilenetv2` (`ParkingMobileNet`) everywhere.

- `cnn_transfer.py` — Full rewrite: `ParkingResNet` (ResNet50, raw logits), `ParkingMobileNetV4` (timm, raw logits). No `nn.Sigmoid()` in any head.
- `model_factory.py`, `main.py`, `config.py`, `train_all.py`, `test_models.py`, `verify.py` — All updated to reflect `{cnn_scratch, resnet50, mobilenetv4}`.

### ML Pipeline Bug Fixes

1. **Double Sigmoid removed** from `ParkingResNet`, `ParkingMobileNet`, `ParkingMobileNetV4` heads in `cnn_transfer.py` — models previously applied `sigmoid(sigmoid(x))`.
2. **`/api/test-model` tuple unpack fixed** — `prepare_dataset()` returns a dict, not a 3-tuple; corrected to `data["test_loader"]`.
3. **Evaluator logit threshold** — Applied `torch.sigmoid` before `> 0.5` in `evaluator.py`.
4. **Model fallback** — `_get_processor()` supported set narrowed; added explicit `WARN` log before falling back to demo on unknown model name.

---

## Phase 13 — YOLO26 Training Integration & Model List Fix

**Date:** 2026-05-30

1. **Frontend model lists** — Removed dead `mobilenetv2` from ControlPanel and TrainingPanel; added `yolo26_classify` and `yolo26_detect`.

2. **YOLO26 Classification Mode (`yolo26_classify`):**
   - Trains YOLO26 as a patch classifier on gopro ROI crops (from `parking_rois_gopro/annotations.json`).
   - `train_manager.py` — `_train_yolo26_classify()` method; `yolo_converter.py` — `build_yolo_classify_dataset()` crops annotated spots from gopro frames.
   - `classifier.py` — `_load_yolo_classify()`, YOLO inference path in `predict()`/`predict_batch()`.
   - Output: `models/best_yolo26_classify.pt`.

3. **YOLO26 Detection Mode (`yolo26_detect`):**
   - Trains on 293 annotated gopro parking lot images (11,236 spots); `yolo_converter.py` converts quad-polygon annotations to YOLO bbox format.
   - Output: `models/best_yolo26_detect.pt` (also aliased as `best_yolo26.pt`).

4. **`yolo_detector.py`** — `ParkingYOLO26` extracted from `cnn_transfer.py` into its own module.

---

## Phase 14 — ML Pipeline Fixes + YOLO Training Improvements

**Date:** 2026-05-30

1. **MobileNetV4 BatchNorm crash** — `ParkingMobileNetV4` now calls `self.backbone.eval()` after freezing and overrides `train(mode)` to keep the frozen backbone in eval mode, preventing `[N, 1280, 1, 1]` batch-size-1 BN crash.

2. **YOLO training UI on page refresh** — `TrainingPanel.jsx` now calls `pollStatus()` on mount so it resumes showing training progress after a page refresh.

3. **YOLO intra-epoch progress** — Added `on_train_batch_end` callbacks (every 50 batches) to both YOLO training methods in `train_manager.py`; shows current epoch, batch, and loss within 2s.

4. **YOLO classify dataset scope** — `build_yolo_classify_dataset()` rewritten to crop spots from `parking_rois_gopro/annotations.json` instead of passing the 696k-image `DATA_DIR` to Ultralytics. Removed `YOLO_FRACTION` workaround. Deleted accidentally created `backend/data_split/` (556k duplicate images).

5. **YOLO training speed** — Added `cache="ram"`, `amp=True`, `workers`, `imgsz=64` for classify; `cache="ram"`, `amp=True` for detect.

---

## Phase 15 — Assisted ROI Calibration (Auto-detect spots)

**Date:** 2026-05-30

Added auto-detect workflow: backend proposes candidate ROIs; admin reviews/accepts/discards before any are saved.

**Backend:**
- `roi_proposer.py` — `propose_from_frames()`: YOLO detection + contour fallback → IoU-based union-find clustering → normalized polygon proposals. Optional `use_line_detection` snaps to painted stall markings via Hough lines. Returns proposals with `proposed: True`, never saves.
- `POST /api/roi/{camera_id}/propose` — Uses saved snapshot; returns `{proposals, count, warning}`.

**Frontend:**
- `RoiEditor.jsx` — `proposals`/`onProposalsChange` props; ghost canvas layer (dashed cyan); proposals toolbar: Accept Selected / Accept All / Discard Selected / Discard All; accepting converts proposal → confirmed ROI via `commitChange`.
- `RoiManager.jsx` — "Auto-detect spots" button (after image upload); displays proposal count and occupied-spot caveat.

---

## Phase 16 — YouTube Live Stream + Public View Lot Map

**Date:** 2026-05-30

### YouTube Live Stream Camera Source

Added `"youtube"` camera type. `yt-dlp` resolves watch URLs to live HLS `.m3u8` stream URLs at capture time, with TTL cache and force-refresh on reconnect.

- `requirements.txt` — Added `yt-dlp>=2024.1.0`.
- `config.py` — Added `YOUTUBE_STREAM_CACHE_TTL` (default 240s).
- `youtube_resolver.py` (new) — `resolve_stream_url()` with in-memory TTL cache; `YouTubeResolveError` on failure.
- `video_processor.py` — `_open_capture()` helper resolves YT URL; reconnect loop re-resolves with `force_refresh=True` after 5 failed grabs.
- `camera_registry.py` — Passes `source_type` to `set_video_source`; youtube type bypasses early URL resolution.
- `main.py` — Allows `"youtube"` in camera type validation.
- `CameraManager.jsx` — Added "YouTube Live" option in type select.

### Public View Lot Map

- `PublicView.jsx` — Added `LotMap` SVG component: renders each slot from `metrics.slots` as a color-coded rectangle (green=vacant, red=occupied, amber=misparked). `viewBox` computed from slot extents; slot label and FREE/OCC/MISP badge; legend row below. Returns `null` for empty slots. No new npm dependencies.

---

## Misparked Vehicle Detection (Phase 14 backend feature)

- `parking_geometry.py` — `box_iou`, `overlap_fraction`, `classify_vehicle_parking` (straddling/outside_markings/ok), `aggregate_lot` with misparked list.
- `POST /api/analyze-misparked` — YOLO detection + geometry → annotated image with green/red slot overlays and orange misparked vehicle boxes.
- `test_parking_geometry.py` — 16 unit tests (no pytest required).
