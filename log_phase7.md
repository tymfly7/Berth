# Phase 7 — Automated Tests + CI Pipeline

## Summary

Added pytest-based backend tests, Vitest-based frontend tests, and a GitHub Actions CI
pipeline. All tests are designed to run with no GPU and no pre-trained model weights.

---

## Backend tests (`backend/tests/`)

### `backend/tests/__init__.py`
Empty marker file.

### `backend/tests/conftest.py`
Three fixtures (two `autouse`):

- **`test_client`** — `TestClient(main.app)` via FastAPI test client.
- **`tmp_data_dir`** — Creates `tmp_path/occupied/` and `tmp_path/vacant/`, populates each
  with 10 synthetic 32×32 RGB JPEGs using PIL, monkeypatches `config.DATA_DIR` to `tmp_path`.
- **`mock_processor`** — `MagicMock` with all VideoProcessor methods stubbed; `get_metrics()`
  returns a fixed payload (`total=10, available=4, occupied=6`, etc.).
- **`patch_get_processor` (autouse)** — patches `main._get_processor` to return
  `mock_processor` for every test, so no real camera/model is needed.
- **`patch_roi_dir` (autouse)** — monkeypatches `src.roi.roi_store._ROI_DIR` to a fresh
  `tmp_path/roi_configs/` directory, giving each test isolated ROI storage.

### `backend/tests/test_api.py`
One test per endpoint:

| Test | Method | Path | Expected |
|------|--------|------|----------|
| `test_root` | GET | `/` | 200, `status == "running"` |
| `test_health` | GET | `/api/health` | 200, has `"processor"` |
| `test_metrics` | GET | `/api/metrics` | 200, has `total`, `available` |
| `test_history` | GET | `/api/history` | 200, list |
| `test_heatmap` | GET | `/api/heatmap` | 200, list |
| `test_status` | GET | `/api/status` | 200, `busy` bool + `operations` list |
| `test_model_info` | GET | `/api/model/info` | 200, has `active_model` |
| `test_public_metrics` | GET | `/api/public/metrics` | 200, no auth needed |
| `test_predict_no_model` | POST | `/api/predict` | 400 — no trained weights in CI |
| `test_analyze_lot` | POST | `/api/analyze-lot?rows=2&cols=2` | 200, `total == 4`; patches `_resolve_model_name` and `ParkingClassifier` |
| `test_roi_crud` | POST/GET/DELETE | `/api/roi/test_cam` | Full CRUD cycle |
| `test_upload_dataset` | POST | `/api/dataset/upload` | 200, `saved == 3` (uses `tmp_data_dir`) |
| `test_train_start_no_dataset` | POST | `/api/train/start` | 400 — no dataset dirs in fresh env |
| `test_camera_crud` | POST/GET/DELETE | `/api/cameras` | 201 → list contains ID → 200 delete |

`test_analyze_lot` patches both `main._resolve_model_name` (returns `"cnn_scratch"`) and
`src.inference.classifier.ParkingClassifier` (returns a MagicMock with `predict_batch`
returning 4 `{"status":"vacant","confidence":0.9}` entries).

### `backend/tests/test_roi_store.py`
Direct unit tests for `RoiStore` (uses the autouse `patch_roi_dir` for isolation):

- `test_save_and_get` — saves 3 ROIs, retrieves, asserts equal.
- `test_delete` — saves 2, deletes one by id, confirms 1 remains.
- `test_invalid_coords` — polygon coord > 1.0 raises `ValueError`.
- `test_camera_isolation` — separate camera IDs produce separate files.

### `backend/tests/test_models.py`
Forward-pass and parameter count tests for all three CNN architectures:

