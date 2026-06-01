# Phase 3 Log

## 2026-06-01

### Fix: Activate button did not apply model to live feed

**File:** `backend/main.py`

**Root cause:** Both WebSocket handlers (`/ws/video` and `/ws/cameras/{id}`) captured the processor reference once at connection time. When `POST /api/use-model/{model}` replaced the processor (stopping the old one and creating a new one), the WebSocket loops kept polling the old stopped processor — so the live feed froze on the last frame of the old model.

**Fixes applied:**
1. `/ws/video` — `proc = _get_processor()` moved inside the loop so each iteration picks up the current active processor.
2. `/ws/cameras/{camera_id}` — same: `proc = camera_registry.get_processor(camera_id)` moved inside the loop.
3. Removed the stale `finally: proc.stop_processing()` from `/ws/video` (stopped the active processor on any client disconnect).
4. Added `"yolo26"` to the `supported` tuple in `_get_processor()` — it was missing, causing YOLO26 Detect to silently fall back to demo mode.
5. Removed `POST /api/use-demo` endpoint and `"demo"` from the valid models list in `use_model()`.



### Move LotMap below occupancy updates in Admin view

**File:** `frontend/src/pages/AdminView.jsx`

**Change:** Moved the `<LotMap>` component from above `<MetricCards>` to below it, so the Admin layout now matches the public view order.

**New order in main-column:**
1. VideoFeed
2. MetricCards (occupancy updates)
3. LotMap
4. AnalyticsChart
5. ConfidenceGauge + HeatmapView

---

## 2026-06-01 — Remove Orphaned ROI Config & Fix Heatmap Camera + Time-Based Tracking

### Orphaned ROI cleanup
`roi_configs/default.json` deleted — belonged to a camera that no longer exists in `cameras.json`. Active camera is `krom-7951bc` only.

### Heatmap camera fix
`HeatmapView` hardcoded `/api/roi/default` regardless of active camera. Now accepts a `cameraId` prop; `AdminView` derives it from `cameras.find(c => c.active)?.roi_camera_id || id` and passes it down. ROIs re-fetch when `cameraId` changes.

### Time-based heatmap metric
Replaced frame-count occupancy rate with wall-clock `occupied_seconds`. Both `VideoProcessor` and `DemoProcessor` now accumulate elapsed time (via `time.time()` deltas) per slot instead of counting frames. Frontend colors bays relative to the most-parked bay and labels each with formatted duration (`12s`, `4m`, `1h30m`). Legend updated to "Less/More time parked".

### Files modified
- `roi_configs/default.json` — deleted
- `backend/src/inference/video_processor.py` — `_heatmap_last_ts` added; `_update_heatmap` / `get_heatmap` rewritten for time tracking
- `backend/src/inference/demo_processor.py` — same time-tracking changes; heatmap update moved to dedicated `_update_heatmap()` called inside lock in `_loop`
- `frontend/src/components/HeatmapView.jsx` — `cameraId` prop; time-based color/label; updated legend
- `frontend/src/pages/AdminView.jsx` — passes `cameraId` to `HeatmapView`

---

## 2026-06-01 — Remove DemoProcessor

**Motivation:** DemoProcessor served as a fallback that silently injected synthetic data (random confidence, fake slot states) whenever a real model wasn't loaded. This made it impossible to distinguish "no model active" from "model running but returning zeroes," and polluted metrics panels with noise.

### Changes

| File | Change |
|---|---|
| `backend/src/inference/demo_processor.py` | **Deleted** |
| `backend/main.py` | `_get_processor()` rewritten — always creates `VideoProcessor`; raises on failure instead of silently falling back. `_resolve_model_name()` updated to include yolo26 variants and drop demo-mode special-case. Module docstring updated. |
| `backend/config.py` | `ACTIVE_MODEL` default changed from `"demo"` to `"yolo26_classify"`. Comment updated. |
| `backend/verify.py` | Section 3 (demo processor test) removed; remaining sections renumbered 3–6. |
| `backend/src/inference/video_processor.py` | Docstring reference to DemoProcessor removed. |
| `frontend/src/components/Header.jsx` | Badge condition changed from `=== 'demo'` to `=== 'none'` (no model active). |
| `frontend/src/components/ControlPanel.jsx` | Removed `&& modelInfo.active_model !== 'demo'` guard — model dropdown now syncs whenever any model is active. |
| `frontend/src/pages/AdminView.jsx` | Fallback model label changed from `'demo'` to `'none'`. |

### Behaviour after removal
- Server always starts a `VideoProcessor`. With no model file present it streams camera frames with `status: "unknown"` and `avg_confidence: 0` — metric panels correctly show "No inference data" (via the ConfidenceGauge fix from earlier today).
- The header badge turns warning-coloured only when `active_model` is `'none'` (not yet set), not on every cold start.

---

## 2026-06-01 — Fix metric panels to show real live-feed and model detection data

### Root causes identified

1. **Metrics only sent when a frame exists** (`/ws/video`, `/ws/cameras/{id}`): the `if frame_b64:` guard meant no metrics reached the frontend until the first decoded frame — panels stayed at zero.
2. **No FPS metric**: nothing in the payload indicated actual processing speed.
3. **No source/mode label**: frontend couldn't distinguish demo from real-model inference.
4. **ConfidenceGauge showed misleading `0%`** when no model was loaded or no slots were detected.

### Fixes

1. **`backend/main.py`** — both WS endpoints now send `{metrics}` unconditionally; `frame` is included only when available.
2. **`backend/src/inference/video_processor.py`** — added `_fps`/`_fps_frames`/`_fps_ts` fields; FPS computed per-second in `_process_frame`; `fps`, `source_type`, `mode` added to `_result_to_metrics` and `_default_metrics`.
3. **`backend/src/inference/demo_processor.py`** — `_compute_metrics` and `_default_metrics` include `fps: STREAM_FPS`, `source_type: "demo"`, `mode: "demo"`.
4. **`frontend/src/components/MetricCards.jsx`** — added FPS card (`⚡ Stream FPS`); `occupancy_percent` rounded to integer for cleaner display.
5. **`frontend/src/components/ConfidenceGauge.jsx`** — when `confidence === 0`, gauge fills empty, shows `–` and label "No inference data" instead of misleading `0%`.

---

## 2026-06-01 — Optimize YouTube Live Feed Playback

### Problem
YouTube HLS stream had high startup latency and slow reconnect on stream URL expiry.

### Changes

**`backend/src/inference/video_processor.py`** — `OPENCV_FFMPEG_CAPTURE_OPTIONS` extended:
- `probesize;500000` — caps OpenCV's input probe from the 5 MB default to 500 KB, cutting startup delay from ~5 s to under 1 s.
- `analyzeduration;500000` — limits stream analysis to 0.5 s before playback starts.
- `reconnect;1|reconnect_streamed;1|reconnect_delay_max;5` — enables ffmpeg-level auto-reconnect on HTTP errors, so transient CDN hiccups recover without the grab thread needing to re-resolve the URL.
- Consecutive-failure threshold for URL re-resolution reduced from 5 → 3 for faster recovery when the HLS URL does expire.

Format selection kept at `height<=480` for detail visibility.
