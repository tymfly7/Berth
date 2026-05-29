# Phase 3 — Dataset Image Upload

## Summary
Added browser-based labeled image upload to the training panel, allowing the admin to populate the training dataset without shell access.

---

## Backend — `backend/main.py`

### New endpoint: `POST /api/dataset/upload`
- Accepts multipart form: `files` (list of UploadFile) + `label` (str)
- Guards: `verify_api_key` dependency + existing `UPLOAD_RATE_LIMIT` limiter
- Validation:
  - `label` must be `"occupied"` or `"vacant"` → 400 otherwise
  - More than 50 files in one request → 400
  - Each file's extension checked against `{.jpg, .jpeg, .png, .bmp}`; invalid extensions are skipped (counted)
- Save logic:
  - Destination: `config.DATA_DIR / label / file.filename`
  - If destination already exists, a 6-char hex UUID suffix is inserted before the extension to avoid collisions
  - Destination directory is created with `mkdir(parents=True, exist_ok=True)` on first use
- Returns: `{"saved": int, "skipped": int, "label": str}`
- New imports added: `uuid`, `List` (typing), `Form` (fastapi)

### Updated endpoint: `GET /api/model/info`
- Replaced the `dataset_ready`-gated glob with unconditional per-class counts using `glob("*.*")`
- Added two new response fields:
  - `"occupied_count"`: number of files in `data/occupied/`
  - `"vacant_count"`: number of files in `data/vacant/`
- `dataset_count` is now derived from `occupied_count + vacant_count` (consistent with the new fields)

---

## Frontend — `frontend/src/components/TrainingPanel.jsx`

### New "Training Dataset" section (inserted above existing controls)

**`DropZone` sub-component** (local, not exported):
- Accepts: `label`, `files`, `onFiles` (state setter), `onClear`
- Drag-and-drop via `onDragOver` / `onDrop`; filters dropped items to `image/*` MIME type
- Hidden `<input type="file" accept="image/*" multiple>` opened on card click
- Border switches from `2px dashed` → `2px solid` on drag-over
- Displays icon (🚗 / 🟢), label, file count ("N files ready"), and a "Clear" link when files are staged

**Upload flow in `TrainingPanel`**:
- State: `occupiedFiles`, `vacantFiles`, `uploading`, `uploadMsg`, `uploadError`
- Upload button disabled until at least one zone has files or while uploading
- `handleUpload`: calls `uploadZone()` for each label in `Promise.all`; on success clears staged files, sets a 4-second success message, calls `fetchModelInfo()` to refresh counts; on error shows error text
- `uploadZone()`: builds `FormData`, appends all files under the `"files"` key, POSTs to `/api/dataset/upload`
- Dataset size line below the button reads `modelInfo.occupied_count` / `modelInfo.vacant_count` (shows `—` while loading)

### Props added
- `modelInfo` — used for the dataset count display
- `fetchModelInfo` — called after a successful upload to refresh counts

---

## `frontend/src/App.jsx`

- `<TrainingPanel>` now receives `modelInfo={modelInfo}` and `fetchModelInfo={fetchModelInfo}` (both were already available in `App` state/scope)

---

## Files changed
| File | Change |
|------|--------|
| `backend/main.py` | Added `POST /api/dataset/upload`; updated `GET /api/model/info` |
| `frontend/src/components/TrainingPanel.jsx` | Added drop-zone UI, upload logic, dataset count display |
| `frontend/src/App.jsx` | Passed `modelInfo` + `fetchModelInfo` props to `TrainingPanel` |
