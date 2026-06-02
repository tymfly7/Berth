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
