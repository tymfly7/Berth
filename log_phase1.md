# Phase 1 — Admin-Configurable ROI System

## Summary
Replaced the hardcoded 18-slot parking grid with a fully admin-configurable
Region of Interest (ROI) system. Admins can now draw arbitrary polygons or
rectangles over a reference image to define parking slots; the backend uses
those ROIs for real-time detection instead of `spots_config.json`.

---

## Backend

### NEW: `backend/src/roi/__init__.py`
Empty package init so `from src.roi.roi_store import RoiStore` resolves.

### NEW: `backend/src/roi/roi_store.py`
`RoiStore` class — all class-level methods, no instance required.

| Method | Description |
|---|---|
| `get_rois(camera_id)` | Returns list of ROI dicts from `roi_configs/<id>.json` |
| `save_rois(camera_id, rois)` | Validates all coords in 0–1, writes JSON |
| `delete_roi(camera_id, roi_id)` | Removes one ROI by id, returns `False` if not found |
| `save_snapshot(camera_id, image_bytes)` | Decodes image, writes `<id>_snapshot.jpg`, returns `{path, width, height}` |
| `get_snapshot_path(camera_id)` | Returns `Path` or `None` |

ROI dict shape: `{ "id": str, "label": str, "polygon": [[x_norm, y_norm], ...], "color": str }`  
Storage dir: `backend/roi_configs/` (auto-created).  
Logger: `smartpark.roi`.

### MODIFIED: `backend/main.py`
Added import and four endpoints (no rate limit, require API key):

| Method | Path | Action |
|---|---|---|
| GET | `/api/roi/{camera_id}` | Return ROI list |
| POST | `/api/roi/{camera_id}` | Body `{"rois":[...]}` → save, return `{"saved": n}` |
| DELETE | `/api/roi/{camera_id}/{roi_id}` | Delete one ROI; 404 if not found |
| POST | `/api/roi/{camera_id}/snapshot` | Upload JPG/PNG; save snapshot |

The snapshot route is declared before the `{roi_id}` route to ensure FastAPI
correctly matches it by method (POST vs DELETE).

### MODIFIED: `backend/src/inference/slot_detector.py`
- Added `camera_id: str = "default"` parameter to `__init__` and `detect()`.
- `detect()` now calls `RoiStore.get_rois(camera_id)` on every invocation.
  - **ROIs present** → `_detect_from_rois()`: for each ROI, compute axis-aligned
    bounding box from `min/max` of the normalized polygon vertices scaled to
    `frame.shape`, crop, classify.
  - **No ROIs** → `_detect_from_slots()`: existing `spots_config.json` behavior
    (unchanged).
- Slot `"id"` is the ROI string id when using ROIs, integer otherwise.
- Refactored shared aggregate stats into `_aggregate()` helper.

### MODIFIED: `backend/src/inference/video_processor.py`
- Added `camera_id: str = "default"` to `__init__`; stored as `self.camera_id`.
- `_load_detector()` passes `camera_id` to `SlotDetector`.
- `_loop()` passes `camera_id=self.camera_id` to `detect()`.
- `get_heatmap()`: `int(sid)` cast wrapped in `try/except` — falls back to the
  raw string for ROI-based string slot IDs.

---

## Frontend

### NEW: `frontend/src/components/RoiEditor.jsx`
Canvas-based polygon/rectangle drawing tool.

**Props:** `backgroundImage` (base64 data-URL), `rois` (array), `onRoisChange`

- `<div position:relative>` containing `<img>` + `<canvas>` (absolute overlay).
- Canvas buffer resized to `img.clientWidth × img.clientHeight` on image load
  and window resize.
- **Toolbar**: Polygon | Rectangle | Delete Selected (disabled if none) | Clear All
- **Polygon mode**: click → add vertex; double-click → close (removes the extra
  vertex added by the click-part of the dblclick event) and emit new ROI if ≥ 3 pts.
  Shows rubber-band line to cursor and vertex dots while drawing.
- **Rectangle mode**: mousedown → start corner; mousemove → live preview;
  mouseup → emit 4-vertex ROI if drag > 1 % canvas.
- Click on existing ROI (when not mid-draw) → select it (thicker white border).
- Colors cycle: `["#2ecc71","#e74c3c","#3498db","#f39c12","#9b59b6"]`.
- Auto-label: `"Slot N"` where N = `rois.length + 1`.
- All coordinates normalized 0–1 relative to canvas display size.

### NEW: `frontend/src/components/RoiManager.jsx`
Admin panel rendered in the side column.

- **Reference Image** section: file input (image/*) → POST to
  `/api/roi/default/snapshot`; displays returned image as `RoiEditor` background
  via `FileReader.readAsDataURL`.
- On mount: fetches GET `/api/roi/default` to pre-populate existing ROIs.
- **Save ROIs** button → POST `/api/roi/default`; inline success/error for 3 s.
- ROI table: id (last 8 chars), label, vertex count, per-row Delete button.
- **Clear All** → sequential DELETE for each ROI, then clears state.

### MODIFIED: `frontend/src/components/HeatmapView.jsx`
- On mount: fetches GET `/api/roi/default`.
- **ROIs present**: renders a `<canvas>` minimap (full width, 200 px tall).
  - Dark background rect.
  - Each ROI polygon filled with `hsla(hue, 80%, 50%, 0.7)` where
    `hue = (1 − rate/100) × 120` (green → red).
  - Occupancy matched by `String(roi.id) === String(slot.slot_id)`.
  - Slot label centered inside each polygon.
- **No ROIs**: existing 6-column grid rendering unchanged.

### MODIFIED: `frontend/src/App.jsx`
- Imported `RoiManager`.
- Rendered `<RoiManager />` inside the side-column `div`, below `<ControlPanel />`.

---

## Data Flow (ROI mode)

```
Admin uploads reference image
  → POST /api/roi/default/snapshot
  → RoiStore saves backend/roi_configs/default_snapshot.jpg

Admin draws ROIs in RoiEditor
  → POST /api/roi/default {"rois": [...]}
  → RoiStore saves backend/roi_configs/default.json

VideoProcessor._loop()
  → SlotDetector.detect(frame, camera_id="default")
  → RoiStore.get_rois("default")  [reads JSON each frame]
  → for each ROI: bbox from polygon → crop → classify
  → emit slot results with ROI string IDs

WebSocket → frontend metrics (slot ids are ROI strings)
HeatmapView canvas minimap: matches roi.id to heatmap slot_id
```

---

## Fallback Guarantee
If no ROIs are saved for a camera, `RoiStore.get_rois()` returns `[]` and
`SlotDetector.detect()` falls back to `spots_config.json` exactly as before.
The demo processor and all existing tests are unaffected.
