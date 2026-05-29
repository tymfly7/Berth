# Phase 9 — Log

## Fix — RoiEditor Polygon Escape Key + Auto-Close

**File changed:** `frontend/src/components/RoiEditor.jsx`

### Issue 1: Escape key had no effect
Added a `keydown` listener on `window` (mounted/unmounted via `useEffect`). Pressing Escape now clears `inProgress` and `livePoint`, discarding any polygon in progress.

### Issue 2: Trailing cursor line after polygon closes
Added auto-close logic in `handleClick`: when ≥3 points are already placed and the new click lands within 15px (pixel space) of the first point, `makeRoi` is called with the current points and `inProgress`/`livePoint` are reset — so no trailing dashed line remains on the canvas.

### Bonus: Snap indicator
The first polygon point now grows to a green circle (radius 8) when the cursor hovers within the 15px snap threshold, giving the user visual feedback that the next click will close the polygon.

---

## Feature — RoiEditor Undo / Redo (Ctrl+Z / Ctrl+Y)

**File changed:** `frontend/src/components/RoiEditor.jsx`

### State added
- `past` — array of `rois` snapshots before each change (undo stack)
- `future` — array of `rois` snapshots after the current position (redo stack)

### Helpers added
- `commitChange(newRois)` — saves current `rois` to `past`, clears `future`, calls `onRoisChange`. All mutating actions (draw polygon, draw rect, delete, clear all) now route through this instead of calling `onRoisChange` directly.
- `undo()` — pops `past`, pushes current `rois` to `future`, restores previous state.
- `redo()` — pops `future`, pushes current `rois` to `past`, advances to next state.

### Keyboard shortcuts
Extended the existing `keydown` handler:
- `Ctrl+Z` (or `Cmd+Z`) — undo
- `Ctrl+Y` or `Ctrl+Shift+Z` (or `Cmd` variants) — redo
- Both call `e.preventDefault()` to suppress browser undo.

### Scope of undo/redo
All four ROI mutations are undoable: polygon draw, rectangle draw, Delete Selected, Clear All. In-progress polygon drawing (before finalisation) is not tracked — only completed shapes enter the history.

---

## Fix — RoiEditor TDZ crash on load

**File changed:** `frontend/src/components/RoiEditor.jsx`

**Bug:** `Uncaught ReferenceError: can't access lexical declaration 'undo' before initialization` — the keydown `useEffect` listed `undo` and `redo` in its dependency array, but those `useCallback` declarations appeared later in the function body. `const` is not hoisted, so React evaluated the dep array before the bindings existed (temporal dead zone).

**Fix:** Moved `commitChange`, `undo`, and `redo` useCallbacks above the keydown `useEffect` so all three are initialized before the effect references them.

---

## Fix — CNN Classifier Head (`cnn_scratch.py`)

**Files changed:** `backend/src/models/cnn_scratch.py`, `backend/src/train/trainer.py`, `backend/src/inference/classifier.py`

### 1. Missing `BatchNorm1d` on second FC layer (`cnn_scratch.py`)
The first FC layer had `Linear → BN → ReLU` but the second only had `Linear → ReLU`. Added `nn.BatchNorm1d(64)` after `nn.Linear(256, 64)` for consistency and training stability.

### 2. Removed `nn.Sigmoid()` from classifier head (`cnn_scratch.py`)
Switched to raw logit output. Sigmoid inside `nn.Sequential` forces `BCELoss`, which is less numerically stable than `BCEWithLogitsLoss` (no log-sum-exp trick, gradient vanishes near 0/1).

### 3. Updated loss function (`trainer.py`)
`nn.BCELoss()` → `nn.BCEWithLogitsLoss()`. Also added explicit `.float()` cast on labels in `_train_epoch` and `_validate` — `BCEWithLogitsLoss` requires float targets and this was previously implicit.

### 4. Apply sigmoid at inference (`classifier.py`)
Since the model now outputs logits, `torch.sigmoid()` is applied in both `predict()` and `predict_batch()` before interpreting the probability.


