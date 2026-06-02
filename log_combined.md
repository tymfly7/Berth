# Smart Parking — Combined Change Log

Consolidated from: `edit_logs.md`, `log_phase0.md`, `log_phase1.md`, `log_phase2.md`, `log_phase3.md`, `log_phase4.md`

---

## 2026-05-28 — Initial Refactoring

- **VideoProcessor created** — file was entirely missing; all real model modes silently fell back to DemoProcessor. New class: background thread, OpenCV capture, SlotDetector integration, `threading.Lock` on shared state. (`backend/src/inference/video_processor.py`)
- **main.py** — uncommented VideoProcessor wiring; added `_processor_lock` around `_get_processor`/`_reset_processor`; added bounds validation (1–50) on `/api/analyze-lot` rows/cols.
- **config.py** — removed hardcoded `D:\PKLot\PKLotSegmented` Windows path; default now `""`, set via `PKLOT_ROOT` env var.
- **train_manager.py** — removed duplicate import block (`torch`, `create_model`, `Trainer`, `prepare_dataset` each imported twice).
- **Dead files deleted** — `frontend/src/counter.ts`, `main.ts`, `style.css` (Vite template remnants, not used).

---

## Phases 1–16 — Core Feature Development (2026-05-29 – 2026-05-30)

### Phase 1 — Admin-Configurable ROI System
Replaced hardcoded 18-slot grid with polygon/rectangle ROI editor. `RoiStore` persists per-camera configs to `roi_configs/<id>.json`. `SlotDetector` routes to polygon crop detection when ROIs exist, falls back to `spots_config.json` grid otherwise.
- New: `roi_store.py`, `RoiEditor.jsx`, `RoiManager.jsx`, `HeatmapView.jsx`
- API: `GET/POST /api/roi/{camera_id}`, `DELETE /api/roi/{camera_id}/{roi_id}`, `POST /api/roi/{camera_id}/snapshot`

### Phase 2 — Model Architecture Upgrades
- CNN expanded to 6 conv blocks + nested `SEBlock`; `ParkingResNet` (ResNet50); `ParkingMobileNetV4` (timm); `ParkingYOLO26` detector wrapper.
- `model_factory.py` registry updated; `requirements.txt` adds `timm>=1.0.0`, `ultralytics>=8.3.0`.

### Phase 3 — Dataset Image Upload
- `POST /api/dataset/upload` — multipart, label validation (`occupied`/`vacant`), 50-file limit, collision-safe filenames.
- `TrainingPanel.jsx` — DropZone drag-and-drop, `Promise.all` upload flow, dataset count display.

### Phase 4 — Server Busy Indicator
- `GET /api/status` — no auth; returns `{busy, operations[]}` with per-op progress and label.
- `ServerStatus.jsx` — 28px animated bar, polls every 2s, visible only when busy.

### Phase 5 — Multi-Camera Registry
- `CameraRegistry` singleton persists to `cameras.json`; lazy `VideoProcessor` on `activate()`; `_restore_active()` on startup.
- `MultiCameraGrid.jsx`, `CameraFeedCell.jsx` — responsive 1/2/3-col grid, WS per camera, unified totals bar.
- API: `GET/POST /api/cameras`, `DELETE /api/cameras/{id}`, `POST /api/cameras/{id}/activate|deactivate`, `WS /ws/cameras/{id}`

### Phase 6 — Public Board + PIN Admin
- Split `/` (public) and `/admin` (PIN-protected) via `react-router-dom ^7`.
- New: `PinGate.jsx`, `PublicView.jsx` (polls every 8s), `AdminView.jsx`, `Header.jsx`.
- `GET /api/public/metrics` — no auth endpoint for public board.

### Phase 7 — Automated Tests + CI
- pytest backend: `test_api.py`, `test_roi_store.py`, `test_models.py` with fixtures in `conftest.py`.
- Vitest frontend: `PinGate.test.jsx`, `PublicView.test.jsx`, `RoiEditor.test.jsx`.
- `.github/workflows/ci.yml` — three parallel jobs: pytest / vitest / ruff+eslint.

### Phase 8 — Demo Mode + UI Polish
- Metric cards resized (padding 20→12px, icon 40→30px, number 2rem→1.5rem).
- `AlertBanner` removed from AdminView and PublicView.
- Occupancy bar: smooth HSL interpolation (hue 120→0 green→red) replaces 3-step hard color switch.

