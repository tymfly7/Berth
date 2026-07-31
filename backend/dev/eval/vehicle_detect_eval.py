"""Vehicle detector evaluation — baseline, confidence sweep, luminance bands.

The single-class ("vehicle") detector behind the misparked-vehicle pass is not
covered by the classifier evaluation path: that one scores per-crop accuracy,
this one scores mAP over boxes. Three sections are produced.

baseline    Ultralytics .val() on the given yaml and split. Raw model output.
sweep       Precision, recall and F1 at conf 0.10 to 0.60, plus the argmax-F1
            threshold. Validates config.VEHICLE_DETECT_CONF, whose comment says
            it was inherited from the COCO-detector era and never re-checked
            against the retrained model. Nothing here changes that value.
bands       Per-luminance-band mAP over the same bands build_vehicle_dataset.py
            uses, because pooled mAP hides the night case entirely.

THE BASELINE AND THE SWEEP ARE DELIBERATELY INCONSISTENT. The baseline is raw
model output. The sweep applies the same box filters the deployed path applies:
yolo_detector.detect() drops any box below _MIN_BOX_AREA or above
_MAX_ASPECT_RATIO, so the anomaly pass never sees a raw box. The gap between the
two is the phantom detections those checks remove off painted bay markings. It
is not a bug. The filter thresholds are absolute pixel values, applied here at
the dataset's native resolution.

Only single-class vehicle datasets may be evaluated. The crop_yolo_detect layout
is shared with the older BAY detector datasets, whose labels are vacant/occupied
bays; scoring the vehicle detector against those returns a low but plausible
number rather than an error, which reads as a real generalisation result.

Usage:
    python -m dev.eval.vehicle_detect_eval --data data/vehicle_dataset/dataset.yaml
"""

import argparse
import json
import logging
import tempfile
from datetime import datetime
from pathlib import Path

import cv2
import yaml as yaml_lib

import config
from dev.data_prep.build_vehicle_dataset import BANDS, band
from dev.eval.external_datasets import STANDARD_ID, list_external_datasets, resolve
from src.models.yolo_detector import _MAX_ASPECT_RATIO, _MIN_BOX_AREA

logger = logging.getLogger("berth.detector_eval")

# The one class map this evaluation accepts.
_VEHICLE_CLASSES = {0: "vehicle"}

_EXTS = (".jpg", ".jpeg", ".png", ".bmp")
_CONFS = [round(0.10 + 0.05 * i, 2) for i in range(11)]
_MATCH_IOU = 0.5   # a sweep detection counts as a hit at the mAP50 IoU


# ── dataset resolution and the class-map guard ───────────────────────────────
def _class_map(yaml_path: Path) -> dict:
    """Read a data.yaml's class map as {index: name}, list or dict form."""
    with open(yaml_path) as f:
        doc = yaml_lib.safe_load(f) or {}
    names = doc.get("names")
    if isinstance(names, dict):
        return {int(k): str(v).strip().lower() for k, v in names.items()}
    if isinstance(names, list):
        return {i: str(v).strip().lower() for i, v in enumerate(names)}
    return {}


def check_vehicle_classes(yaml_path: Path, label: str = "") -> None:
    """Raise unless the dataset is the single-class vehicle map."""
    classes = _class_map(Path(yaml_path))
    if classes != _VEHICLE_CLASSES:
        raise ValueError(
            f"'{label or Path(yaml_path).parent.name}' is not a vehicle detection "
            f"dataset. Its class map is {classes or 'missing'}, expected "
            f"{_VEHICLE_CLASSES}. Bay-detector datasets score against the wrong "
            "labels and return a plausible-looking number instead of an error."
        )


def is_vehicle_dataset(yaml_path) -> bool:
    """check_vehicle_classes as a predicate, for callers that skip rather than raise."""
    try:
        check_vehicle_classes(yaml_path)
        return True
    except (ValueError, OSError):
        return False


def _standard_yaml() -> Path:
    return config.YOLO_DATASET_DIR / "dataset.yaml"


def declared_split(yaml_path) -> str:
    """The split to score, taken from what the yaml actually declares.

    A held-out lot is built with one `test` split and no train/val. The internal
    dataset declares train and val only. Test wins where both exist, because a
    held-out split is the one worth reporting.
    """
    with open(yaml_path) as f:
        doc = yaml_lib.safe_load(f) or {}
    for split in ("test", "val"):
        if doc.get(split):
            return split
    raise ValueError(
        f"{Path(yaml_path).name} declares neither a test nor a val split, "
        "so there is nothing to evaluate against."
    )


def list_datasets() -> list[dict]:
    """Datasets whose class map passes the guard, as [{id, label}]."""
    out = []
    candidates = [(STANDARD_ID, "Standard split", _standard_yaml())]
    for d in list_external_datasets():
        if d["has_detector"]:
            candidates.append((d["id"], d["label"], resolve(d["id"])["detector_yaml"]))
    for ds_id, label, path in candidates:
        if not Path(path).is_file():
            continue
        try:
            check_vehicle_classes(path, label)
        except ValueError:
            continue
        out.append({"id": ds_id, "label": label})
    return out


