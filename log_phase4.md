# Phase 4 — Server Busy Indicator

## Goal
Show the admin when the server is busy (uploading, training, analyzing).

---

## Backend changes — `backend/main.py`

### New import
- Added `import time` (used by the training monitor thread).

### Operation-tracking globals (after processor globals)
```python
_active_operations: dict = {}
_ops_lock = threading.Lock()
```

### Helper functions
- `_register_op(op_type, label) -> str` — inserts a record into `_active_operations`, returns an 8-char hex op_id.
- `_update_op_progress(op_id, progress)` — thread-safe float update (0.0–1.0).
- `_finish_op(op_id)` — removes the record; called in `finally` blocks so it always runs.

### New endpoint: `GET /api/status`
No auth required (polled frequently by the frontend).
```json
{ "busy": true, "operations": [{ "id": "…", "type": "training", "label": "Training resnet18…", "progress": 0.35, "started_at": "…" }] }
```

### Wrapped endpoints

| Endpoint | op_type | label | Notes |
|---|---|---|---|
| `POST /api/upload-video` | `video_upload` | `"Uploading video…"` | `try/finally` |
| `POST /api/train/start` | `training` | `"Training {model_name}…"` | Register after `mgr.start_training()` succeeds; daemon thread polls `TrainManager().get_status()` every 2 s, updates progress as `epoch/total_epochs`, calls `_finish_op` when status is `done/error/idle` |
| `POST /api/analyze-lot` | `analysis` | `"Analyzing parking lot…"` | `try/finally` around entire body |
| `POST /api/dataset/upload` | `dataset_upload` | `"Saving training images…"` | `try/finally` around entire body |

---

## Frontend changes

### New component: `frontend/src/components/ServerStatus.jsx`
- Polls `GET /api/status` every **2 000 ms** via `setInterval`.
- State: `{ busy: false, operations: [] }`.
- Renders `<div className="server-status-bar">` (always present for CSS transition).
- **Idle** (`busy=false`): height 0, overflow hidden — invisible.
- **Busy** (`busy=true`): class `server-status-bar--active` animates height to 28 px.
  - 4 px progress strip at top:
    - If `maxProgress > 0`: filled to `maxProgress * 100 %` with gradient accent.
    - Otherwise: full-width strip with `server-status-pulse` keyframe (opacity oscillation).
  - Label line below strip: `firstOp.label [+ " (N%)"] [+ " +N more"]`.

### CSS added to `frontend/src/App.css`
Classes: `.server-status-bar`, `.server-status-bar--active`, `.server-status-progress`, `.server-status-fill`, `.server-status-fill--pulse`, `.server-status-label`, `@keyframes server-status-pulse`.

### `frontend/src/App.jsx`
- Imported `ServerStatus`.
- Rendered `<ServerStatus />` immediately after `<Header connected={connected} … />`.

---

## Files changed
- `backend/main.py`
- `frontend/src/components/ServerStatus.jsx` *(new)*
- `frontend/src/App.css`
- `frontend/src/App.jsx`