### Phase 9 — ROI Editor Polish + CNN Loss Fix
- Escape discards in-progress polygon; auto-close at 15px snap with visual indicator; undo/redo (Ctrl+Z/Y) via `past`/`future` stacks.
- `BCELoss` → `BCEWithLogitsLoss`; removed `nn.Sigmoid()` from classifier head; `torch.sigmoid()` applied at inference.

### Phase 10 — Model UI Overhaul
- ControlPanel/TrainingPanel: `<select>` dropdown + Load/Train buttons replace per-model button rows.
- New: `POST /api/test-model/{name}` (accuracy/precision/recall/F1), `POST /api/analyze-roi`.
- YOLO26 training guard (400 response). ROI Manager merged into ControlPanel flow.

### Phase 11 — ParkingCNN Fix + ROI Fullscreen
- Removed spurious `BatchNorm1d(64)` added after training — caused `state_dict` key mismatch on load.
- ROI Editor modal changed to `position:fixed; inset:0` fullscreen overlay.

### Phase 12 — Model Set Rework + ML Bug Fixes
- Removed `mobilenetv2` everywhere; canonical set: `cnn_scratch`, `resnet50`, `mobilenetv4`, `yolo26`.
- Fixed double sigmoid in ResNet/MobileNet heads; fixed `/api/test-model` dict/tuple unpack; applied sigmoid before 0.5 threshold in evaluator.

### Phase 13 — YOLO26 Training Integration
- `yolo26_classify`: crops ROI spots from gopro annotations → YOLO classification training. Output: `models/best_yolo26_classify.pt`.
- `yolo26_detect`: 293 annotated gopro images, quad-polygon → YOLO bbox format. Output: `models/best_yolo26_detect.pt`.
- `yolo_detector.py` extracted as standalone module.

### Phase 14 — ML Pipeline Fixes + Misparked Detection
- MobileNetV4 BN crash: `backbone.eval()` before dummy probe, `train()` override keeps frozen backbone in eval.
- YOLO training: poll-on-mount resume; `on_train_batch_end` intra-epoch progress; `cache="ram"`, `amp=True`.
- `parking_geometry.py` — `classify_vehicle_parking` (straddling/outside_markings); `POST /api/analyze-misparked`.

### Phase 15 — Assisted ROI Calibration
- `roi_proposer.py` — YOLO detection + contour fallback → IoU union-find clustering → normalized polygon proposals. Never saves.
- `POST /api/roi/{camera_id}/propose` — returns `{proposals, count, warning}`.
- `RoiEditor.jsx` — ghost canvas layer; proposals toolbar: Accept/Discard Selected/All.

### Phase 16 — YouTube Live Stream + Public Lot Map
- `youtube_resolver.py` — `yt-dlp` resolves watch URL → HLS `.m3u8` with TTL cache; force-refresh on reconnect.
- Reconnect loop re-resolves after 5 failed grabs. `CameraManager.jsx` adds "YouTube Live" option.
- `PublicView.jsx` — `LotMap` SVG: color-coded rectangles per slot (green=vacant, red=occupied, amber=misparked).

---

## 2026-05-31 — Bug Fixes & Feature Polish

