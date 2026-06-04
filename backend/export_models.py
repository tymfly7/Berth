"""
Run this script once from the backend/ directory to export all trained models
for Raspberry Pi 5 deployment.

  CNN models  → NCNN  (edge_*_ncnn_model/)    via torch.jit.trace + pnnx
  YOLO models → NCNN  (*_ncnn_model/)         via Ultralytics export

Usage:
    cd backend
    python export_models.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import config
from src.export.model_exporter import export_pytorch_model, export_yolo_model

MODELS = [
    ("cnn_scratch",     config.CNN_SCRATCH_PATH,      export_pytorch_model),
    ("resnet50",        config.RESNET50_PATH,          export_pytorch_model),
    ("mobilenetv4s",    config.MOBILENETV4_PATH,       export_pytorch_model),
    ("yolo26_classify", config.YOLO26_CLASSIFY_PATH,   export_yolo_model),
    ("yolo26_detect",   config.YOLO26_DETECT_PATH,     export_yolo_model),
]

print("Exporting models for edge deployment...\n")
ok, skip, fail = [], [], []

for name, weights_path, fn in MODELS:
    if not Path(weights_path).exists():
        print(f"  SKIP  {name} — weights not found at {weights_path}")
        skip.append(name)
        continue
    print(f"  ...   {name}")
    result = fn(name, weights_path)
    if result:
        print(f"  OK    {name} → {result}")
        ok.append(name)
    else:
        print(f"  FAIL  {name}")
        fail.append(name)

print(f"\nDone. exported={len(ok)}  skipped={len(skip)}  failed={len(fail)}")
if ok:
    print("\nCopy these to backend/models/ on the Raspberry Pi 5:")
    for name in ok:
        if "yolo" in name:
            pt_stem = Path(config.YOLO26_CLASSIFY_PATH if "classify" in name else config.YOLO26_DETECT_PATH).stem
            print(f"  backend/models/{pt_stem}_ncnn_model/  (directory)")
        else:
            print(f"  backend/models/edge_{name}_ncnn_model/  (directory)")
