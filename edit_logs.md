# Edit Logs — Smart Parking AI Refactor

This document records every change made during the refactoring session,
including the problem identified, what was changed, and why.

---

## Session: Refactor & Fix (2026-05-28)

### Overview

The project had a working frontend dashboard and backend API skeleton, but the
real-time video/camera pipeline was entirely missing. Additionally, the backend
had thread-safety issues, a hardcoded Windows path, and duplicate imports.
The frontend contained dead template files from Vite's default scaffold.

---

### Change 1 — Create `backend/src/inference/video_processor.py`

**Problem:**
`main.py` (line 37) had the VideoProcessor import commented out:
```python
# from src.inference.video_processor import VideoProcessor
```
The `_get_processor()` function (lines 82–98) attempted to instantiate
`VideoProcessor` for real model modes (`cnn_scratch`, `resnet18`, `mobilenetv2`),
but the instantiation was also commented out (line 88). As a result, **all three
real model modes silently fell back to `DemoProcessor`** (synthetic data).
No real camera or video file could ever be processed.

**What was missing:**
The file `backend/src/inference/video_processor.py` did not exist at all.

**Fix:**
Created `VideoProcessor` class with the following design:
- Reuses the existing `SlotDetector` class (which already handles cropping slots
  from a frame and classifying them via `ParkingClassifier`).
- Opens a video source (webcam index `0` or a file path string) using OpenCV's
  `cv2.VideoCapture`.
- Runs a background daemon thread that reads frames, resizes to target dimensions
  (`FRAME_WIDTH × FRAME_HEIGHT` from config), runs `SlotDetector.detect()` on
  each frame, overlays slot annotations via `SlotDetector.draw_overlay()`, and
  adds a title banner.
- Video files are looped (when `cap.read()` returns `False` on a file source,
  the frame position is reset to 0).
- All shared state (`_frame`, `_metrics`, `_history`, `_heatmap`) is protected
  by a `threading.Lock` — safe for concurrent access from the WebSocket handler
  and REST endpoints.
- Implements the same public interface as `DemoProcessor`:
  `start_processing()`, `stop_processing()`, `set_video_source()`,
  `get_latest_frame_base64()`, `get_metrics()`, `get_history()`, `get_heatmap()`.
  This means `main.py` can use either processor interchangeably.

**File created:** `backend/src/inference/video_processor.py`

---

### Change 2 — Fix `backend/main.py`

**Problems:**

1. **Missing VideoProcessor wiring (lines 87–88):** The code block that should
   instantiate `VideoProcessor` was commented out. The comment on line 89
   (`logger.info(f"{mode} VideoProcessor initialised")`) ran regardless, falsely
   logging that the processor was ready while `_processor` remained `None`.

2. **No thread lock on global state (lines 79–80):** `_processor` and
   `_active_mode` are global variables accessed by the WebSocket handler,
   multiple REST endpoints, and the `_reset_processor()` function — potentially
   from different threads. There was no `threading.Lock` protecting them,
   creating a race condition where two concurrent requests could both see
   `_processor is None` and create two processors simultaneously.

3. **No input validation on `/api/analyze-lot` (lines 186–187):** The `rows`
   and `cols` parameters accepted any integer. A large value (e.g. `rows=10000`)
   would allocate a huge number of slot crops and could exhaust memory.

**Fix:**

1. Added `_processor_lock = threading.Lock()` as a module-level lock.
2. Wrapped `_get_processor()` body in `with _processor_lock:` so only one thread
   can initialize the processor at a time.
3. Wrapped `_reset_processor()` body in `with _processor_lock:` for the same reason.
4. Uncommented the `VideoProcessor` import and the instantiation inside
   `_get_processor()` so real models actually create a `VideoProcessor`.
5. Added bounds validation to `/api/analyze-lot`: `rows` and `cols` must each
   be between 1 and 50.

**File modified:** `backend/main.py`

---

### Change 3 — Fix `backend/config.py`

**Problem:**
Line 23 hardcoded a Windows-specific absolute path as the default for `PKLOT_ROOT`:
```python
PKLOT_ROOT = os.getenv("PKLOT_ROOT", r"D:\PKLot\PKLotSegmented")
```
This default would fail on any machine that is not the original developer's
Windows PC (and on any Linux/Mac, or in Docker containers).

**Fix:**
Changed the default to an empty string. The value must now be set via the
`PKLOT_ROOT` environment variable (or the `docker-compose.yml` volume mapping).
The `downloader.py` already checks whether the path exists before using it,
so an empty default is safe.

```python
PKLOT_ROOT = os.getenv("PKLOT_ROOT", "")
```

**File modified:** `backend/config.py`

---

### Change 4 — Fix `backend/src/train/train_manager.py`

**Problem:**
Several modules were imported twice at the top of the file:
- `import torch` — lines 12 and 23
- `from src.models.model_factory import create_model` — lines 17 and 24
- `from src.train.trainer import Trainer` — lines 18 and 25
- `from src.data_prep.preprocessor import prepare_dataset` — lines 19 and 26

The duplicate block (lines 22–28) also added two new imports that were only in
that block: `matplotlib`, `numpy`, `matplotlib` (again), and
`list_available_models`. This caused `import torch` and several others to appear
twice in the module, which is harmless in CPython (the second import is a no-op)
but is confusing and bad practice.

**Fix:**
Removed the duplicate import block. Consolidated all imports into a single clean
block at the top of the file, keeping all unique symbols that were needed
(`matplotlib`, `numpy`, `list_available_models`).

**File modified:** `backend/src/train/train_manager.py`

---

### Change 5 — Delete frontend dead files

**Problem:**
Three files were present in `frontend/src/` that are remnants of Vite's default
TypeScript project template and are not used by the application:

| File | Why it's dead |
|------|--------------|
| `frontend/src/counter.ts` | Vite template demo file. Not imported anywhere. |
| `frontend/src/main.ts` | Vite template TypeScript entry. The actual entry point is `main.jsx` (referenced in `index.html` line 14). |
| `frontend/src/style.css` | Vite template stylesheet. Not imported in any component. |

These files add noise, could confuse readers of the project, and in the case of
`main.ts`, could mislead someone into thinking it is the entry point.

**Fix:**
Deleted all three files.

**Files deleted:**
- `frontend/src/counter.ts`
- `frontend/src/main.ts`
- `frontend/src/style.css`

---