- **YOLO detect pretrained weights** — `yolo26n.yaml` → `yolo26n.pt`; random init produced near-zero mAP50 (0.1%) at 5 epochs. (`train_manager.py:268`)
- **ROI proposer class filter** — `_VEHICLE_CLASSES` corrected from COCO IDs `{2,3,5,7}` → `{0,1}` (custom model: vacant/occupied); was silently discarding every detection. (`roi_proposer.py:22`)
- **Camera Registry → Settings Panel** — moved to collapsible sidebar section; `compact` prop hides Source column, shortens buttons to On/Off/✕.
- **Per-ROI delete from VideoFeed** — chip list below canvas; each chip has color swatch, label, ✕ button calling `DELETE /api/roi/{cam}/{id}`.
- **Model activation on live feeds** — `/api/use-model` now iterates all active cameras and calls `camera_registry.activate(cam_id, model_name=...)`; was only restarting the legacy `/ws/video` processor. `ModelStatus.jsx` shows Activate/Active badge.
- **LotMap colors from live camera WS** — 3-tier: `metrics.slots` if non-empty → merged `liveSlots + roiSlots` by slot ID → bare `roiSlots`. (`AdminView.jsx`)
- **Controls Demo/Live toggle** — "Live" button calls `/api/use-model/{selectedModel}`; active state derived from `modelInfo.active_model`; dropdown syncs to server on load.
- **Fix `TESTING_CAMERA_ID` typo** — declaration had doubled prefix `TESTING_TESTING_`; corrected to `TESTING_CAMERA_ID`. (`ControlPanel.jsx:12`)
- **YouTube HLS performance** — background grab thread with `queue.Queue(maxsize=2)`; `CAP_PROP_BUFFERSIZE=1`; 480p format; `fflags;nobuffer|live_start_index;-3` ffmpeg options; CDN `multiple_requests;0` suppresses connection-reuse warning.
- **"✎ Edit ROIs" on live feed** — captures current frame via short-lived WS, uploads as snapshot, opens full-screen ROI editor with frame as background.
- **MultiCameraGrid inside VideoFeed card** — `bare` prop; standalone grid card removed from AdminView main column.
- **Removed main video `<img>`** — MultiCameraGrid is the sole video display; slim toolbar shows LIVE badge + Edit ROIs.
- **MobileNetV4 BN crash on instantiation** — `backbone.eval()` before dummy forward probe; restore `backbone.train()` after so downstream freeze logic applies correctly. (`cnn_transfer.py`)
- **ModelStatus panel corrected** — removed `mobilenetv2`; added `yolo26_classify`; renamed "YOLO26" → "YOLO26 Detect".
- **ROI annotation overlay removed** — `draw_overlay()` and `cv2.putText` watermark removed from processing loop; plain resized frame stored as `self._frame`.
- **ROI polygon outlines restored** — yellow `cv2.polylines` + label per ROI; cache refreshed ~1s to avoid per-frame disk reads. (`video_processor.py`)
- **WebSocket TLS close race fixed** — removed explicit `await websocket.close()` from error-return paths; Starlette closes cleanly when handler returns. (`main.py`)
- **LotMap uses real ROI polygons** — `fetchRoiSlots` calls `GET /api/roi/{cameraId}`; `roiToSlot()` normalizes to 1000×600 canvas; `<polygon>` SVG elements render true shapes.
- **DemoProcessor fake slots removed** — `_compute_metrics` now emits `"slots": []`; LotMap falls through to real saved ROIs. (`demo_processor.py`)
- **ROI Editor background** — removed then re-added: `bgImgRef` caches loaded `HTMLImageElement`; `syncSize` derives height from image aspect ratio; `ctx.drawImage` fills canvas before ROI overlays.
- **ROI canvas overlay on live grid** — no frozen frame modal; canvas absolutely positioned over `MultiCameraGrid`; toolbar with `rgba(0,0,0,0.6)` + `backdropFilter:blur(4px)` in overlay mode.
- **ROI namespace isolation** — ControlPanel uses `ctrl_testing`; VideoFeed uses `cam_` prefix; prevents live-camera ROI overwrite from test panel.
- **ROI coordinate fix** — overlay covered full MultiCameraGrid (title bar + padding + totals row) causing ~9px offset; switched to background-image mode with locked 16:9 (`1280×720`) aspect ratio for exact coordinate mapping. (`VideoFeed.jsx`)
- **Slot name labels removed** — `cv2.putText` label removed from video overlay; `<text>` label removed from LotMap; occupancy status text re-centred to centroid.
- **"Unknown model demo" warning fixed** — `_INFERENCE_MODELS` set filters non-inference values; `load()` returns early for `None` model name. (`classifier.py`)
- **Evaluate All** — replaces faulty "Compare All" (which retrained instead of evaluating); runs `evaluate_model()` on saved weights; saves `model_comparison.json`; Excel export via `openpyxl` with color-coded rows and best-value highlights. New: `POST /api/evaluate/all`, `GET /api/evaluate/excel`.
- **Model Info accordion** — each row expands to show epochs, train/val accuracy, loss, train time, test metrics. Activate buttons removed (activation lives in Controls). "Test" → "Use" in ControlPanel.
- **ROI polygon color coding on live feed** — green (vacant) / red (occupied) / gray (unknown) from `result["slots"]` status map; was hardcoded yellow. (`video_processor.py`)
- **Fix leftover polygon outlines** — LotMap final fallback returns `[]` not `roiSlots`; HeatmapView canvas branch guarded with `heatmap && heatmap.length > 0`.

---

## 2026-06-01 — Continued Development

