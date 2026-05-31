# Phase 1 Change Log

## 2026-05-31 — Fix YOLO26 Detect Training: Use Pretrained Weights

### What changed
Changed `YOLO("yolo26n.yaml")` to `YOLO("yolo26n.pt")` in `_train_yolo26_detect`. The `.yaml` form builds from random weights, causing near-zero mAP50 (0.1%) after 5 epochs. Using `.pt` loads COCO-pretrained weights and fine-tunes on the parking data.

### Files modified
- `backend/src/train/train_manager.py:268`

### Why
Detection with random weights requires hundreds of epochs to converge. With pretrained weights, 5 epochs of fine-tuning produces meaningful mAP50, matching how CNN/ResNet/MobileNet benefit from ImageNet pretraining.

---

## 2026-05-31 — Fix ROI Proposer Class Filter

### What changed
Fixed `_VEHICLE_CLASSES` in `roi_proposer.py` from COCO vehicle IDs `{2,3,5,7}` to `{0,1}` to match the custom YOLO26 detect model's classes (`0=vacant`, `1=occupied`). The mismatch caused every detection to be silently discarded, producing zero ROI proposals.

### Files modified
- `backend/src/inference/roi_proposer.py:22` — `_VEHICLE_CLASSES = frozenset([0, 1])`

### Why
The YOLO26 detect model was trained on parking spot annotations (vacant/occupied), not COCO. CNN, ResNet, and MobileNet models are unaffected — they operate on pre-cropped ROI images and never use this constant.

---

## 2026-05-31 — Camera Registry in Settings Panel

### What changed
Moved the Camera Registry from a standalone card in the main column into a collapsible "Camera Registry" sub-section inside the Settings Panel (side column). Made it compact to fit the narrower sidebar.

### Files modified
- `frontend/src/components/CameraManager.jsx` — Added `compact` prop. When `compact=true`: no card wrapper, smaller font/padding, Source column hidden in table, Activate/Deactivate shortened to On/Off, Delete becomes ✕, form collapses to 1-column grid with type as a dropdown alongside name.
- `frontend/src/components/SettingsPanel.jsx` — Imported CameraManager; added `onCamerasChange` prop; updated `SubSection` to accept `defaultOpen` prop (defaults true); added "Camera Registry" SubSection (defaultOpen=false, compact mode) above Controls.
- `frontend/src/pages/AdminView.jsx` — Removed standalone `<CameraManager>` from main column; removed its import; passed `onCamerasChange={setCameras}` to SettingsPanel so camera list still feeds MultiCameraGrid.

### Why
User requested a compact Camera Registry inside the Settings pane with dropdown menus for camera type. Consolidating into Settings avoids duplication and keeps the main column cleaner.

---

## 2026-05-31 — Delete ROIs from Camera Feed

### What changed
Added per-ROI delete capability directly inside the VideoFeed ROI editor panel.

### Files modified
- `frontend/src/components/VideoFeed.jsx` — Added `handleDeleteRoi` (calls `DELETE /api/roi/{cameraId}/{roiId}` and removes from local state). Added a compact chip list below the canvas showing all saved ROIs; each chip has a color swatch, label, and a ✕ delete button. The list is only visible when the ROI editor is open and ROIs exist.

### Why
Users had no way to remove individual saved ROIs directly from the camera feed view — they could only draw new ones or use the separate admin RoiManager page.

---

## 2026-05-31 — Model Activation for Live Camera Feeds

### What changed
Fixed model switching so it takes effect on live camera feeds, and added activation buttons directly in the Model Info panel.

### Root cause
`/api/use-model/{name}` only restarted the global `_processor` (the legacy `/ws/video` WebSocket). Live camera feeds each have their own `VideoProcessor` managed by `camera_registry` — these were untouched when the model changed.

### Files modified
- `backend/main.py` — In `use_model()`, after restarting the global processor, now iterates all active cameras and calls `camera_registry.activate(cam_id, model_name=model_name)` to restart each one with the new model. Returns `cameras_restarted` count in the response.
- `frontend/src/components/ModelStatus.jsx` — Added `fetchModelInfo` prop and `activating` state. Each trained (available) model now shows an "Activate" button; clicking it calls `/api/use-model/{name}` and refreshes model info. The currently active model is highlighted with a subtle background and an "Active" badge instead of a button.
- `frontend/src/components/SettingsPanel.jsx` — Passes `fetchModelInfo` down to `ModelStatus` so the active-model badge updates immediately after activation.

### Why
The Controls panel model selector only affected test-image analysis, not live feeds. Model activation now lives in Model Info where it's clearly tied to the currently active model.

---

## 2026-05-31 — LotMap slot colors from live camera feed

### What changed
The LotMap now shows green (vacant) / red (occupied) slot colors from the active camera's real-time inference results.

### Root cause
`LotMap` read its slot data from `metrics.slots`, which comes from the legacy `/ws/video` WebSocket. That WebSocket is connected to the global `_processor` (a DemoProcessor) — not to any camera-registry processor. So `metrics.slots` was always empty in camera mode, causing LotMap to fall back to `roiSlots` with `demo=true` (all gray).

