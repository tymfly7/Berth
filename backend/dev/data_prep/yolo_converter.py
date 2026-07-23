"""
YOLO Detection Dataset Converter
==================================
Converts an annotated source's annotations.json into the YOLO detection format
expected by Ultralytics:

  yolo_detect_dataset/
    images/train/   images/val/   images/test/
    labels/train/   labels/val/   labels/test/
    dataset.yaml

Annotation source format (annotations.json):
  {
    "train": {
      "file_names":    [str, ...]            # image filenames
      "rois_list":     [[[x,y]*4], ...]      # per-image list of quad polygons (normalized)
      "occupancy_list": [[bool, ...], ...]   # per-image per-spot occupancy flag
    },
    "valid": { ... },
    "test":  { ... }
  }

YOLO label format (one .txt per image):
  <class> <cx> <cy> <w> <h>   (all values normalized 0–1)

Classes:
  0 = vacant
  1 = occupied
"""

import json
import shutil
import logging
from pathlib import Path

import config

logger = logging.getLogger("berth.yolo_converter")

CLASS_VACANT   = 0
CLASS_OCCUPIED = 1

# Map JSON split names → YOLO split folder names
SPLIT_MAP = {"train": "train", "valid": "val", "test": "test"}


def _quad_to_bbox(quad: list[list[float]]) -> tuple[float, float, float, float]:
    """Convert a 4-corner normalized polygon to YOLO bbox (cx, cy, w, h)."""
    xs = [p[0] for p in quad]
    ys = [p[1] for p in quad]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    cx = (x_min + x_max) / 2
    cy = (y_min + y_max) / 2
    w  = x_max - x_min
    h  = y_max - y_min
    return cx, cy, w, h


def _clamp(v: float) -> float:
    return max(0.0, min(1.0, v))


def build_yolo_detect_dataset(
    source_dir: Path | None = None,
    out_dir: Path | None = None,
    force: bool = False,
) -> Path:
    """
    Convert annotated source frames to YOLO detection format.

    Args:
        source_dir: Path to the annotated source dir (annotations.json + images/)
        out_dir:   Destination dataset directory (default: config.YOLO_DATASET_DIR)
        force:     Rebuild even if out_dir already exists

    Returns:
        Path to the generated dataset.yaml
    """
    source_dir = Path(source_dir)
    out_dir   = Path(out_dir   or config.YOLO_DATASET_DIR)

    ann_path  = source_dir / "annotations.json"
    img_src   = source_dir / "images"

    if not ann_path.exists():
        raise FileNotFoundError(f"annotations.json not found at {ann_path}")
    if not img_src.exists():
        raise FileNotFoundError(f"Images directory not found at {img_src}")

    if out_dir.exists() and not force:
        yaml_path = out_dir / "dataset.yaml"
        if yaml_path.exists():
            logger.info(f"Dataset already exists at {out_dir}. Use force=True to rebuild.")
            return yaml_path

    logger.info(f"Building YOLO detection dataset → {out_dir}")

    with open(ann_path) as f:
        annotations = json.load(f)

    total_images = 0
    total_labels = 0
    skipped      = 0

    for json_split, yolo_split in SPLIT_MAP.items():
        split_data = annotations.get(json_split, {})
        file_names     = split_data.get("file_names", [])
        rois_list      = split_data.get("rois_list", [])
        occupancy_list = split_data.get("occupancy_list", [])

        img_out = out_dir / "images" / yolo_split
        lbl_out = out_dir / "labels" / yolo_split
        img_out.mkdir(parents=True, exist_ok=True)
        lbl_out.mkdir(parents=True, exist_ok=True)

        for fname, rois, occupancies in zip(file_names, rois_list, occupancy_list):
            src_img = img_src / fname
            if not src_img.exists():
                logger.warning(f"Image not found, skipping: {src_img}")
                skipped += 1
                continue

            # Copy image
            dst_img = img_out / fname
            shutil.copy2(src_img, dst_img)

            # Write label file
            stem     = Path(fname).stem
            lbl_file = lbl_out / f"{stem}.txt"
            lines    = []
            for quad, occupied in zip(rois, occupancies):
                if len(quad) < 3:
                    continue
                cls = CLASS_OCCUPIED if occupied else CLASS_VACANT
                cx, cy, w, h = _quad_to_bbox(quad)
                cx, cy, w, h = _clamp(cx), _clamp(cy), _clamp(w), _clamp(h)
                if w > 0 and h > 0:
                    lines.append(f"{cls} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")

            lbl_file.write_text("\n".join(lines))
            total_labels += len(lines)
            total_images += 1

    # Write dataset.yaml
    yaml_path = out_dir / "dataset.yaml"
    yaml_content = (
        f"path: {out_dir.as_posix()}\n"
        f"train: images/train\n"
        f"val:   images/val\n"
        f"test:  images/test\n"
        f"\n"
        f"nc: 2\n"
        f"names:\n"
        f"  0: vacant\n"
        f"  1: occupied\n"
    )
    yaml_path.write_text(yaml_content)

    logger.info(
        f"Conversion complete — {total_images} images, {total_labels} spot labels, "
        f"{skipped} skipped. dataset.yaml → {yaml_path}"
    )
    return yaml_path