- **Activate button fix** — `proc = _get_processor()` / `camera_registry.get_processor()` moved inside WS loop so model switches propagate; removed stale `finally: proc.stop_processing()` that stopped the active processor on any client disconnect. Added `"yolo26"` to `_get_processor()` supported set.
- **LotMap moved below MetricCards** in AdminView layout.
- **Orphaned ROI config deleted** — `roi_configs/default.json` removed (stale camera). `HeatmapView` accepts `cameraId` prop; re-fetches ROIs when it changes.
- **Time-based heatmap** — `occupied_seconds` (wall-clock via `time.time()` deltas) replaces frame-count occupancy rate; frontend colors relative to most-parked bay; duration labels (`12s`, `4m`, `1h30m`).
- **DemoProcessor removed** — `VideoProcessor` always created; streams `status: "unknown"` with no model loaded. `config.ACTIVE_MODEL` default changed to `"yolo26_classify"`. Header badge triggers on `active_model === 'none'` not `'demo'`.
- **Metric panels fixed** — both WS endpoints send `{metrics}` unconditionally (was gated on frame existing); FPS card added; `ConfidenceGauge` shows "No inference data" at 0.
- **YouTube startup latency** — `probesize;500000` (500 KB, was 5 MB default) + `analyzeduration;500000`; reconnect options re-added; failure threshold 5→3.
- **Active camera metrics** — `cameraMetrics` state in AdminView; `displayMetrics = cameraMetrics || metrics`; MetricCards, LotMap, ConfidenceGauge all use real camera output.
- **YOLO classify class index fix** — `probs[0]` is occupied (alphabetically first folder); was reading `probs[1]` → every result inverted. (`classifier.py`)
- **YOLO evaluation** — runs real `model.val()` on held-out split instead of reading training CSV last-row. Raises `FileNotFoundError` on missing `best.pt` instead of silently reporting success.
- **YOLO classify P/R/F1** — computed from `confusion_matrix.matrix` treating class 0 (occupied) as positive; wrapped in `try/except` for future API changes.
- **Video resolution** — 900×500 → 1280×720; JPEG quality 80→85; `FRAME_W/H` constants synced in `VideoFeed.jsx`.
- **Named ROI lots (Testing Panel)** — `localStorage` lot list; default "LotB" seeded; dropdown + `+ New` inline above "Draw ROIs". Each named lot stored under its own `camera_id` on backend.
- **LotMap multi-camera** — `allCameraSlots` + `liveSlotsMap` (one WS per active camera) in AdminView; `‹ dots ›` navigation when >1 camera has ROIs. Same pattern applied to PublicView.
- **Camera auto-resume** — `camera_registry.shutdown()` stops processors without writing `active: false`; cameras auto-restart on next boot via `_restore_active()`.
- **Per-camera ROI editor in Camera Registry** — `✎ ROIs` button in each camera table row; fullscreen modal with RoiEditor + auto-detect + Save/Done.
- **`GET /api/roi/{camera_id}/snapshot`** — new endpoint; serves saved snapshot JPEG for a camera's ROI config.

---

## 2026-06-02 — Final Features & Hardening