def resolve_dataset(dataset_id: str) -> tuple[Path, str]:
    """Map a dataset id to (yaml_path, split), or raise if it isn't usable."""
    if dataset_id == STANDARD_ID:
        path, label = _standard_yaml(), "Standard split"
    else:
        info = resolve(dataset_id)
        if info is None or info["detector_yaml"] is None:
            raise ValueError(f"Unknown or invalid detector dataset '{dataset_id}'.")
        path, label = info["detector_yaml"], info["label"]
    if not Path(path).is_file():
        raise FileNotFoundError(f"No detector dataset yaml at {path}.")
    check_vehicle_classes(path, label)
    return Path(path), declared_split(path)


# ── image and label plumbing ─────────────────────────────────────────────────
def _split_images(yaml_path: Path, split: str) -> list[Path]:
    with open(yaml_path) as f:
        doc = yaml_lib.safe_load(f) or {}
    entry = doc.get(split)
    if not entry:
        raise ValueError(
            f"Split '{split}' not in {yaml_path.name}. "
            f"Available: {[k for k in ('train', 'val', 'test') if doc.get(k)]}"
        )
    root = Path(doc.get("path") or yaml_path.parent)
    if not root.is_absolute():
        root = (yaml_path.parent / root).resolve()
    img_dir = Path(entry) if Path(entry).is_absolute() else root / entry
    if not img_dir.is_dir():
        raise ValueError(f"Split '{split}' does not point at an image directory: {img_dir}")
    images = sorted(p for p in img_dir.iterdir() if p.suffix.lower() in _EXTS)
    if not images:
        raise ValueError(f"No images in {img_dir}")
    return images


def _label_path(img: Path) -> Path:
    """images/<split>/x.jpg → labels/<split>/x.txt, the Ultralytics convention."""
    parts = list(img.parts)
    if "images" not in parts:
        raise ValueError(f"Image path has no 'images' component, cannot find labels: {img}")
    parts[len(parts) - 1 - parts[::-1].index("images")] = "labels"
    return Path(*parts).with_suffix(".txt")


def _gt_boxes(img: Path, w: int, h: int) -> list:
    """Ground-truth boxes as pixel xyxy. Missing label file means no objects."""
    path = _label_path(img)
    if not path.is_file():
        return []
    boxes = []
    for line in path.read_text().splitlines():
        vals = line.split()
        if len(vals) < 5:
            continue
        cx, cy, bw, bh = (float(v) for v in vals[1:5])
        boxes.append([(cx - bw / 2) * w, (cy - bh / 2) * h,
                      (cx + bw / 2) * w, (cy + bh / 2) * h])
    return boxes


def _iou(a, b) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    union = ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)
    return inter / union if union > 0 else 0.0


# ── the three sections ───────────────────────────────────────────────────────
def _val(model, data, split, imgsz) -> dict:
    res = model.val(
        data=str(data), split=split, imgsz=imgsz, verbose=False, plots=False,
        project=str(config.OUTPUT_DIR / "vehicle_detect_eval"), name="val", exist_ok=True,
    )
    return {
        "map50":     round(float(res.box.map50) * 100, 2),
        "map50_95":  round(float(res.box.map) * 100, 2),
        "precision": round(float(res.box.mp) * 100, 2),
        "recall":    round(float(res.box.mr) * 100, 2),
    }


def _filtered_predictions(model, images, imgsz) -> list:
    """Per image, (kept detections as (conf, xyxy), ground-truth boxes).

    Detections pass through the deployed path's area and aspect-ratio filters, so
    the sweep scores what the anomaly pass would actually have seen.
    """
    pairs = []
    stream = model.predict([str(p) for p in images], imgsz=imgsz, conf=_CONFS[0],
                           verbose=False, stream=True)
    for img, r in zip(images, stream):
        h, w = r.orig_shape
        kept = []
        for box in r.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            bw, bh = x2 - x1, y2 - y1
            if bw <= 0 or bh <= 0:
                continue
            if bw * bh < _MIN_BOX_AREA:
                continue
            if max(bw, bh) / min(bw, bh) > _MAX_ASPECT_RATIO:
                continue
            kept.append((float(box.conf[0]), [x1, y1, x2, y2]))
        pairs.append((kept, _gt_boxes(img, w, h)))
    return pairs


def _score(pairs, conf_t: float) -> dict:
    """Greedy highest-confidence-first matching at _MATCH_IOU."""
    tp = fp = n_gt = 0
    for kept, gt in pairs:
        n_gt += len(gt)
        used = set()
        for _, box in sorted((d for d in kept if d[0] >= conf_t), key=lambda d: -d[0]):
            best, best_i = 0.0, -1
            for i, g in enumerate(gt):
                if i in used:
                    continue
                v = _iou(box, g)
                if v > best:
                    best, best_i = v, i
            if best >= _MATCH_IOU:
                used.add(best_i)
                tp += 1
            else:
                fp += 1
    fn = n_gt - tp
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return {
        "conf":      conf_t,
        "precision": round(prec * 100, 2),
        "recall":    round(rec * 100, 2),
        "f1":        round(f1 * 100, 2),
    }