| Test | Model | Notes |
|------|-------|-------|
| `test_parkingcnn_forward` | `ParkingCNN` | `randn(1,3,224,224)` → shape `(1,1)` |
| `test_parkingcnn_params` | `ParkingCNN` | `trainable > 0` |
| `test_parkingresnet_forward` | `ParkingResNet(pretrained=False)` | No weight download |
| `test_parkingresnet_params` | `ParkingResNet(pretrained=False)` | classifier head is trainable |
| `test_parkingmobilenetv4_forward` | `ParkingMobileNetV4(pretrained=False)` | `@skipif timm` |
| `test_parkingmobilenetv4_params` | `ParkingMobileNetV4(pretrained=False)` | `@skipif timm` |

All model tests use `pretrained=False` so no network access is required.

---

## Frontend tests (`frontend/src/tests/`)

### `setup.ts`
Imports `@testing-library/jest-dom` to extend vitest matchers with DOM assertions.

### `PinGate.test.jsx`
Tests the username/password auth gate (PinGate was updated to username+password in Phase 6):

- **Login form shown** — renders "Admin Access" heading; children not visible when
  `localStorage` is empty.
- **Correct credentials** — types `admin` / `password`, clicks Sign in, asserts children
  appear.
- **Incorrect credentials** — types wrong values, clicks Sign in, asserts "Incorrect username
  or password" is visible and children remain hidden.

### `PublicView.test.jsx`
- Mocks `global.fetch` to return the fixed metrics payload.
- Wraps component in `MemoryRouter` (needed for `<Link to="/admin">`).
- Asserts "Parking Availability" heading is present.
- Waits for async `fetch` state update; asserts available count `"4"` is visible.

### `RoiEditor.test.jsx`
- Uses a 1×1 PNG data URL as `backgroundImage` (the component returns `null` when the prop
  is falsy, so a truthy value is required to render the canvas and toolbar).
- Asserts `<canvas>` element is in the DOM.
- Asserts "Polygon" and "Rectangle" toolbar buttons are present.

---

## Frontend config changes

### `frontend/vite.config.js` (recreated)
Recreated after the file was deleted in a prior phase. Includes `@vitejs/plugin-react` plugin
and a `test` block:

```js
test: {
  environment: 'jsdom',
  setupFiles: ['./src/tests/setup.ts'],
  globals: true,
}
```

`globals: true` exposes `describe`, `it`, `expect`, etc. without explicit imports in test files
(though tests import them explicitly for IDE type awareness).

### `frontend/package.json`
- Removed `"build": "tsc && vite build"` TypeScript compile step (tsconfig.json was deleted in
  a prior phase) → `"build": "vite build"`.
- Added test devDependencies: `vitest ^3`, `@testing-library/react ^16`,
  `@testing-library/jest-dom ^6`, `@testing-library/user-event ^14`, `jsdom ^26`.
- Added scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

---

## CI — `.github/workflows/ci.yml`

Three parallel jobs:

| Job | Runner | Steps |
|-----|--------|-------|
| **backend** | ubuntu-latest | checkout → python 3.11 → `pip install -r backend/requirements.txt` + `pytest pytest-asyncio httpx` → `cd backend && pytest tests/ -v --tb=short` |
| **frontend** | ubuntu-latest | checkout → node 20 → `npm ci` → `npm test` |
| **lint** | ubuntu-latest | checkout → python 3.11 → `pip install ruff` → `ruff check backend/` → node 20 → `npm ci && npx eslint src/` |

Triggers: push to `main` and all pull requests.

---

## Design decisions

**No GPU dependency** — backend model tests use `pretrained=False` (random init, no download)
and `torch.no_grad()`. The API tests mock `_get_processor` entirely via `autouse` fixture.

**ROI isolation** — `patch_roi_dir` autouse fixture redirects `_ROI_DIR` to a per-test
`tmp_path/roi_configs/` directory, preventing any test from touching the real `roi_configs/`
on disk.

**RoiEditor backgroundImage** — the component returns `null` when `backgroundImage` is falsy,
so tests pass a 1×1 PNG data URL to exercise the canvas and toolbar rendering path.

**PinGate credentials** — PinGate was updated in Phase 6 to use username+password instead of
a PIN. Tests use the default fallback credentials (`admin` / `password`) which need no `.env`
file.