- **Analytics "today" range** — queries `occupancy_history` from UTC midnight in 5-min buckets; fixed x-axis label for space-separated SQLite timestamps (`2026-06-02 16:00:00` → `HH:MM`). (`database.py`, `AnalyticsChart.jsx`)
- **Streams metric card** — replaces FPS; shows `connected / total` cameras with green fill bar proportional to active ratio. (`MetricCards.jsx`)
- **YOLO classify P/R/F1 fix** — `except Exception: pass` was silently swallowing confusion matrix error; now tries `.matrix` then `.data`; logs warning on failure. (`train_manager.py`)
- **Evaluation chart split** — classifier table (Acc/P/R/F1/Time) separate from detect pill (mAP@50/P/R); prevents meaningless cross-comparison of top-1% vs mAP. (`ModelStatus.jsx`)
- **`yolo26` classifier route fixed** — `"yolo26"` in slot-classifier now aliases `_load_yolo_classify()`; detect model only used in anomaly path via `ParkingYOLO26`. (`classifier.py`)
- **YOLO detect weights deployed** — copied 20.7 MB `best.pt` (mAP50=66.2% @ epoch 52) replacing stale 5.1 MB base model. Removed `classes=[1]` from anomaly detector; fixed hardcoded `confidence=0.9`. (`yolo_detector.py`, `classifier.py`)
- **Jitter buffer** — `deque(maxlen=60)` absorbs HLS segment-boundary stalls (~60-frame bursts then 0.5–2s stall); display thread drains at `STREAM_FPS`; repeats last frame when buffer empty. (`video_processor.py`)
- **Timer-driven display + WS deduplication** — display loop runs at `STREAM_FPS` by clock; WebSocket only includes `frame` in payload when `_frame_seq` advances; eliminates resending same 200 KB JPEG 20×/second.
- **3-thread video architecture** — source / display / inference threads; display never blocked by inference; `_cached_status_map` shared between threads. Removed: `_process_frame`, `_youtube_loop`, `_regular_loop`. Added: `_ingest_raw_frame`, `_display_loop`, `_inference_loop`.
- **`.gitignore` audit** — added `backend/uploads/`, `**/*.cache`, `.claude/`, `frontend/.env`, `backend/.vscode/`; removed `.claude/` and YOLO cache files from git index.
- **Security audit** — path traversal guard (`_SAFE_CAM_ID` regex in `roi_store.py`); filename sanitization (`Path(file.filename).name`); 500 MB chunked video upload + 20 MB image guard; `hmac.compare_digest` for API key; CORS explicit origin list + env-var escape hatch; WebSocket `?token=` auth; SSRF guard for camera sources; `@limiter.limit("3/hour")` on train; `sessionStorage` replacing `localStorage` in PinGate; `_clf_cache` reuses classifier instances; credential redaction in `cameras.json`.
- **ROI Editor: polygon editing** — Edit mode with vertex circle handles (drag to move), edge midpoint square handles (drag inserts vertex), body drag to translate. Delete key removes selected ROI. Duplicate button (2% offset, next color, " copy" label). Scale ±10% around centroid (clamped to `[0,1]`). (`RoiEditor.jsx`)
- **Anomaly Detection** — `set_anomaly_detection()` in VideoProcessor; YOLO26 detect classifies vehicles as `outside_markings` / `straddling` / `ok` via `parking_geometry.py`; orange bounding boxes drawn on frame. `AnomalyPanel.jsx` ON/OFF toggle in Settings → Controls. Orange Misparked metric card (renders only when `anomaly_enabled`).
- **CNN shadow drift fix** — `_RandomShadow` augmentation (p=0.5, random vertical dark band simulating partial shadows); `EPOCHS` 5→30; `SUBSET_SIZE` 2k→12k; `threshold=0.6` confidence gate: uncertain predictions return `"unknown"` instead of wrong label. (`dataset.py`, `config.py`, `classifier.py`)
- **YOLO detect config** — `YOLO_DETECT_EPOCHS=100` (was sharing `EPOCHS=5`); `predict_frame()` skips class 0 (vacant); `train_all.py` uses `SUBSET_SIZE//2` per class instead of hardcoded 1000.
- **SQLite persistence** — `occupancy_history`, `alert_events`, `training_runs` tables; WAL mode; `record_occupancy()` throttled to 1/min; `maybe_record_alert()` at 70/85/95% thresholds with 10-min cooldown. All training paths call `start/finish_training_run`. AnalyticsChart gets Live / Day / Week / Month tabs fetching `/api/trends`.
- **Trends chart fix** — day view uses 5-min buckets (was hourly, showing only 1 row for fresh data); empty-state guard changed from `< 2` to `=== 0`; 1-point flat-line case handled.
- **YOLO detect thresholds** — `conf=0.1`, `iou=0.7` (Ultralytics parking-management reference values); replaces default `conf=0.25` which suppressed most valid detections.
- **README** — MIT license, acknowledgements, PKLot BibTeX citation (`arXiv:2107.12207`).
- **Edge deployment** — `SMARTPARK_DEPLOYMENT=edge` profile; `ExecuTorchClassifier` (auto-detects ExecuTorch vs ONNX Runtime); `SyncWorker` pushes unsynced DB rows to hub every 60s. Train/evaluate/upload endpoints return 403 on edge. New: `Dockerfile.edge`, `docker-compose.edge.yml`, `requirements.edge.txt`.
- **API key auth + unified metrics** — `apiFetch` wrapper (`frontend/src/api.js`) injects `X-API-Key` header on all requests; `allCameraMetrics` map aggregates total/available/occupied/fps/slots across all active cameras; camera WS URLs include `?token=`.
- **MobileNetV4 renamed `mobilenetv4s`** — `pretrained=False` in `load_model()` stops unnecessary Hugging Face download on every server start; timm variant pinned to `mobilenetv4_conv_small.e2400_r224_in1k`. Propagated to all 9 backend files and 3 frontend components.
- **WebSocket `feed_unavailable`** — camera toggle-off sends `{"type": "feed_unavailable", "reason": "..."}` and closes cleanly; `CameraFeedCell` stops reconnecting and shows reason string. 30s frame timeout also sends this message.
- **Training rate limit raised** — 3/hour → 20/hour (previous limit hit during normal iterative sessions).
- **Multi-camera focus mode** — click any cell to expand full-width (16:9); thumbnail strip (152px) for other cameras below; `← All Feeds` button; `mini` prop hides metric badges in strip; auto-clears focus if camera deactivated. (`MultiCameraGrid.jsx`, `CameraFeedCell.jsx`)
- **Code quality audit** — extracted `_read_image`/`_frame_to_b64` helpers in `main.py`; `self.model=True` sentinel replaced with `self._loaded` flag in `classifier.py`; `_STATUS_COLOR` moved to class-level constant; `showStatus` helper extracted in ControlPanel; IIFE-in-JSX removed from RoiEditor.
- **Anomaly toggle moved** — `AnomalyPanel` placed inside Controls subsection (was separate Settings section).
- **UX: ROI controls on video upload** — lot selector visible for both image and video uploads; ✎ edit icon on each named lot fetches server snapshot as background.