### Fix
- `AdminView.jsx` — Added `liveSlots` state and `camWsRef`. A new `useEffect` watches the `cameras` list: whenever the active camera changes, it closes any previous WS and opens a new one to `/ws/cameras/{active.id}`. On each message, `liveSlots` is updated from `d.metrics.slots`.
- `AdminView.jsx` — The `LotMap` slot computation now has three tiers: (1) legacy `metrics.slots` if non-empty; (2) if `liveSlots` and `roiSlots` are both present, merge live statuses into roiSlots by slot ID so polygons/labels are preserved; (3) bare roiSlots as last fallback. `demo` prop is only `true` when neither source has data.

---

## 2026-05-31 — Controls: Demo/Live toggle feedback and live model activation

### What changed
Fixed the Demo/Camera toggle in Controls to show which mode is active, and made the "Live" button actually activate the selected model on live camera feeds.

### Root cause — two issues
1. `ControlPanel` received no `modelInfo`, so buttons had no active state. Both buttons always rendered as `btn-ghost`.
2. The "Camera" button called `/api/use-camera` which only switched the legacy `/ws/video` source to `0` — it did not change `_active_mode` and had zero effect on camera registry processors.

### Files modified
- `frontend/src/components/ControlPanel.jsx`:
  - Added `modelInfo` and `fetchModelInfo` props.
  - `isDemo = !modelInfo || modelInfo.active_model === 'demo'` drives button highlight: Demo gets `btn-primary` when demo is active; Live gets `btn-primary` otherwise.
  - Renamed "Camera" → "Live". Clicking it calls `/api/use-model/{selectedModel}` (which restarts all active camera processors with the chosen model).
  - Removed the separate "Load" button — Live button now subsumes it.
  - `useEffect` syncs the model dropdown to the server's active model when not in demo mode.
  - All mode actions call `fetchModelInfo()` after completing so the button state updates immediately.
- `frontend/src/components/SettingsPanel.jsx` — passes `modelInfo` and `fetchModelInfo` to `ControlPanel`.

---

## 2026-05-31 — Fix TESTING_CAMERA_ID ReferenceError in ControlPanel

### What changed
- `frontend/src/components/ControlPanel.jsx` line 12 — renamed `TESTING_TESTING_CAMERA_ID` → `TESTING_CAMERA_ID` to match all usages.

### Why
Typo introduced a doubled prefix (`TESTING_TESTING_`) on the constant declaration while all call sites used `TESTING_CAMERA_ID`, causing a ReferenceError at runtime.

---

## 2026-05-31 — YouTube Live Feed Performance Optimization

### What changed
YouTube HLS streams were blocking the inference loop for 2–8 s per segment boundary because `cap.read()` blocks until the next segment is downloaded. Fixed with three changes:

1. **Background grab thread** (`video_processor.py`) — `_loop` now dispatches to `_youtube_loop` for YouTube sources. A dedicated `_grab` thread owns the `cv2.VideoCapture` object and continuously calls `cap.read()`, always keeping the single freshest frame in a bounded `queue.Queue(maxsize=2)`. The inference loop reads from the queue with a non-blocking timeout, so detection runs immediately when a new frame is available without waiting on the network. Non-YouTube sources use the unchanged `_regular_loop` path. Frame processing logic was extracted to `_process_frame()` to avoid duplication.

2. **Minimal buffer size** (`video_processor.py`, `_open_capture`) — `CAP_PROP_BUFFERSIZE = 1` is set for YouTube captures so OpenCV's internal frame queue holds at most one decoded frame, reducing stale-frame lag.

3. **FFMPEG options rework** (`video_processor.py`, env var) — `OPENCV_FFMPEG_CAPTURE_OPTIONS` changed to `multiple_requests;0|fflags;nobuffer|live_start_index;-3`. Removed `reconnect;1|reconnect_streamed;1|reconnect_delay_max;5`: those options cause ffmpeg to enter a reconnect code-path that hits a host-mismatch check on every HLS segment (YouTube serves each segment from a different CDN node), logging "Cannot reuse HTTP connection for different host" and adding a full TCP+TLS handshake per segment. `fflags;nobuffer` reduces input buffering. `live_start_index;-3` starts 3 segments from the end of the live manifest so playback begins at the live edge instead of 30–60 s behind it.

4. **Prefer 480p format** (`youtube_resolver.py`) — yt-dlp format changed from `"best"` to `"best[height<=480]/best"`. Smaller segments download faster, reducing the time the grab thread blocks on each `cap.read()` call.

### Files modified
- `backend/src/inference/video_processor.py` — Added `_youtube_loop`, `_regular_loop`, `_process_frame`; updated `_loop`, `_open_capture`, FFMPEG env options.
- `backend/src/cameras/youtube_resolver.py` — Changed yt-dlp format to `"best[height<=480]/best"`.

---

## 2026-05-31 — Draw ROIs on Live Video Feed

