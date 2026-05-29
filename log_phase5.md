# Phase 5 — Multi-Camera Registry

**Date:** 2026-05-29

## Goal
Allow multiple cameras to be registered and viewed simultaneously, with persistent activation across server restarts.

---

## Backend

### `backend/src/cameras/__init__.py`
Empty package marker.

### `backend/src/cameras/camera_registry.py`
- `CameraRegistry` class (module-level singleton `camera_registry`).
- Persists camera list to `backend/cameras.json`: fields `id`, `name`, `source`, `type`, `roi_camera_id`, `active`, `added_at`.
- `_processors: dict[str, VideoProcessor]` — lazy-created on `activate()`.
- `threading.RLock` for thread safety across all public methods.
- **`add_camera(id, name, source, type_, roi_camera_id)`** — raises `ValueError` if id already exists, then saves.
- **`remove_camera(id)`** — deactivates first, then deletes from dict and file.
- **`activate(id, model_name=None)`** — stops any existing processor, creates `VideoProcessor`, resolves source (int for USB, string for RTSP/file), calls `start_processing()`, sets `active=True`.
- **`deactivate(id)`** — calls `stop_processing()`, sets `active=False`.
- **`get_all() / get(id) / get_processor(id)`** — thread-safe reads.
- On module load: calls `_restore_active()` which re-activates cameras that were `active=True` in the persisted JSON.

### `backend/main.py`
- Added `from contextlib import asynccontextmanager`.
- Added `from src.cameras.camera_registry import camera_registry`.
- Added `import re` (for slug generation).
- Replaced bare `FastAPI(...)` with a `lifespan` context manager that deactivates all cameras on shutdown.
- **New REST endpoints:**
  - `GET  /api/cameras` → `camera_registry.get_all()`
  - `POST /api/cameras` (body: `{name, source, type, roi_camera_id?}`) — auto-generates id from slugified name + 6-char uuid, returns 201 with camera dict.
  - `DELETE /api/cameras/{camera_id}` → 404 if not found.
  - `POST /api/cameras/{camera_id}/activate` — passes `_active_mode` as model name.
  - `POST /api/cameras/{camera_id}/deactivate`.
- **New WebSocket:**
  - `WS /ws/cameras/{camera_id}` — same streaming loop as `/ws/video` but uses `camera_registry.get_processor(camera_id)`. Sends `{"error": "Camera not found"}` and closes if camera or processor is absent.

---

## Frontend

### `frontend/src/components/CameraManager.jsx`
- Fetches `GET /api/cameras` on mount; exposes `onCamerasChange` callback so `App.jsx` can sync state.
- Table: Name | Type | Source | Status (Active/Idle badge) | Actions (Activate/Deactivate toggle + Delete with `window.confirm`).
- Collapsible "Add Camera" form: Name (required), Source (required), Type select (usb/rtsp/file), ROI Config ID (optional).
- Inline error display. All styles via inline style object using CSS variables.

### `frontend/src/components/CameraFeedCell.jsx`
Props: `cameraId`, `name`, `onMetricsUpdate(cameraId, metrics)`.
- Manages its own WebSocket to `/ws/cameras/{cameraId}`.
- Reconnects automatically on disconnect (3 s delay, same pattern as `App.jsx`).
- Renders `<img>` with base64 JPEG frame, camera name overlay at bottom, and `■ N avail / ■ N occ` badges.
- Connection status dot (green = connected, red = disconnected) in top-right corner.
- Calls `onMetricsUpdate` whenever new metrics arrive from the socket.

### `frontend/src/components/MultiCameraGrid.jsx`
Props: `cameras` (array from `GET /api/cameras`).
- Filters to `active === true` cameras.
- Responsive CSS grid: 1 col (1 camera), 2 cols (2), 3 cols (3+).
- Each cell: `<CameraFeedCell cameraId={cam.id} name={cam.name} onMetricsUpdate={handleMetricsUpdate} />`.
- Aggregates metrics from all cells via `metricsMap` state keyed by `cameraId`.
- "Unified Totals" bar below the grid: total slots, total available, total occupied.
- Shows "No active cameras. Activate one above." when no active cameras.

### `frontend/src/App.jsx`
- Imported `CameraManager` and `MultiCameraGrid`.
- Added `cameras` state; `fetchCameras()` hits `GET /api/cameras`.
- Poll interval changed from 5 s to 10 s (history + heatmap + model info + cameras all fetched together).
- Initial fetch runs on mount (not just after the first interval tick).
- `<CameraManager onCamerasChange={setCameras} />` and `<MultiCameraGrid cameras={cameras} />` inserted in `main-column` between `<VideoFeed>` and `<AnalyticsChart>`.

---

## Design Decisions

- **Source stored as string** — `cameras.json` always stores source as a string; `activate()` converts to `int` when `type === "usb"`.
- **`model_name` passed at activate time** — `camera_registry.activate(id, model_name=_active_mode)` so camera processors use the currently selected model, not the config default.
- **`onCamerasChange` callback** — `CameraManager` is the owner of camera mutations (add/delete/toggle), so it can push the fresh list back to `App` state without requiring `App` to poll more aggressively.
- **3-column max grid** — balances visibility on wide and narrow screens without needing per-breakpoint logic.
- **Lifespan over `@app.on_event`** — `@app.on_event("shutdown")` is deprecated in FastAPI; `asynccontextmanager` lifespan is the current pattern.