---

## 2026-06-02 — Public View Live Metrics + Berth Rebrand

- **Public View metrics now live** — root cause: with an API key configured, the public camera WebSocket connected with no token and was rejected (`code 4001`), so it never delivered data; the polled `/api/public/metrics` returns the empty *default* processor, not the registered cameras. Fix: public camera WS now appends `?token=${_API_KEY}` (matching Admin), and a `displayMetrics` aggregate sums total/available/occupied/slots across `liveCamMetrics`, falling back to the polled metrics until live data arrives. All hero/card/lot-map reads switched to `displayMetrics`. (`PublicView.jsx`)
- **`/api/public/metrics` aggregates active cameras** — now sums total/available/occupied (recomputing `occupancy_percent`), averages `avg_confidence`/`fps`, sums `misparked_count`, OR-s `anomaly_enabled`, and concatenates `slots` across all active camera processors (mirrors `/api/history`); falls back to the default processor when none are active. Makes the public polling fallback correct even without the WebSocket. (`backend/main.py`)
- **Streams/FPS card hidden on Public View** — `CARDS.filter(card => card.key !== 'streams' || Array.isArray(streams))`; the Streams card (with its FPS detail) renders only when a `streams` prop is passed, so Admin keeps it and Public drops it. (`MetricCards.jsx`)
- **Equal section widths** — lot map `maxWidth` `860 → 800` to match the metric cards and trends chart; all three stacked sections now align into one centered column. (`PublicView.jsx`)
- **Per-lot breakdown** — centered row shown only when >1 lot: each lot reads `Name: N free` (green) / `Full` (red) / `—` (muted, pre-report), pulled from `liveCamMetrics[id].available`; avoids click-through on the carousel. (`PublicView.jsx`)
- **Live freshness indicator** — `● Live · updated Xs ago` (green) when WS data arrived within 15s, else `● Connecting…` (muted); `lastUpdate` set on every WS metrics message, recomputed off the existing per-second clock tick. (`PublicView.jsx`)
- **Status banner** — headline above the big number: `Spaces Available` (green) vs `Lot Full` (red) when `displayMetrics.available === 0`. (`PublicView.jsx`)
- **Trend direction** — `Filling up ↑` / `Emptying ↓` / `Steady →` from mean `occupancy_percent` of the last 3 history points vs the prior 3, 2-pt threshold to avoid jitter; hidden until ≥4 points. (`PublicView.jsx`)
- **Rebrand → Berth** — app name "Smart Parking AI" → **Berth**, tagline **"Find your space."** Public View heading wordmark + tagline (`PublicView.jsx`); Admin header title + subtitle (`Header.jsx`); browser tab title + meta description (`index.html`). Removed the 🅿️ header logo and its orphaned `icon` style block (`Header.jsx`).

---

## 2026-06-02 — Code Quality Audit Fixes

