# Phase 2 — Model Architecture Upgrades

**Date:** 2026-05-29

## Summary

Upgraded all three model architecture files, the factory, config, API endpoints,
and requirements. No changes to `trainer.py` or `train_manager.py`.

---

## Files Changed

### `backend/src/models/cnn_scratch.py` — full rewrite

- Added nested `ParkingCNN.SEBlock` (Squeeze-and-Excitation, ratio=16):
  - `gap → fc1 → ReLU → fc2 → Sigmoid → channel-wise scale`
- Expanded feature extractor from 4 blocks to 6 (`ConvBlock` already had the
  double-conv pattern; no change needed to `ConvBlock` itself):
  - Blocks 1–4: same channel progression as before (3→32→64→128→256)
  - Block 5: 256→512, followed by `SEBlock(512)` in the `nn.Sequential`
  - Block 6: 512→512
- New classifier head: `Linear(512→256) → BN1d → ReLU → Dropout(0.4)`
  `→ Linear(256→64) → ReLU → Dropout(0.2) → Linear(64→1) → Sigmoid`
- External interface (`__init__(num_classes)`, `forward(x)`, `count_parameters()`)
  unchanged.

### `backend/src/models/cnn_transfer.py` — full rewrite

**`ParkingResNet`** (backbone swapped resnet18 → resnet50):
- `ResNet50_Weights.DEFAULT`, `fc.in_features = 2048`
- New head: `Linear(2048→512) → ReLU → Dropout(0.3) → Linear(512→1) → Sigmoid`
- Docstring notes old ResNet18 `.pth` weights are incompatible
- `unfreeze_layers()` preserved unchanged

**`ParkingMobileNet`** — unchanged (kept as-is)

**`ParkingMobileNetV4`** (new):
- `timm` imported inside `__init__` with `ImportError → RuntimeError("pip install timm>=1.0.0")`
- `timm.create_model('mobilenetv4_conv_small', pretrained, num_classes=0, global_pool='avg')`
- Feature dim read from `backbone.num_features`
- Backbone frozen by default; `unfreeze_layers(num_layers=3)` on last N children
- Head: `Linear(num_features→256) → ReLU → Dropout(0.3) → Linear(256→1) → Sigmoid`
- `count_parameters()` identical to other classes

**`ParkingYOLO26`** (new, plain class — not `nn.Module`):
- `ultralytics` imported inside `__init__` with `ImportError → RuntimeError("pip install ultralytics")`
- Wraps `YOLO("yolo26n.pt")`
- `predict_frame(frame_bgr: np.ndarray) -> list[dict]` returns `{bbox, confidence, class_id}`
- Docstring clearly states this is a **detector**, not a sigmoid classifier
- TODO comment noting training uses Ultralytics CLI, not `trainer.py`

### `backend/src/models/model_factory.py`

- Added `import warnings`
- Added `ParkingMobileNetV4` to imports from `cnn_transfer`
- `MODEL_REGISTRY`: added `'resnet50': ParkingResNet`, `'mobilenetv4': ParkingMobileNetV4`
- `'resnet18'` kept as alias; `create_model()` emits `DeprecationWarning` when used:
  `"resnet18 key is deprecated, use resnet50"`
- `get_model_path()`: added `resnet50 → config.RESNET50_PATH`,
  `mobilenetv4 → config.MOBILENETV4_PATH`

### `backend/config.py`

- Added `RESNET50_PATH = MODEL_DIR / "best_resnet50.pth"`
- Added `MOBILENETV4_PATH = MODEL_DIR / "best_mobilenetv4.pth"`
- `RESNET18_PATH` kept for backward compatibility

### `backend/main.py`

- `use_model()` valid list: added `'resnet50'`, `'mobilenetv4'`
- `model_info()` `available_models` dict: added `resnet50` and `mobilenetv4`
  with `.exists()` checks on their config paths

### `backend/requirements.txt`

- Added `timm>=1.0.0`
- Added `ultralytics>=8.3.0`

---

## Architecture Decisions

| Decision | Rationale |
|---|---|
| `SEBlock` nested inside `ParkingCNN` | Spec said "inner class"; keeps it scoped to the one model that uses it |
| `SEBlock` placed in `nn.Sequential` after block 5 | Avoids modifying `ConvBlock`; SE attention sits after pooling as per spec |
| `ParkingYOLO26` as plain class (not `nn.Module`) | YOLO is an Ultralytics wrapper, not a PyTorch module; wrapping it in `nn.Module` would cause parameter-tracking issues |
| `timm`/`ultralytics` imports guarded inside `__init__` | Optional heavy deps — the rest of the app stays importable without them |
| `resnet18` kept in registry with `DeprecationWarning` | Zero breakage for existing callers; warning surfaces at call site via `stacklevel=2` |