### What changed
Added a "✎ Edit ROIs" button overlaid on the live VideoFeed. Clicking it captures the current frame, uploads it as a snapshot to the backend, then opens a full-screen ROI editor modal showing that frozen frame as background. The existing RoiEditor (polygon/rectangle drawing, undo/redo, proposals) is reused unchanged. Auto-detect also works because the snapshot is saved before the modal opens.

### Files modified
- `frontend/src/components/VideoFeed.jsx` — Full rewrite. Accepts new `activeCamera` and `apiBase` props. Manages ROI state (loads/saves from backend for the active camera's `roi_camera_id`). "✎ Edit ROIs" button appears in the LIVE overlay when a frame is available and a camera is assigned. Modal contains RoiEditor + Save/Auto-detect/Close controls.
- `frontend/src/pages/AdminView.jsx` — Passes `activeCamera={cameras.find(c => c.active) || null}` and `apiBase={API_BASE}` to VideoFeed.

### Why
The backend was drawing 18 hardcoded demo slots on the video feed because no ROIs were configured. The user wanted to draw ROI polygons directly on the live camera view rather than uploading a separate reference image through RoiManager. This flow captures the live frame as the background, so the parking slots the user draws align exactly with what the camera sees.

---

## 2026-05-31 — Live Camera Feeds moved into VideoFeed card

### What changed
Moved the "Live Camera Feeds" multi-camera grid from a standalone card in the main column into the VideoFeed glass-card, directly below the main video frame.

### Files modified
- `frontend/src/components/MultiCameraGrid.jsx` — Added `bare` prop. When `bare=true`, renders without the outer card div and instead uses a bordered-top padded div to integrate flush into the parent card. Consolidated empty/active branches into a single `inner` block.
- `frontend/src/components/VideoFeed.jsx` — Imported MultiCameraGrid; accepts new `cameras` prop (default `[]`); renders `<MultiCameraGrid cameras={cameras} bare />` between the video container and the ROI modal.
- `frontend/src/pages/AdminView.jsx` — Removed standalone `<MultiCameraGrid cameras={cameras} />`; removed its import; passes `cameras={cameras}` to VideoFeed.

### Why
User wanted the camera grid to appear directly after the main video frame within the same card, keeping the feed section unified.

---

## 2026-05-31 — Remove main video img; MultiCameraGrid is now primary display

### What changed
Removed the `<img alt="Parking lot live feed" ...>` and its container (placeholder, overlay) from VideoFeed. MultiCameraGrid is now the primary video display. A slim toolbar row above the grid shows the LIVE badge and "✎ Edit ROIs" button (ROI editing still works — `frame` from WebSocket is used as the snapshot background when the modal opens).

### Files modified
- `frontend/src/components/VideoFeed.jsx` — Removed `style.container`, `style.img`, `style.overlay`, `style.placeholder`, `style.placeholderIcon`, and the entire video container div with the `<img>`. Replaced with a compact toolbar div (LIVE badge + Edit ROIs button) above the `<MultiCameraGrid bare />`.

### Why
User pointed out the img was not removed in the previous step.

---

## 2026-05-31 — Fix MobileNetV4 BatchNorm crash during model instantiation

### What changed
`ParkingMobileNetV4.__init__` probed the backbone's output feature dimension with a batch-size-1 dummy forward pass while the backbone was still in training mode. MobileNetV4's architecture includes a BatchNorm layer that receives a 1×1 spatial tensor `[1, 1280, 1, 1]` at the end of the network; PyTorch's BatchNorm requires more than one value per channel when in training mode, so this probe always crashed.

### Files modified
- `backend/src/models/cnn_transfer.py` — Call `self.backbone.eval()` immediately before the dummy probe, then restore `self.backbone.train()` after, so the freeze logic below can apply its own eval() override as expected. This is a 2-line targeted fix; the existing `train()` override and `backbone.eval()` guard for frozen backbones are unchanged.

### Why
Training any MobileNetV4 model always raised `ValueError: Expected more than 1 value per channel when training, got input size torch.Size([1, 1280, 1, 1])` before even reaching the training loop, because the crash occurred inside `create_model("mobilenetv4")` during model construction.

## 2026-05-31 — Fix Model Info glass-card: remove dead-end, list available

### What changed
Corrected the model list in the **Model Info** glass-card (`ModelStatus.jsx`):
- Removed `mobilenetv2` — dead-end entry whose key never existed in the backend's `available_models` response, so it always showed as "Not trained".
- Added `yolo26_classify` (YOLO26 Classify) — was missing despite the backend tracking it.
- Renamed `yolo26` label from "YOLO26" → "YOLO26 Detect" for clarity.

The card now lists exactly the five models the backend exposes:
`cnn_scratch`, `resnet50`, `mobilenetv4`, `yolo26_classify`, `yolo26` (detect).

### Files modified
- `frontend/src/components/ModelStatus.jsx` — replaced the `models` array (lines 32-38) to match backend `available_models` keys exactly.

---

## 2026-05-31 — Remove ROI annotation overlay from live camera feeds

### What changed
The backend's `VideoProcessor._loop` was calling `self._detector.draw_overlay()` on every frame and storing the annotated result as `self._frame`. This caused the camera WebSocket (`/ws/cameras/{id}`) to stream frames with coloured bounding boxes and a summary bar baked into the JPEG, which appeared as a "fake ROI" overlay in the `CameraFeedCell` live feed display (`<img src="data:image/jpeg;base64,...>">`).

Removed the `draw_overlay` call and the `cv2.putText` model-name watermark from the processing loop. `self._frame` now stores the plain resized frame; detection result and metrics are still computed and streamed, just no longer painted onto the video.

### Files modified
- `backend/src/inference/video_processor.py` — Deleted `annotated = self._detector.draw_overlay(frame.copy(), result)` and the `cv2.putText` watermark block; changed `self._frame = annotated` to `self._frame = frame`.

---

## 2026-05-31 — Restore ROI polygon outlines on live camera feeds (without detection coloring)

### What changed
Removing `draw_overlay` also removed the visual feedback for user-configured ROI zones. Added selective polygon outline drawing in `VideoProcessor._loop` that draws just the ROI polygon boundaries (yellow outlines + label) without any detection fill or occupation-status coloring. ROI data is cached locally and refreshed ~once per second to avoid per-frame disk reads.

### Files modified
- `backend/src/inference/video_processor.py` — Added `numpy` and `RoiStore` imports; added `_roi_cache` / `_roi_cache_ts` fields in `__init__`; in `_loop`, after detection, draws `cv2.polylines` + label for each saved polygon onto a copy of the frame before storing as `self._frame`.

---

## 2026-05-31 — Fix WebSocket TLS close race in `camera_ws`

### Problem
`backend/main.py` `camera_ws` was calling `await websocket.close()` immediately after sending an error JSON response. The client (`CameraFeedCell`) simultaneously calls `ws.close()` on receipt of the error, so both sides raced to send a WebSocket CLOSE frame. The side that arrived second found the TLS socket already gone and emitted:
```
Writing encrypted data to socket failed
[tls @ ...] Failed to send close message
```

### Fix
Removed both explicit `await websocket.close()` calls from the two error-return paths (`cam is None` and `proc is None`). Starlette automatically sends a proper CLOSE frame when the async handler returns, so just `return` is sufficient — no race condition.

### Note
The separate `[tls @ ptr]` ffmpeg messages are from the YouTube HLS stream expiring/reconnecting and are handled by the existing reconnect logic in `video_processor._loop` (re-resolves URL after 5 consecutive failed frame grabs).

### Files modified
- `backend/main.py` — Removed `await websocket.close()` from both error-return paths in `camera_ws`.

---

## 2026-05-31 — Lot Map: replace fake demo slots with real ROI shapes

### What changed
Removed the hardcoded `DEMO_SLOTS` array (18 fake rectangular slots in a 9×2 grid) from `AdminView`. When no live inference data is available, the Lot Map now fetches the actual saved ROI polygons from the backend and renders their true shapes.

- On load and every 10 s, `fetchCameras` fetches the camera list and passes it to `fetchRoiSlots`. That function resolves the active camera's `roi_camera_id` (falling back to `"default"`) and calls `GET /api/roi/{cameraId}` to get the saved polygons.
- Each ROI's normalized polygon points are scaled to a 1000×600 canvas coordinate space via `roiToSlot()`, which also computes the bounding-box for the SVG `viewBox`.
- `LotMap` was updated to render `<polygon>` SVG elements when a slot carries a `polygon` field, preserving exact quadrilateral / irregular shapes. The fallback `<rect>` path is kept for live inference slots (which only carry a `bbox`). The "Demo" badge label was changed to "ROI" to reflect the source.

### Files modified
- `frontend/src/pages/AdminView.jsx` — Removed `DEMO_SLOTS`; added `roiToSlot()` helper and `CANVAS_W/H` constants; added `roiSlots` state; added `fetchRoiSlots(camList)` (useCallback); refactored `fetchCameras` into a useCallback that calls `fetchRoiSlots` after updating camera state; passed `roiSlots` to `<LotMap>` as the no-live-data fallback.
- `frontend/src/components/LotMap.jsx` — Added `<polygon>` rendering branch (when `s.polygon` is present); centralised `cx/cy` centroid variables used by both `<rect>` and `<polygon>` label positions; renamed "Demo" badge to "ROI".

### Why
The previous Lot Map showed hardcoded fake parking spots that had nothing to do with the actual camera layout. The ROI editor is where the real slot geometry lives; the map should reflect those edits so operators get an accurate spatial overview even before inference runs.

---

## 2026-05-31 — Fix Lot Map still showing 18 demo slots (DemoProcessor source)

### What changed
The frontend change above was correct but incomplete. `DemoProcessor._compute_metrics` was emitting a `slots` array with 18 fake entries (bbox + status per slot), so `metrics.slots.length > 0` was always true and the frontend never reached the `roiSlots` fallback.

Removed the `slots` list from `_compute_metrics`. The demo mode still:
- Renders its animated video frame with coloured rectangles (unchanged)
- Reports aggregate counts (total/available/occupied/occupancy_percent) for the metric cards

But it now sends `slots: []`, letting the frontend Lot Map fall through to the real saved ROIs.

### Files modified
- `backend/src/inference/demo_processor.py` — `_compute_metrics`: replaced the 18-entry slots list comprehension with `"slots": []`.

---

## 2026-05-31 — Remove background image from ROI Editor popup

### What changed
Removed the `<img alt="reference" ...>` element that was rendered as the background inside the ROI Editor canvas overlay. The editor now shows a plain dark canvas for drawing ROI polygons.

- Replaced `imgRef` with `containerRef` pointing to the wrapper `<div>`.
- `syncSize` now reads canvas dimensions from the container div (`clientWidth` / `clientHeight`, min 500px) instead of the `<img>` element's rendered size.
- Removed the early-return guard `if (!backgroundImage) return null` (callers already guard with their own conditions).
- Canvas is now `display: block; width: 100%` (block-level) inside a `position: relative` container with `minHeight: 500` and a subtle dark background.

### Files modified
- `frontend/src/components/RoiEditor.jsx` — Removed `imgRef`, `<img>` element and its `onLoad` handler; added `containerRef`; updated `syncSize`; removed early-return guard; changed canvas from `position: absolute` overlay to block-level.

### Why
User wanted the captured frame image removed from the ROI editor popup — only the drawing canvas should be visible.

---

## 2026-05-31 — Suppress ffmpeg CDN connection-reuse warning for YouTube HLS

### What changed
Added `OPENCV_FFMPEG_CAPTURE_OPTIONS` environment variable at `video_processor.py` module level (via `os.environ.setdefault`) with four ffmpeg HTTP options:
- `multiple_requests;0` — do not try to reuse an HTTP connection for a different host
- `reconnect;1` — auto-reconnect on failure
- `reconnect_streamed;1` — also reconnect for streamed content
- `reconnect_delay_max;5` — cap reconnect back-off at 5 s

### Root cause
YouTube HLS `.m3u8` playlists distribute video segments across multiple CDN nodes (e.g. `rr5---sn-...googlevideo.com` vs `rr1---sn-...googlevideo.com`). ffmpeg tries to reuse the open TCP connection for the next segment; when the segment lives on a different hostname, it cannot, and logs:
```
Cannot reuse HTTP connection for different host: rr5---sn-... != rr1---sn-...
```
This is harmless by itself, but can trigger the fail-counter in `_loop` if `cap.read()` briefly returns `False` during the host switch, eventually causing an unnecessary full URL re-resolve.

### Files modified
- `backend/src/inference/video_processor.py` — Added `import os`; added `os.environ.setdefault(...)` block after imports.

---

## 2026-05-31 — Fix ROI Editor canvas: render camera frame as background

### What changed
The ROI Editor canvas was completely opaque/blank when opened from "Edit ROIs" — the captured camera frame was passed as `backgroundImage` but never actually rendered. Users could not see the parking lot frame and had no reference for where to draw slots.

- Added `bgImgRef` ref to cache the loaded `Image` object.
- Added `useEffect` that loads `backgroundImage` as an `HTMLImageElement` on prop change, then calls `syncSize()` + `redraw()` once loaded.
- `redraw()` now calls `ctx.drawImage(bgImgRef.current, 0, 0, W, H)` at the start (before ROI overlays), so the frame fills the canvas.
- `syncSize()` now derives canvas height from the image's natural aspect ratio (`w * naturalHeight / naturalWidth`) when an image is loaded, so the canvas matches the exact proportions of the camera frame. Falls back to `max(containerHeight, 500)` when no image is present.

### Files modified
- `frontend/src/components/RoiEditor.jsx` — Added `bgImgRef`; updated `syncSize` for aspect-ratio sizing; added image-loading `useEffect`; added `ctx.drawImage` call at the top of `redraw`.

### Why
User confirmed they want to see the live camera feed while drawing ROIs — no static snapshot, no modal. The ROI canvas is now overlaid directly on the live MultiCameraGrid so the video plays through.

---

## 2026-05-31 — ROI editor: direct canvas overlay on live camera grid

### What changed
Removed the full-screen fixed modal from VideoFeed entirely. ROI editing now overlays the canvas directly on top of the MultiCameraGrid so the live camera feed is always visible while drawing.

- When "Edit ROIs" is clicked, the toolbar row switches to ROI controls (camera name · Auto-detect · Save · Done). The grid area gets a `position: relative` wrapper and `<RoiEditor overlay>` is absolutely positioned on top.
- Removed the `<img data:image/jpeg ...>` background — no frozen frame is shown.
- The RoiEditor's drawing toolbar and proposals toolbar gain a `rgba(0,0,0,0.6) + backdropFilter: blur(4px)` background in overlay mode so buttons remain readable over the video.
- `openRoiEditor` no longer requires `frame` to proceed; the snapshot upload (for auto-detect) runs only when a frame is available and is non-fatal.

### Files modified
- `frontend/src/components/VideoFeed.jsx` — Replaced fixed modal with inline overlay; merged ROI controls into top toolbar row; simplified `openRoiEditor`.
- `frontend/src/components/RoiEditor.jsx` — Drawing toolbar and proposals toolbar pick up a dark backdrop in `overlay` mode.

---

## 2026-05-31 — ROI Namespace Isolation (Controls vs. Live Feed)

### What changed
Three changes to prevent testing ROIs from colliding with or replacing live-camera ROIs, and to exclude them from the Lot Map and Heat Map.

**1. Distinct ID prefixes per source**
`RoiEditor` now accepts an `idPrefix` prop (default `'roi'`). The `makeRoi` function stamps every new ROI with `{idPrefix}_{timestamp}_{random}`. ControlPanel passes `idPrefix="test"` and VideoFeed passes `idPrefix="cam"`, so IDs from the two contexts are visually and programmatically distinct.

**2. Isolated storage for testing ROIs**
`ControlPanel` previously read/wrote to camera ID `default`, the same slot used by the live feed for `default` cameras. It now uses the dedicated ID `ctrl_testing`. All snapshot uploads, ROI fetches, ROI saves, and `analyze-roi` calls in ControlPanel use `ctrl_testing`.

**3. LotMap / HeatmapView exclusion is automatic**
`AdminView.fetchRoiSlots` resolves the camera ID from the active camera's `roi_camera_id || id`, which is always a real camera name. Since no real camera is ever `ctrl_testing`, testing ROIs are never loaded into `roiSlots` and never appear in the Lot Map or Heat Map templates.

### Files modified
- `frontend/src/components/RoiEditor.jsx` — Added `idPrefix` prop (default `'roi'`); `makeRoi` uses it in the generated ID; `idPrefix` added to `makeRoi`'s dependency array.
- `frontend/src/components/ControlPanel.jsx` — Renamed `CAMERA_ID` constant to `TESTING_CAMERA_ID = 'ctrl_testing'`; updated all API calls; passed `idPrefix="test"` to `<RoiEditor>`.
- `frontend/src/components/VideoFeed.jsx` — Passed `idPrefix="cam"` to `<RoiEditor>`.

### Why
User reported that saving ROIs from the Controls panel replaced live-camera ROIs. The root cause was both surfaces writing to the same `default` camera ID. The fix namespaces testing ROIs to `ctrl_testing` so each surface owns its own storage slot.

---

## 2026-05-31 — Fix ROI coordinate mismatch between editor canvas and video frame

### What changed
ROIs drawn in the VideoFeed editor were not appearing in the expected positions on the live camera feed. The previous implementation overlaid `<RoiEditor overlay>` over the entire `MultiCameraGrid` container (which includes a ~27 px title bar, 16 px top padding, and ~50 px totals row). The canvas therefore covered more than the video cell, causing a systematic offset: canvas y=0 was ~9 px above the video top, and the video bottom only reached ~87 % of the canvas height. VideoProcessor mapped the stored normalized coords 1-to-1 onto the 900×500 frame, so ROIs appeared shifted/compressed relative to where the user drew them.

Two additional issues were fixed at the same time:
- The snapshot uploaded for auto-detect proposals used `frame` from the legacy `/ws/video` WebSocket (which may be from the wrong camera), not the active camera's feed.

**Fix**: replaced the overlay approach with a background-image approach:

1. When "Edit ROIs" is clicked, `captureEditFrame()` opens a short-lived WebSocket to `/ws/cameras/{cameraId}`, receives the first frame, and closes immediately. That frame is stored as `editBg`.
2. The ROI editor is now rendered in non-overlay (background-image) mode inside a container with `aspectRatio: 900 / 500` (matching `config.FRAME_WIDTH / FRAME_HEIGHT`). `RoiEditor` draws `ctx.drawImage(bgImg, 0, 0, W, H)`, which maps the 900×500 frame exactly onto the canvas regardless of the container's pixel size. The user draws on the camera image, and every normalized coordinate saved is identical to VideoProcessor's coordinate space.
3. When `editBg` arrives, it is also uploaded to `POST /api/roi/{cameraId}/snapshot` for auto-detect, replacing the incorrect legacy-frame upload.
4. The `MultiCameraGrid` is hidden while editing (shown only when `!roiOpen`), so the editor canvas is unambiguously the reference for drawing.

### Files modified
- `frontend/src/components/VideoFeed.jsx` — Added `editBg` state, `editWsRef`, `captureEditFrame` callback, snapshot-upload effect; modified `openRoiEditor`; replaced overlay render with background-image `RoiEditor` in `aspectRatio: 900/500` container; added `FRAME_W`/`FRAME_H` constants.

### Why
Drawn ROIs were not appearing where the user placed them. Root cause was the canvas covering the full MultiCameraGrid (title + padding + totals) rather than just the video cell, so coordinates were offset by ~9 px vertically and the bottom ~13 % of the frame was unreachable. Switching to background-image mode with a locked 9:5 aspect ratio gives exact 1-to-1 coordinate mapping with the VideoProcessor frame.

---

## 2026-05-31 — Remove slot name labels from live feed map and video overlay

### What changed
Slot names (e.g. "Slot 1", "Slot 2") are no longer rendered in either display surface:

1. **Video overlay** — Removed the `cv2.putText` call that drew each ROI's `label` string at the polygon centroid. Polygon outlines are still drawn.
2. **Lot Map (LotMap.jsx)** — Removed the primary `<text>` SVG element that displayed `s.label || #${s.id}` over each slot shape. The occupancy-status text (`FREE` / `OCC` / `MISP`) is retained but re-centred to the slot centroid.

### Files modified
- `backend/src/inference/video_processor.py` — Deleted centroid computation and `cv2.putText` label call from the ROI polygon loop in `_process_frame`.
- `frontend/src/components/LotMap.jsx` — Removed `label` variable; removed the label `<text>` element; moved the status `<text>` to `cy` (was `cy + fontSize * 1.1`).

### Why
User requested slot names be hidden from both the live video feed overlay and the Lot Map display.

---

## 2026-05-31 — Fix "Unknown model 'demo'" warning on startup

### What changed
`config.ACTIVE_MODEL` defaults to `"demo"` (a mode flag, not an inference model). This string was flowing into `ParkingClassifier.__init__` via `model_name or config.ACTIVE_MODEL`, then hitting `create_model("demo")` which raised `ValueError: Unknown model 'demo'` — logged as a warning on every camera activation.

### Fix
- `ParkingClassifier.__init__` now filters the candidate model name against `_INFERENCE_MODELS = {"cnn_scratch", "resnet50", "mobilenetv4", "yolo26_classify", "yolo26"}`. Any non-inference value (including `"demo"`) resolves to `self.model_name = None`.
- `ParkingClassifier.load()` guards for `self.model_name is None` and returns immediately without touching `model_factory`, so no warning is emitted.
- `VideoProcessor._load_detector()` log message updated: when `classifier.model_name is None` it logs an informational "no model selected" message instead of the misleading weights-not-found warning.

### Files modified
- `backend/src/inference/classifier.py` — added `_INFERENCE_MODELS` set; updated `__init__` to filter; added early-return in `load()` for `None`.
- `backend/src/inference/video_processor.py` — updated `_load_detector()` log branch for `None` model.

---

## 2026-05-31 — Evaluate All: replace faulty Compare-All retrain with evaluate-only + Excel export

### Problem
The "Compare All" button in the Training panel called `start_training('cnn_scratch', compare_all=True)`, which ran `_compare_all()`. That method **retrained every model from scratch** before evaluating — it did not evaluate existing trained weights. It was placed in Training, which is the wrong location for post-training analysis.

### What changed

**Backend `src/train/train_manager.py`**
- Added `start_evaluation()` — initialises the shared `_state` machine and spawns `_evaluate_all` in a daemon thread.
- Added `_evaluate_all()`:
  - CNN Scratch / ResNet-50 / MobileNetV4: loads saved `.pth` weights with `load_model()`, runs `evaluate_model()` on the held-out test loader, reads epochs/train-time from `history_{name}.json`.
  - YOLO Classify: reads the last row of `outputs/yolo26_classify/run/results.csv` (accuracy_top1, loss, time).
  - YOLO Detect: reads the last row of `outputs/yolo26_detect/run/results.csv` (mAP50, precision, recall, time).
  - Skips models whose weight files do not exist.
  - Saves results to `outputs/model_comparison.json` (same schema as before).
  - Progress is reported through the existing `/api/train/status` state machine.

**Backend `main.py`**
- Added `_build_comparison_excel(comparison)` — builds a coloured `.xlsx` with `openpyxl`:
  - Header row: indigo-700 background, white bold text.
  - CNN rows: blue-100, YOLO Classify rows: amber-100, YOLO Detect rows: violet-100.
  - Best value per metric column highlighted in green-200, bold.
  - N/A cells: slate-100 with "—".
  - Footer note explaining metric sources.
  - Frozen header row, column widths set, number formats.
- Added `POST /api/evaluate/all` — calls `TrainManager().start_evaluation()`.
- Added `GET /api/evaluate/excel` — reads `model_comparison.json`, builds Excel, returns as file download attachment.
- Added `from fastapi.responses import Response` import.

**Backend `requirements.txt`** — added `openpyxl>=3.1.0`.

**Frontend `TrainingPanel.jsx`** — removed "⚡ Compare All" button (was the faulty retrain path).

**Frontend `ModelStatus.jsx`**
- Added `apiBase` prop (needed for polling and evaluate endpoints).
- Added "📊 Evaluate All" button: calls `POST /api/evaluate/all`, then polls `/api/train/status` every 2 s; calls `fetchModelInfo()` on completion.
- Added indeterminate animated progress bar during evaluation.
- Added "📥 Excel" button (visible once comparison results exist): opens `GET /api/evaluate/excel` to trigger download.
- Comparison table expanded to show Precision, Recall, F1, and Train Time; active model row highlighted.

**Frontend `SettingsPanel.jsx`** — passes `apiBase` to `ModelStatus`.

**Frontend `src/index.css`** — added `@keyframes indeterminate` for progress bar animation.

### Why
The old Compare All button was misleading: it retrained models instead of evaluating existing ones, wasting training time. Evaluation belongs in Model Info (not Training). Excel export gives the admin a documented, shareable record of model performance with visual quality indicators.

---

## 2026-05-31 — Model Info panel redesign: trained status + training details accordion; Controls "Use" button

### What changed
Removed Activate buttons from the Model Info panel. Replaced with clear "Trained" / "Not trained" status badges. Each model row is now clickable and expands an accordion that shows the full training profile for that model. The Controls panel's "Test" button was renamed "Use".

**Model Info panel (`ModelStatus.jsx`)**
- Removed `activating` state and `handleActivate` — no more per-model Activate button.
- Each model row shows a colored dot + "Trained" (green badge) or "Not trained" (red badge).
- Clicking any row toggles an accordion below it showing: epochs, train/val accuracy, train/val loss, best val accuracy, total training time, test accuracy, test F1 (from comparison run), and for YOLO Detect: mAP@50, precision, recall.
- `apiAction` prop removed from destructure (no longer needed in this component).
- Comparison table at the bottom is retained as an at-a-glance summary across all models.

**Backend (`main.py`)**
- Added `_load_model_training_details()` helper that reads:
  - `outputs/history_{model}.json` for CNN Scratch / ResNet-50 / MobileNetV4 (epochs, train/val acc and loss, epoch times).
  - `outputs/yolo26_classify/run/results.csv` (last row) for YOLO Classify (epochs, val accuracy top-1, train/val loss, cumulative time).
  - `outputs/yolo26_detect/run/results.csv` (last row) for YOLO Detect (epochs, mAP@50, precision, recall, cumulative time).
- `/api/model/info` response now includes `"model_details"` key with the above per-model dict.

**Controls panel (`ControlPanel.jsx`)**
- Renamed "Test" button label → "Use" (title updated to "Use selected model").

### Files modified
- `backend/main.py` — Added `_load_model_training_details()`; added `model_details` to `/api/model/info` response.
- `frontend/src/components/ModelStatus.jsx` — Full redesign: removed activate logic; added accordion per model; shows trained/not-trained badge; reads `modelInfo.model_details` and `modelInfo.comparison`.
- `frontend/src/components/ControlPanel.jsx` — "Test" → "Use" label.

### Why
The Activate button in Model Info was confusing (model activation belongs in Controls where demo/live mode is selected). Users need visibility into training quality — epochs, accuracy, loss — before trusting a model for parking detection.

---

## 2026-05-31 — ROI polygon color coding on live video feed

### What changed
ROI polygon outlines on the live video feed are now colored by occupancy status instead of a fixed yellow:
- Green `(80, 200, 80)` — vacant
- Red `(60, 60, 220)` — occupied
- Gray `(180, 180, 180)` — unknown (no inference result yet)

### Root cause
`_process_frame` drew every ROI polygon with the hardcoded color `(255, 220, 80)` (which renders as blue in BGR). It never referenced the `result["slots"]` that `SlotDetector.detect()` returns on every frame. Slot IDs in `result["slots"]` are the same string IDs stored in the ROI JSON, so a simple dict lookup is sufficient.

### Files modified
- `backend/src/inference/video_processor.py` — Added `_STATUS_COLOR` dict and `status_map` (built from `result["slots"]`); polygon `color` is now looked up by ROI id before each `cv2.polylines` call.

---

## 2026-05-31 — Fix leftover polygon outlines in Lot Map and Usage Heatmap

### What changed
Two components rendered visible ROI polygon shapes when cameras are attached but inference isn't running, causing "leftover" outlines to appear inside the LOT MAP and USAGE HEATMAP glass-cards.

**LotMap (AdminView):** The slots computation fell through to `return roiSlots` when neither `metrics.slots` nor `liveSlots` had data. This passed the raw ROI polygon shapes as slots, so LotMap rendered them as gray demo outlines. Fixed by returning `[]` instead of `roiSlots` in the final fallback — LotMap's own `if (!slots || slots.length === 0) return null` then hides it cleanly.

**HeatmapView:** The canvas ROI-polygon branch was gated on `rois.length > 0` alone. With no heatmap data, all ROIs rendered as solid `hsla(120, 80%, 50%, 0.7)` green outlines (0% occupancy). Fixed by adding `&& heatmap && heatmap.length > 0` to the condition so the canvas only draws when real occupancy data is available; the component falls through to its "no data" message otherwise.

### Files modified
- `frontend/src/pages/AdminView.jsx` — Final fallback in LotMap slots expression changed from `return roiSlots` to `return []`.
- `frontend/src/components/HeatmapView.jsx` — Canvas branch condition changed from `rois.length > 0` to `rois.length > 0 && heatmap && heatmap.length > 0`.