### Backend

- **`database.py`** — Added `threading.Lock` (`_alert_cooldown_lock`) around all reads/writes of `_alert_cooldown` to prevent race conditions under concurrent FastAPI threads. Added `UNIQUE(camera_id, timestamp)` constraint to `occupancy_history` and `UNIQUE(camera_id, timestamp, level)` to `alert_events` so that `INSERT OR IGNORE` in `upsert_occupancy_batch`/`upsert_alerts_batch` actually deduplicates edge-sync rows. Fixed `record_occupancy` to call `_conn()` once into a local variable instead of twice.

- **`main.py`** — Extracted `_read_image_from_bytes(filename, content)` helper so both `/api/predict` and the existing `_read_image` UploadFile wrapper share one extension-check + decode path. Removed duplicate `allowed` extension check from `/api/predict` (it was checked again after `_read_image` already does it). Forwarded the `RuntimeError` exception message to the HTTP 400 response and added a `logger.error` call in the YOLO26 detector load path (previously message was silently dropped).

### Frontend — New Files

- **`src/config.js`** *(new)* — Single export `API_BASE = http://${hostname}:8000` shared across all components; eliminates three identical hardcoded copies.

- **`src/utils/roiUtils.js`** *(new)* — Extracted `roiToSlot(roi)` helper that was duplicated identically in `AdminView.jsx` and `PublicView.jsx`.

### Frontend — Component Fixes

- **`AdminView.jsx`** — Added `useMemo` for `displayMetrics` (was an IIFE recomputed on every render). Fixed `beforeunload` event-listener leak: the per-camera WebSocket effect was adding a new `closeAll` listener on every cameras-array update without removing the previous one; moved cleanup into the effect `return`. Fixed slot-status dedup: `allLive` merged `displayMetrics.slots` + `liveSlotsMap` producing potential duplicate IDs; now uses `liveSlotsMap[cam.cameraId]` with a fallback to `displayMetrics.slots`. Removed unused `history` prop from `<AnalyticsChart />` call. Updated to import `API_BASE` from `../config` and `roiToSlot` from `../utils/roiUtils`.

- **`PublicView.jsx`** — Added `useMemo` for `displayMetrics`. Added per-camera WebSocket reconnect on close (3-second delay, guards against reconnect if camera is no longer in the active set). Added `historyInterval` (60 s) so `history` state refreshes during long-running sessions (previously fetched once and never updated). Fixed nav arrow buttons to use `className="btn btn-ghost btn-sm"` matching AdminView (were using verbose inline style objects). Updated imports to use shared `API_BASE` and `roiToSlot`. Removed unused `history` prop from `<AnalyticsChart />` call.

- **`AnalyticsChart.jsx`** — Fixed single-point (`data.length === 1`) rendering bug in `drawLine`: the `fill=false` path previously left a `moveTo`-only canvas path and drew a horizontal segment that was never stroked. Refactored `drawLine` to use a shared `getX`/`getY` helper and handle single-point correctly in both fill and stroke branches. Added `fetchError` state — failed fetches now show "Could not load trend data. Retrying…" instead of silently showing empty-data message. Replaced hardcoded `API_BASE` with import from `../config`. Removed `history` prop from component signature (was accepted but never used; the component fetches its own data).

- **`MetricCards.jsx`** — Moved `import { useState }` to the top of the file (was on line 86 after all constants — a hard lint error). Renamed module-level `label` style object to `labelStyle` to eliminate name collision with `label` properties in the `CARDS` array. Extracted stream carousel JSX into a `<StreamCarousel streams={...} />` sub-component, removing the IIFE-in-JSX antipattern. Renamed stream nav button updater parameter from `i` (shadowed outer `.map()` index `i`) to `prev`. Added `?? 0` guard to `metrics.occupancy_percent` reads in the progress bar to prevent `undefined%` width when metrics arrive without the field.

### Styles

- **`index.css`** — Fixed `.text-muted` class: was mapped to `var(--text-secondary)` (medium brightness) instead of the correctly named `var(--text-muted)` (darkest/most muted). Removed dead `@keyframes indeterminate` definition (no class referenced it).

---

## 2026-06-02 — Page Load / Refresh Performance

### Backend (`backend/main.py`)

