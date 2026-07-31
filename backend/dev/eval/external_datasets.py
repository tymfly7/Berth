"""
External Datasets — Benchmark Set Discovery
===========================================
Lets operators evaluate the trained models against a hand-supplied dataset
instead of the internal 70/15/15 split. An "external" dataset is any directory
dropped under backend/data/ that follows the T12Lot benchmark layout:

    <dataset>/
        crops_classifier/           # per-space crops for the classify models
            occupied/  *.jpg
            vacant/    *.jpg
        crop_yolo_detect/           # full-lot frames for the detector (optional)
            data.yaml
            images/  labels/

Only directory existence is probed here — never file contents — so discovery
stays cheap even for large image folders.
"""

import re
from pathlib import Path

import config

# Internal working directories the training pipeline owns — never offered as an
# external benchmark choice even though they share the crops layout.
_INTERNAL_DIRS = {
    config.CLASSIFY_SPLIT_DIR.name,
    config.CLASSIFY_SUBSET_DIR.name,
    config.YOLO_DATASET_DIR.name,
}

# Sentinel id for the default internal split (kept in sync with the frontend).
STANDARD_ID = "standard"


def _label(name: str) -> str:
    """Turn a directory name into a friendly display label (t12lot → T12Lot)."""
    m = re.fullmatch(r"t(\d+)lot", name, re.IGNORECASE)
    if m:
        return f"T{m.group(1)}Lot"
    return name.replace("_", " ").replace("-", " ").title()


def _classifier_dir(root: Path) -> Path | None:
    d = root / "crops_classifier"
    if (d / "occupied").is_dir() or (d / "vacant").is_dir():
        return d
    return None


def _detector_yaml(root: Path) -> Path | None:
    """The detector data yaml, in either layout.

    The older benchmark bundles keep it at crop_yolo_detect/data.yaml.
    build_vehicle_dataset.py writes dataset.yaml at the dataset root instead, so
    a held-out lot built by that script is invisible unless both are accepted.
    """
    for y in (root / "crop_yolo_detect" / "data.yaml", root / "dataset.yaml"):
        if y.is_file():
            return y
    return None


def list_external_datasets() -> list[dict]:
    """Scan DATA_DIR for directories matching the benchmark layout.

    Returns a list of {id, label, has_classifier, has_detector}, sorted by id.
    """
    out = []
    if not config.DATA_DIR.is_dir():
        return out
    for root in sorted(config.DATA_DIR.iterdir()):
        if not root.is_dir() or root.name in _INTERNAL_DIRS:
            continue
        clf = _classifier_dir(root)
        det = _detector_yaml(root)
        if clf is None and det is None:
            continue
        out.append({
            "id":             root.name,
            "label":          _label(root.name),
            "has_classifier": clf is not None,
            "has_detector":   det is not None,
        })
    return out


def resolve(dataset_id: str) -> dict | None:
    """Resolve a dataset id to concrete paths, or None if it isn't a valid one."""
    if not dataset_id or dataset_id == STANDARD_ID:
        return None
    root = config.DATA_DIR / dataset_id
    if not root.is_dir() or root.name in _INTERNAL_DIRS:
        return None
    clf = _classifier_dir(root)
    det = _detector_yaml(root)
    if clf is None and det is None:
        return None
    return {
        "id":             dataset_id,
        "label":          _label(dataset_id),
        "classifier_dir": clf,
        "detector_yaml":  det,
        "has_classifier": clf is not None,
        "has_detector":   det is not None,
    }


def build_external_test_loader(classifier_dir: Path, image_size=None, batch_size=None):
    """Build a no-shuffle test DataLoader over an external crops_classifier dir.

    Mirrors the test_loader that prepare_dataset() produces (same transforms via
    split="test"), so evaluate_model() consumes it unchanged.
    """
    import os
    import torch
    from torch.utils.data import DataLoader
    from dev.data_prep.dataset import ParkingDataset

    image_size  = image_size or config.CNN_INPUT_SIZE
    batch_size  = batch_size or config.BATCH_SIZE
    num_workers = 0 if os.name == "nt" else config.NUM_WORKERS

    dataset = ParkingDataset(
        data_root=str(classifier_dir), split="test", image_size=image_size
    )
    return DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=num_workers,
        pin_memory=torch.cuda.is_available(),
    )


def evaluate_yolo_classify_external(weights_path, classifier_dir, imgsz=None) -> dict | None:
    """Score a YOLO26 classify model over an external crops_classifier dir.

    The Ultralytics `.val()` path needs an ImageFolder train/val/test layout,
    which flat external crops don't have — so we run per-crop `.predict()` and
    compute metrics with sklearn (occupied = positive), returning the same field
    shape the comparison table reads.
    """
    from ultralytics import YOLO
    from sklearn.metrics import (
        accuracy_score, precision_score, recall_score, f1_score,
    )

    imgsz = imgsz or config.YOLO_CLASSIFY_IMG_SIZE
    exts  = (".jpg", ".jpeg", ".png", ".bmp")
    classifier_dir = Path(classifier_dir)

    samples = []  # (path, true_label) — occupied=1, vacant=0
    for cls_name, label in (("occupied", 1), ("vacant", 0)):
        d = classifier_dir / cls_name
        if d.is_dir():
            samples += [(str(p), label) for p in sorted(d.iterdir())
                        if p.suffix.lower() in exts]
    if not samples:
        return None

    model = YOLO(str(weights_path))
    y_true, y_pred = [], []
    for path, label in samples:
        r = model.predict(path, imgsz=imgsz, verbose=False)[0]
        pred_name = str(r.names[int(r.probs.top1)]).lower()
        y_true.append(label)
        y_pred.append(1 if pred_name == "occupied" else 0)

    return {
        "accuracy":      round(accuracy_score(y_true, y_pred) * 100, 2),
        "precision":     round(precision_score(y_true, y_pred, zero_division=0) * 100, 2),
        "recall":        round(recall_score(y_true, y_pred, zero_division=0) * 100, 2),
        "f1_score":      round(f1_score(y_true, y_pred, zero_division=0) * 100, 2),
        "total_samples": len(samples),
    }