def _sweep(model, images, imgsz) -> dict:
    pairs = _filtered_predictions(model, images, imgsz)
    points = [_score(pairs, c) for c in _CONFS]
    best = max(points, key=lambda p: p["f1"])
    return {
        "points":      points,
        "best_conf":   best["conf"],
        "best_f1":     best["f1"],
        "config_conf": config.VEHICLE_DETECT_CONF,
    }


def _bands(model, images, imgsz) -> list:
    """Band mAP from a real .val() call per band, over a temporary image list."""
    grouped = {name: [] for name, _, _ in BANDS}
    for img in images:
        gray = cv2.imread(str(img), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            continue
        grouped[band(float(gray.mean()))].append(img)

    out = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for name, _, _ in BANDS:
            members = grouped[name]
            row = {
                "band":      name,
                "images":    len(members),
                # counting boxes only, so the scale passed in does not matter
                "instances": sum(len(_gt_boxes(p, 1, 1)) for p in members),
            }
            if members:
                listing = tmp / f"{name}.txt"
                listing.write_text("\n".join(str(p.resolve()) for p in members))
                band_yaml = tmp / f"{name}.yaml"
                # 'train' is unused here but check_det_dataset requires the key.
                band_yaml.write_text(
                    f"path: {tmp}\ntrain: {listing.name}\nval: {listing.name}\n"
                    "names:\n  0: vehicle\n"
                )
                row.update(_val(model, band_yaml, "val", imgsz))
            out.append(row)
    return out


def _persist(name: str, result: dict) -> None:
    """Write the canonical per-dataset report and archive a timestamped copy.

    Mirrors what evaluate-all does with model_comparison files: the canonical
    name is easy to cite, the archive keeps earlier runs after an overwrite.
    Failing to write a report must not lose the numbers already computed, so
    write errors are logged and swallowed.
    """
    from dev.eval.history_store import save_detector_snapshot
    path = config.OUTPUT_DIR / f"detector_eval_{name}.json"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    except OSError as e:
        logger.warning(f"Could not write {path}: {e}")
    save_detector_snapshot(name, result)


def run(yaml_path, split: str | None = None) -> dict:
    """Evaluate the vehicle detector on one dataset yaml and split."""
    from ultralytics import YOLO

    yaml_path = Path(yaml_path)
    if not yaml_path.is_file():
        raise FileNotFoundError(f"No dataset yaml at {yaml_path}.")
    check_vehicle_classes(yaml_path)
    split = split or declared_split(yaml_path)
    weights = config.VEHICLE_DETECT_PATH
    if not Path(weights).exists():
        raise FileNotFoundError(f"No vehicle detector weights at {weights}. Train it first.")

    imgsz = config.YOLO_DETECT_IMG_SIZE
    images = _split_images(yaml_path, split)
    model = YOLO(str(weights))

    result = {
        "dataset":   str(yaml_path),
        "split":     split,
        "weights":   str(weights),
        "imgsz":     imgsz,
        "images":    len(images),
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "baseline":  _val(model, yaml_path, split, imgsz),
        "sweep":     _sweep(model, images, imgsz),
        "bands":     _bands(model, images, imgsz),
    }
    _persist(yaml_path.parent.name, result)
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data", type=Path, required=True, help="dataset yaml to evaluate")
    ap.add_argument("--split", default=None,
                    help="default: whichever of test or val the yaml declares")
    args = ap.parse_args()

    r = run(args.data, args.split)
    b = r["baseline"]
    print(f"vehicle detector — {r['images']} frames, imgsz {r['imgsz']}, split {r['split']}")
    print(f"  baseline (raw)   mAP50 {b['map50']:.2f}  mAP50-95 {b['map50_95']:.2f}  "
          f"P {b['precision']:.2f}  R {b['recall']:.2f}")
    print("  sweep (post-filter — area and aspect checks applied, so it will not "
          "match the baseline)")
    for p in r["sweep"]["points"]:
        mark = "  <- best F1" if p["conf"] == r["sweep"]["best_conf"] else ""
        print(f"    conf {p['conf']:.2f}   P {p['precision']:6.2f}   "
              f"R {p['recall']:6.2f}   F1 {p['f1']:6.2f}{mark}")
    print(f"    config VEHICLE_DETECT_CONF is {r['sweep']['config_conf']:.2f}")
    print("  luminance bands")
    for row in r["bands"]:
        if row["images"]:
            print(f"    {row['band']:<9} {row['images']:3d} frames  {row['instances']:4d} boxes  "
                  f"mAP50 {row['map50']:.2f}  mAP50-95 {row['map50_95']:.2f}  "
                  f"P {row['precision']:.2f}  R {row['recall']:.2f}")
        else:
            print(f"    {row['band']:<9}   0 frames")


if __name__ == "__main__":
    main()