- **`model_info` response cache** — Added `_model_info_cache` (60s TTL). `GET /api/model/info` now returns the cached dict on repeated calls, skipping the expensive `occ_dir.glob("*.*")` directory walk and multi-file `_load_model_training_details()` read on every poll. Cache is invalidated when training starts (`/api/train/start`) or dataset images are uploaded (`/api/dataset/upload`), and also when `_active_mode` changes so a model switch is reflected immediately.
- **VideoProcessor pre-warm at startup** — `lifespan()` now calls `_get_processor()` during server startup so the model is loaded before the first browser request arrives, eliminating the multi-second delay on the very first page load.

### Frontend (`frontend/src/pages/AdminView.jsx`)

- **Split polling intervals** — Previously `fetchHistory`, `fetchModelInfo`, and `fetchCameras` all fired together every 10 s. Now: cameras poll every 10 s (unchanged), history every 30 s, model info every 60 s (matches backend cache TTL). Converted `fetchHistory` and `fetchModelInfo` to `useCallback` so they are stable references in the `useEffect` dependency array.
- **ROI re-fetch guard** — `fetchCameras` now tracks the last-seen camera-ID set in `prevCamIdsRef`. ROI slots are only re-fetched when the set actually changes (camera added/removed/renamed), not on every 10 s poll, eliminating the N × `/api/roi/{id}` fan-out that fired every tick.

---

## 2026-06-02 — Analyze ROI Inference Speed

### Backend (`backend/main.py`)

- **Batched inference in `analyze_roi`** — Previous code called `clf.predict_batch([crop])` once per ROI inside a loop — N forward passes for N spots. Restructured into three explicit passes: (1) collect all valid crops, (2) ONE `clf.predict_batch(all_crops)` call for all crops together, (3) annotate. For CNN models this reduces inference from N serial forward passes to 1 batched forward pass; for YOLO it already batched but now avoids N Python dispatch calls.
- **Single overlay blend** — Previous code did `annotated.copy()` + `cv2.addWeighted` inside the per-ROI loop — N full-image copies. Now builds one overlay, draws all fills into it, then blends once. With 20 ROIs on a 1080p frame this saves ~19 full frame copies.
- **Inline ROI parameter** — Added optional `rois_json: str = Form(default=None)` to `analyze_roi`. If the client sends ROIs directly in the multipart body the endpoint uses them, bypassing the disk read entirely.

### Frontend (`frontend/src/components/ControlPanel.jsx`)

- **Parallel save + analyze** — `handleTest` previously did `await saveRois(rois)` before dispatching `analyze-roi`, adding a full HTTP round-trip to every click. Now fires `saveRois(rois)` without await (background persistence) and appends `rois_json` to the FormData so analysis starts immediately.

---

## 2026-06-02 — Camera WS Failures and 5-Second Page Blank on Refresh

### Root causes identified

- `CameraRegistry.__init__` called `_restore_active()` synchronously at **module import time**. With 3 active cameras each loading a ResNet50/YOLO model, Python import blocked for 5–15 s before uvicorn even started accepting connections. Browser connections during this window get "can't establish connection".
- Our prior pre-warm (`_get_processor()` in lifespan) ran synchronously on the asyncio event loop, blocking uvicorn from accepting any new connections during additional model load time.
- Frontend `MultiCameraGrid` treated `feed_unavailable: "Camera is not active"` as permanent, stopping all reconnect retries. Cameras whose processors were still loading on startup would be permanently shown as unavailable until page refresh.

### Backend (`backend/src/cameras/camera_registry.py`)

- **Deferred `_restore_active()`** — Removed the `self._restore_active()` call from `CameraRegistry.__init__`. Module import now only reads `cameras.json` (fast). Model loading is deferred until the server is ready.

### Backend (`backend/main.py`)

- **Background startup warmup** — Replaced the blocking `_get_processor()` call in lifespan with a daemon thread (`startup-warmup`) that runs `camera_registry._restore_active()` followed by `_get_processor()`. Server starts accepting connections in milliseconds; models load in background over the following seconds.

### Frontend (`frontend/src/components/MultiCameraGrid.jsx`)

- **Transient vs permanent `feed_unavailable`** — `"Camera is not active"` is now treated as transient: `stopReconnect.current` stays `false`, `onclose` schedules a 3-second retry, and the cell shows "Connecting…" instead of an error. All other reasons (stream timeout, camera removed) remain permanent and stop retrying. When the background warmup thread finishes and the processor is ready, the retry succeeds and the feed appears automatically.
