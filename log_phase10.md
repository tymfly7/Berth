# Phase 10 — Log

## Model Button Names + YOLO26 Pretrained Weight Guard

---

### 1. ControlPanel — Model Button Names Updated

**File changed:** `frontend/src/components/ControlPanel.jsx`

**What changed:** Replaced the flat `['cnn_scratch', 'resnet18', 'mobilenetv2']` array with a structured list of `{ id, label }` objects reflecting the actual models defined in `backend/src/models/`:

| Button Label | API ID       | Model Class           |
|-------------|-------------|----------------------|
| CNN Scratch  | `cnn_scratch` | `ParkingCNN`         |
| ResNet-50    | `resnet50`    | `ParkingResNet`      |
| MobileNetV2  | `mobilenetv2` | `ParkingMobileNet`   |
| MobileNetV4  | `mobilenetv4` | `ParkingMobileNetV4` |
| YOLO26       | `yolo26`      | `ParkingYOLO26`      |

**Why:** The old buttons used `resnet18` (deprecated alias) and omitted `mobilenetv4` and `yolo26` entirely. Labels now match class names in `cnn_transfer.py` and `cnn_scratch.py`.

---

### 2. ParkingYOLO26 — Removed Auto-Download of Pretrained Weights

**File changed:** `backend/src/models/cnn_transfer.py`

**What changed:**
- `__init__` parameter `model_path` no longer defaults to `"yolo26n.pt"` (which caused Ultralytics to silently download pretrained weights on first use).
- Now requires an explicit path to be passed.
- Raises `FileNotFoundError` with a clear message (`"Train it first via the Training panel."`) if the path does not exist on disk.

**Why:** YOLO26 weights should come from user-initiated training, not an automatic internet download. The pretrained `yolo26n.pt` is a general object detector — not a parking-specific model.

---

### 3. Backend — `yolo26` Added to Valid Model List

**File changed:** `backend/main.py`

**What changed:** Added `"yolo26"` to the `valid` list in the `POST /api/use-model/{model_name}` route so the new YOLO26 button does not immediately return a 400 error.

**Note:** Full YOLO26 inference integration into the `_get_processor` pipeline is pending — YOLO26 uses a detection interface (`predict_frame`) rather than the binary classifier interface shared by the other four models.

---

### 4. TrainingPanel — Training Button Names Updated

**File changed:** `frontend/src/components/TrainingPanel.jsx`

**What changed:** Training buttons updated to match the model name changes applied to ControlPanel:

| Old Label      | New Label          | API ID       |
|---------------|--------------------|-------------|
| Train CNN      | Train CNN Scratch   | `cnn_scratch` |
| Train ResNet   | Train ResNet-50     | `resnet50`    |
| Train MobileNet| Train MobileNetV2   | `mobilenetv2` |
| _(missing)_    | Train MobileNetV4   | `mobilenetv4` |

**Why:** Labels were vague (`Train ResNet` didn't distinguish ResNet-18 vs ResNet-50) and `mobilenetv4` was absent. `resnet18` endpoint call replaced with `resnet50` to match the current model registry.

**Follow-up:** Added **Train YOLO26** button (was mistakenly omitted). Calls `startTraining('yolo26')` → `POST /api/train/start?model_name=yolo26`.

---

### 5. API Endpoint Alignment

Audited all frontend API calls against backend routes and fixed four mismatches:

#### 5a. `/api/test-model/{model_name}` — Created (was missing)

**File changed:** `backend/main.py`

The ControlPanel "Test" buttons called `/api/test-model/{model_name}` but no such route existed (all Test clicks returned 404). Added a `POST /api/test-model/{model_name}` endpoint that:
- Loads the trained model from disk via `load_model()`
- Prepares a test DataLoader via `prepare_dataset()`
- Runs `evaluate_model()` and returns accuracy, precision, recall, F1
- Returns 404 with a clear message if the model hasn't been trained yet
- Returns 400 for YOLO26 (detection interface — not compatible with per-patch accuracy testing)

#### 5b. `YOLO26_PATH` — Added to config and model factory

**Files changed:** `backend/config.py`, `backend/src/models/model_factory.py`

Added `YOLO26_PATH = MODEL_DIR / "best_yolo26.pt"` to config so the YOLO26 model has a consistent save location. Registered it in `model_factory.get_model_path()` so load/save paths resolve correctly.

#### 5c. `yolo26` — Added to `/api/model/info` available_models

**File changed:** `backend/main.py`

The model info endpoint now reports whether a trained YOLO26 weight file exists alongside the other four models, so the frontend can reflect trained/untrained state correctly.

---

### 6. ModelStatus — Model List Updated

**Files changed:** `frontend/src/components/ModelStatus.jsx`, `backend/main.py`

`ModelStatus.jsx` hardcoded `resnet18` and omitted `mobilenetv4` and `yolo26`. Updated the `models` array to all five current models:

| Name key      | Display label |
|--------------|--------------|
| `cnn_scratch` | CNN Scratch   |
| `resnet50`    | ResNet-50     |
| `mobilenetv2` | MobileNetV2   |
| `mobilenetv4` | MobileNetV4   |
| `yolo26`      | YOLO26        |

Removed the deprecated `resnet18` key from the `available_models` dict in `/api/model/info` — it is kept in the backend valid-model list for backwards compatibility with old `.pth` files but no longer surfaced in the UI.

---

### 7. YOLO26 Training Guard

**File changed:** `backend/main.py`

**Bug:** Clicking "Train YOLO26" crashed with `Unknown model 'yolo26'` because `TrainManager` calls `create_model()`, which only knows the four PyTorch classifiers.

**Fix:** Added an early-exit check at the top of `POST /api/train/start` — if `model_name == "yolo26"`, return HTTP 400 with a message explaining that YOLO26 requires the Ultralytics CLI pipeline, before `TrainManager` is ever invoked.

---

### 9. MobileNetV4 — Feature Dimension Mismatch Fixed

**File changed:** `backend/src/models/cnn_transfer.py`

**Bug:** Training failed with `mat1 and mat2 shapes cannot be multiplied (32x1280 and 960x256)`. `timm`'s `mobilenetv4_conv_small` reports `num_features = 960` (pre-pool layer count) but its actual pooled output is 1280, so the classifier `Linear(960 → 256)` received a 1280-wide tensor.

**Fix:** Replaced `self.backbone.num_features` with a one-shot dummy forward pass (`torch.zeros(1, 3, 224, 224)`) under `torch.no_grad()` to read the real output dimension at init time. The classifier is then built with the correct size regardless of timm version.

---

### 8. TrainingPanel — Active Model Highlight

**File changed:** `frontend/src/components/TrainingPanel.jsx`

**Bug:** The "Train CNN Scratch" button was permanently styled `btn-primary` (blue), regardless of which model was actually active.

**Fix:** Refactored the five training buttons into a mapped list. Each button's class is now `btn-primary` when its ID matches `modelInfo.active_model`, and `btn-ghost` otherwise — so the highlight follows the active model dynamically.

**Follow-up:** When training is in progress, the highlight switches to `training.model_name` (the model currently being trained) instead of `modelInfo.active_model`. Reverts to the loaded model highlight once training finishes.

**Follow-up 2:** Eliminated highlight delay — `setTraining({ status: 'training', model_name: modelName })` is called immediately on click, before the API request completes, so the button turns blue instantly rather than waiting for the first poll response.
